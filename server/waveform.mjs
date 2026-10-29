import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicJson, HttpError } from './store.mjs';
import { ffmpegPath, inputSafetyArgs, run } from './process.mjs';

export const WAVEFORM_VERSION = 'pcm-f32-peak-48k-multichannel-v1';
export const WAVEFORM_LIMITS = Object.freeze({ maxPeaks: 20000, sampleRate: 48000, minimumBinSamples: 480,
  maxQueue: 64, memoryEntries: 32, cacheFiles: 256, cacheBytes: 32 * 1024 * 1024, decodeTimeoutMs: 60000 });
const MAGNITUDE = 65535;
const cacheName = /^[a-f0-9]{64}\.json$/;
const digest = text => createHash('sha256').update(text).digest('hex');
const signature = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');

export function waveformLayout(duration) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) throw new Error('无法确定波形素材时长');
  const binSamples = Math.max(WAVEFORM_LIMITS.minimumBinSamples, Math.ceil(duration * WAVEFORM_LIMITS.sampleRate / WAVEFORM_LIMITS.maxPeaks));
  return { duration, sampleRate: WAVEFORM_LIMITS.sampleRate, binSamples,
    binCount: Math.ceil(duration * WAVEFORM_LIMITS.sampleRate / binSamples), magnitude: MAGNITUDE };
}

// FFmpeg computes each peak from all channels of decoded PCM. No mono downmix
// or low-rate resampling may erase opposite-phase channels/high audio tones.
export function waveformArguments(filename, layout) {
  const filter = `aresample=${layout.sampleRate}:async=1:first_pts=0,aformat=sample_fmts=flt,atrim=end_sample=${Math.ceil(layout.duration * layout.sampleRate)},asetnsamples=n=${layout.binSamples}:p=1,` +
    "astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=Peak_level," +
    "ametadata=mode=print:key=lavfi.astats.Overall.Peak_level:file='pipe\\:1'";
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1', ...inputSafetyArgs, '-i', filename,
    '-map', '0:a:0', '-vn', '-sn', '-dn', '-filter_threads', '1', '-af', filter, '-t', String(layout.duration), '-c:a', 'pcm_f32le', '-f', 'null', '-'];
}

export function createPeakParser(layout) {
  const peaks = new Uint16Array(layout.binCount);
  let pending = '', bytes = 0, current = -1, count = 0, last = -1, lastPeak = -1;
  function line(text) {
    const frame = /^frame:(\d+)\s+pts:\s*(-?\d+)/.exec(text);
    if (frame) {
      if (current >= 0 && lastPeak !== current) throw new Error('波形解码缺少峰值');
      current = Number(frame[1]);
      if (current !== last + 1 || current > layout.binCount + 1 || Number(frame[2]) !== current * layout.binSamples) throw new Error('波形解码帧顺序无效');
      last = current;
      return;
    }
    if (!text.startsWith('lavfi.astats.Overall.Peak_level=')) return;
    const value = text.slice(text.indexOf('=') + 1).trim();
    const db = value === '-inf' ? -Infinity : Number(value);
    if (current < 0 || lastPeak === current || (db !== -Infinity && !Number.isFinite(db))) throw new Error('波形解码峰值无效');
    lastPeak = current;
    if (current < peaks.length) {
      peaks[current] = Math.round(Math.min(1, Math.max(0, db === -Infinity ? 0 : 10 ** (db / 20))) * MAGNITUDE);
      count++;
    }
  }
  return {
    push(chunk) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 8 * 1024 * 1024) throw new Error('波形解码输出超过上限');
      pending += chunk;
      let end;
      while ((end = pending.indexOf('\n')) >= 0) { line(pending.slice(0, end).replace(/\r$/, '')); pending = pending.slice(end + 1); }
      if (pending.length > 2048) throw new Error('波形解码行过长');
    },
    finish() {
      if (pending) line(pending);
      if (current !== lastPeak) throw new Error('波形解码缺少峰值');
      if (!count) throw new Error('没有读取到可用的音频采样');
      return { peaks: Array.from(peaks), decodedBins: count, silent: peaks.every(peak => peak === 0) };
    },
  };
}

async function hashFile(filename, job) {
  const hash = createHash('sha256'), stream = createReadStream(filename);
  if (job) job.hashStream = stream;
  try { for await (const chunk of stream) hash.update(chunk); return hash.digest('hex'); }
  finally { if (job) job.hashStream = null; stream.destroy(); }
}
let decoderDigest;
const decoderIdentity = () => decoderDigest ??= hashFile(ffmpegPath).catch(error => { decoderDigest = null; throw error; });

export function createWaveformService(store, { runProcess = run } = {}) {
  const jobs = new Map(), pending = [], hashes = new Map();
  let active = null, task = null, closed = false, closing;
  const snapshot = job => job.status === 'ready' ? { mediaId: job.id, status: job.status, ...job.result }
    : { mediaId: job.id, status: job.status, version: WAVEFORM_VERSION,
      ...(job.error ? { error: job.error } : { retryAfterMs: job.status === 'queued' ? 1000 : 400 }) };
  async function statSource(filename) {
    const stat = await fs.lstat(filename, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink()) throw new HttpError(400, '波形素材必须是资料库内的普通文件');
    return signature(stat);
  }
  function stop(job) {
    job.hashStream?.destroy(new Error('波形服务正在关闭或素材已更新'));
    const child = job.child;
    if (!child || job.killTimer) return;
    child.kill('SIGTERM');
    job.killTimer = setTimeout(() => { if (job.child === child) child.kill('SIGKILL'); }, 1500);
    job.killTimer.unref();
  }
  function trimMemory() {
    const completed = [...jobs.values()].filter(j => ['ready', 'failed'].includes(j.status));
    while (completed.length > WAVEFORM_LIMITS.memoryEntries) {
      const oldest = completed.shift();
      if (jobs.get(oldest.id) === oldest) jobs.delete(oldest.id);
    }
    while (hashes.size > 128) hashes.delete(hashes.keys().next().value);
  }
  async function readCache(filename, key, layout) {
    try {
      const stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.size > 256 * 1024) return null;
      const value = JSON.parse(await fs.readFile(filename, 'utf8'));
      if (value.version !== WAVEFORM_VERSION || value.cacheKey !== key || value.duration !== layout.duration ||
        value.sampleRate !== layout.sampleRate || value.binSamples !== layout.binSamples || value.magnitude !== MAGNITUDE ||
        !Array.isArray(value.peaks) || value.peaks.length !== layout.binCount ||
        !value.peaks.every(p => Number.isInteger(p) && p >= 0 && p <= MAGNITUDE)) return null;
      return { ...value, silent: value.peaks.every(p => p === 0) };
    } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
  }
  async function pruneCache() {
    const kept = []; let bytes = 0;
    for await (const entry of await fs.opendir(store.dirs.waveforms)) {
      if (!entry.isFile() || !cacheName.test(entry.name)) continue;
      const filename = path.join(store.dirs.waveforms, entry.name), stat = await fs.stat(filename);
      kept.push({ filename, time: stat.mtimeMs, bytes: stat.size }); bytes += stat.size;
      // Retain only bounded metadata even if a previous process generated more.
      while (kept.length > WAVEFORM_LIMITS.cacheFiles || bytes > WAVEFORM_LIMITS.cacheBytes) {
        kept.sort((a, b) => a.time - b.time);
        const removed = kept.shift(); bytes -= removed.bytes;
        await fs.rm(removed.filename, { force: true });
      }
    }
  }
  async function generate(job) {
    const layout = waveformLayout(job.media.duration);
    const remembered = hashes.get(job.id);
    const sourceDigest = remembered?.signature === job.signature ? remembered.hash : await hashFile(job.filename, job);
    if (closed || jobs.get(job.id) !== job) return;
    if (await statSource(job.filename) !== job.fileSignature) throw new Error('生成波形时素材发生变化，请重试');
    hashes.delete(job.id); hashes.set(job.id, { signature: job.signature, hash: sourceDigest });
    const decoder = await decoderIdentity();
    const key = digest(JSON.stringify([WAVEFORM_VERSION, sourceDigest, decoder, layout]));
    const filename = path.join(store.dirs.waveforms, `${key}.json`);
    let result = await readCache(filename, key, layout);
    if (!result) {
      if (closed || jobs.get(job.id) !== job) return;
      const parser = createPeakParser(layout); let parseError;
      try {
        await runProcess(ffmpegPath, waveformArguments(job.filename, layout), { timeout: WAVEFORM_LIMITS.decodeTimeoutMs, maxOutput: 4096,
          onChild(child) { job.child = child; if (closed || jobs.get(job.id) !== job) stop(job); },
          onProgress(chunk) { if (parseError) return; try { parser.push(chunk); } catch (error) { parseError = error; stop(job); } },
        });
      } catch (error) { throw parseError || error; }
      if (parseError) throw parseError;
      if (closed || jobs.get(job.id) !== job) return;
      if (await statSource(job.filename) !== job.fileSignature) throw new Error('生成波形时素材发生变化，请重试');
      result = { version: WAVEFORM_VERSION, cacheKey: key, sourceSHA256: sourceDigest, ...layout, ...parser.finish() };
      await atomicJson(filename, result);
      await pruneCache();
    }
    if (!closed && jobs.get(job.id) === job) {
      if (await statSource(job.filename) !== job.fileSignature) throw new Error('生成波形时素材发生变化，请重试');
      job.result = result; job.status = 'ready';
    }
  }
  function pump() {
    if (closed || active) return;
    let job;
    do { job = pending.shift(); } while (job && jobs.get(job.id) !== job);
    if (!job) return;
    active = job; job.status = 'processing';
    task = generate(job).catch(error => {
      if (!closed && jobs.get(job.id) === job) { job.status = 'failed'; job.error = String(error.message || '无法生成音频波形').slice(0, 400); }
    }).finally(() => {
      clearTimeout(job.killTimer); job.child = null; job.hashStream = null;
      active = null; task = null; trimMemory();
      if (!closed) queueMicrotask(pump);
    });
  }
  return {
    async get(id, { retry = false } = {}) {
      if (closed) throw new HttpError(503, '本地波形服务正在关闭');
      const media = store.media.get(id);
      if (!media) throw new HttpError(404, '找不到需要生成波形的素材');
      if (!media.hasAudio || media.type === 'image') return { mediaId: id, status: 'no-audio', version: WAVEFORM_VERSION };
      const filename = store.mediaPath(media);
      let fileSignature;
      try { fileSignature = await statSource(filename); }
      catch (error) { return { mediaId: id, status: 'failed', version: WAVEFORM_VERSION, error: error.code === 'ENOENT' ? '波形素材已不存在，请重新导入' : String(error.message).slice(0, 400) }; }
      if (closed) throw new HttpError(503, '本地波形服务正在关闭');
      const sourceSignature = JSON.stringify([fileSignature, media.duration]);
      const previous = jobs.get(id);
      if (previous && previous.signature === sourceSignature && (!retry || previous.status !== 'failed')) return snapshot(previous);
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i].id === id) pending.splice(i, 1);
      if (pending.length >= WAVEFORM_LIMITS.maxQueue) throw new HttpError(429, '波形队列已满，请稍后重试');
      if (previous === active) stop(previous);
      const job = { id, media, filename, fileSignature, signature: sourceSignature, status: 'queued' };
      jobs.set(id, job); pending.push(job); trimMemory(); queueMicrotask(pump);
      return snapshot(job);
    },
    close() {
      if (closing) return closing;
      closed = true;
      for (const job of pending.splice(0)) { job.status = 'failed'; job.error = '波形服务已关闭'; }
      if (active) stop(active);
      closing = task || Promise.resolve();
      return closing;
    },
  };
}
