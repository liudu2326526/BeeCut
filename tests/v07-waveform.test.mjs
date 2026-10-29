import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '../server/index.mjs';
import { createStore } from '../server/store.mjs';
import { run, ffmpegPath } from '../server/process.mjs';
import { createWaveformService, createPeakParser, waveformLayout, WAVEFORM_LIMITS, WAVEFORM_VERSION } from '../server/waveform.mjs';
import { waveformColumns, waveformPath, waveformReference, MAX_WAVEFORM_COLUMNS } from '../src/waveform-view.mjs';
import { subscribeWaveform } from '../src/waveform-data.mjs';
import { createSpeedCurve, trimClip, sourceTimeAt } from '../shared/model.mjs';

const exec = promisify(execFile), delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = data => createHash('sha256').update(data).digest('hex');
async function encode(args) { await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-threads', '1', ...args]); }
async function waitFor(get) {
  for (let i = 0; i < 200; i++) { const value = await get(); if (['ready', 'failed', 'no-audio'].includes(value.status)) return value; await delay(15); }
  throw new Error('waveform deadline exceeded');
}
async function open(dataDir) {
  const runtime = await createApp({ dataDir });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let closing;
  return { ...runtime, base: `http://127.0.0.1:${server.address().port}`,
    close: () => closing ??= (async () => { await runtime.queue.close(); server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); })() };
}
async function evidence(value) {
  if (!process.env.WEIJIAN_WAVEFORM_EVIDENCE_DIR) return;
  await fs.mkdir(process.env.WEIJIAN_WAVEFORM_EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(path.join(process.env.WEIJIAN_WAVEFORM_EVIDENCE_DIR, 'waveform-api-real-pcm.json'), JSON.stringify(value, null, 2));
}

test('waveform PCM bins and parser reject missing, duplicated, out-of-order or oversized producer data', () => {
  const layout = waveformLayout(.02), parser = createPeakParser(layout);
  parser.push('frame:0 pts:0 pts_time:0\nlavfi.astats.Overall.Peak_');
  parser.push('level=-6.020600\nframe:1 pts:480 pts_time:0.01\nlavfi.astats.Overall.Peak_level=-inf\n');
  assert.deepEqual(parser.finish().peaks, [32767, 0]);
  const corrupt = createPeakParser(layout);
  assert.throws(() => corrupt.push('frame:0 pts:480 pts_time:0\n'), /顺序/);
  const missing = createPeakParser(layout); missing.push('frame:0 pts:0 pts_time:0\n'); assert.throws(() => missing.finish(), /缺少峰值/);
  assert.throws(() => createPeakParser(layout).push('x'.repeat(8 * 1024 * 1024 + 1)), /输出超过/);
  assert.ok(waveformLayout(86400).binCount <= WAVEFORM_LIMITS.maxPeaks);
  assert.throws(() => waveformLayout(Infinity));
});

test('visible waveform samples model-owned trim, constant, segments and retained smooth-curve source clocks', () => {
  const waveform = { sampleRate: 48000, binSamples: 480, magnitude: 65535, peaks: Array.from({ length: 800 }, (_, i) => i * 80) };
  const constant = { id: 'c', start: 3, sourceStart: 1, duration: 2, speed: 2 };
  const segments = { ...constant, sourceStart: 1, duration: 3, speed: 1, speedSegments: [{ sourceDuration: 2, speed: 2 }, { sourceDuration: 1, speed: .5 }] };
  const curve = createSpeedCurve({ ...constant, sourceStart: 0, duration: 8, speed: 1 }, 'montage', { type: 'video', duration: 8 });
  for (const clip of [constant, segments, curve]) {
    const columns = waveformColumns(clip, waveform, { width: 20 });
    assert.equal(columns.length, 20);
    for (let i = 0; i < columns.length; i++) {
      const right = sourceTimeAt(clip, clip.start + clip.duration * (i + 1) / 20);
      const bin = Math.min(799, Math.ceil(right * 100 - 1e-8) - 1);
      assert.equal(columns[i], waveform.peaks[bin] / 65535);
    }
    const cropped = trimClip(clip, { start: clip.start + clip.duration / 4, end: clip.start + clip.duration * .75 }, { type: 'video', duration: 8 });
    assert.deepEqual(waveformColumns(cropped, waveform, { width: 20 }), waveformColumns(clip, waveform, { width: 20, totalWidth: 40, offset: 10 }));
  }
  assert.equal(waveformColumns(constant, waveform, { width: 1e6 }).length, MAX_WAVEFORM_COLUMNS);
  assert.equal((waveformPath([0, .5, 1]).match(/M/g) || []).length, 3);
  const reference = waveformReference(waveform);
  assert.equal(reference, 799 * 80 / 65535);
  assert.equal(waveformPath([0, reference / 2, reference], reference), 'M0.5 50V50M1.5 26V74M2.5 2V98');
  assert.equal(waveformReference({ peaks: [0, 0], magnitude: 65535 }), 1);
});

test('waveform subscriptions survive StrictMode-style cleanup and ignore a superseded fetch response', async t => {
  const original = globalThis.fetch, requests = [], updates = [];
  globalThis.fetch = (_url, options) => new Promise(resolve => requests.push({ options, resolve }));
  t.after(() => { globalThis.fetch = original; });
  const media = { id: 'waveform-cancel-remount', url: '/owned.wav' };
  const first = subscribeWaveform(media, () => {}); assert.equal(requests.length, 1); first();
  const second = subscribeWaveform(media, value => updates.push(value)); assert.equal(requests.length, 2); assert.equal(requests[0].options.signal.aborted, true);
  const body = peak => ({ mediaId: media.id, status: 'ready', sampleRate: 48000, magnitude: 65535, binSamples: 480, duration: .01, peaks: [peak] });
  requests[0].resolve({ ok: true, json: async () => body(10000) }); await delay(0); assert.ok(updates.every(value => value.status !== 'ready'));
  requests[1].resolve({ ok: true, json: async () => body(20000) }); await delay(0); assert.equal(updates.at(-1).peaks[0], 20000); second();
});

test('real API derives stereo/video/WAV/silence peaks, persists content cache, retries failures and rejects stale bytes', { timeout: 30000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'weijian-waveform-api-'));
  let runtime;
  t.after(async () => { await runtime?.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const wav = path.join(dir, 'envelope-stereo.wav'), video = path.join(dir, 'envelope-aac.mp4');
  const silent = path.join(dir, 'silence.wav'), noAudio = path.join(dir, 'no-audio.mp4');
  const amplitude = 'if(lt(t,0.5),0,if(lt(t,1),0.2,if(lt(t,1.5),0.8,0)))';
  await encode(['-f', 'lavfi', '-i', `aevalsrc=${amplitude.replaceAll(',', '\\,')}*sin(2*PI*440*t)|-${amplitude.replaceAll(',', '\\,')}*sin(2*PI*440*t):s=48000:d=2`, '-c:a', 'pcm_s16le', wav]);
  await encode(['-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=30:d=2', '-i', wav, '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', video]);
  await encode(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=0.4', '-c:a', 'pcm_s16le', silent]);
  await encode(['-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=30:d=0.4', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', noAudio]);
  const files = [wav, video, silent, noAudio], originals = await Promise.all(files.map(f => fs.readFile(f)));
  runtime = await open(path.join(dir, 'Library'));
  const api = async (url, options) => { const response = await fetch(runtime.base + url, options); return { response, body: await response.json() }; };
  const form = new FormData(); files.forEach((f, i) => form.append('files', new Blob([originals[i]]), path.basename(f)));
  const imported = await api('/api/media', { method: 'POST', body: form }); assert.equal(imported.response.status, 201);
  const [wave, aac, zero, none] = files.map(f => imported.body.media.find(m => m.name === path.basename(f)));
  const url = item => `/api/media/${item.id}/waveform`;
  const ready = async item => waitFor(async () => (await api(url(item))).body);
  const first = await Promise.all([wave, aac, zero, none].map(item => api(url(item))));
  assert.ok(first.slice(0, 3).every(r => ['queued', 'processing'].includes(r.body.status))); assert.equal(first[3].body.status, 'no-audio');
  const [waveData, aacData, zeroData] = await Promise.all([wave, aac, zero].map(ready));
  assert.equal(waveData.status, 'ready', waveData.error); assert.equal(aacData.status, 'ready', aacData.error);
  assert.equal(zeroData.status, 'ready'); assert.equal(zeroData.silent, true); assert.ok(zeroData.peaks.every(p => p === 0));
  assert.ok(waveData.peaks.slice(0, 49).every(p => p === 0)); assert.ok(waveData.peaks[60] > 12000 && waveData.peaks[60] < 14000);
  assert.ok(waveData.peaks[110] > 51000 && waveData.peaks[110] < 53000, 'opposite-phase stereo must not disappear by mono cancellation');
  const comparisons = [];
  for (const [filename, actual] of [[wav, waveData], [video, aacData]]) {
    const { stdout } = await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', filename, '-map', '0:a:0', '-af', 'aresample=48000:async=1:first_pts=0', '-f', 'f32le', '-'], { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 });
    const expected = new Array(actual.peaks.length).fill(0), channels = 2;
    for (let sample = 0; sample < stdout.length / 4; sample++) {
      const bin = Math.floor(sample / channels / actual.binSamples); if (bin >= expected.length) break;
      expected[bin] = Math.max(expected[bin], Math.abs(stdout.readFloatLE(sample * 4)));
    }
    const maximumError = Math.max(...expected.map((peak, i) => Math.abs(Math.round(Math.min(1, peak) * 65535) - actual.peaks[i])));
    if (maximumError > 3) {
      await evidence({ scope: 'Investigating decoded PCM amplitude-format disagreement; not a passing waveform receipt', file: path.basename(filename), maximumError,
        mismatches: expected.flatMap((peak, bin) => Math.abs(Math.round(Math.min(1, peak) * 65535) - actual.peaks[bin]) > 3 ? [{ bin, pcmPeak: peak, expected: Math.round(peak * 65535), actual: actual.peaks[bin] }] : []) });
    }
    assert.ok(maximumError <= 3, `${path.basename(filename)} differs from independently scanned real PCM: ${maximumError}`);
    comparisons.push({ file: path.basename(filename), maximumQuantizedError: maximumError, bins: actual.peaks.length });
  }
  assert.equal((await api('/api/media/missing/waveform')).response.status, 404);
  assert.equal((await api('/api/media/bad%20id/waveform')).response.status, 400);
  const cache = path.join(runtime.store.dirs.waveforms, `${waveData.cacheKey}.json`), cacheStat = await fs.stat(cache);
  const dataDir = runtime.store.root; await runtime.close(); runtime = await open(dataDir);
  assert.equal((await ready(wave)).cacheKey, waveData.cacheKey); assert.equal((await fs.stat(cache)).mtimeMs, cacheStat.mtimeMs, 'restart must read the cache instead of decoding again');
  const invalidCache = JSON.parse(await fs.readFile(cache, 'utf8')); invalidCache.version = 'obsolete-algorithm'; await fs.writeFile(cache, JSON.stringify(invalidCache));
  await runtime.close(); runtime = await open(dataDir); assert.equal((await ready(wave)).version, WAVEFORM_VERSION);
  const sentinel = path.join(runtime.store.dirs.waveforms, 'unrelated.txt'); await fs.writeFile(sentinel, 'preserve');
  for (let i = 0; i < 258; i++) await fs.writeFile(path.join(runtime.store.dirs.waveforms, `${hash(Buffer.from('owned-old-cache-' + i))}.json`), '{}');
  const huge = await fs.open(path.join(runtime.store.dirs.waveforms, `${'f'.repeat(64)}.json`), 'w'); await huge.truncate(WAVEFORM_LIMITS.cacheBytes + 1); await huge.close();
  const stored = runtime.store.media.get(wave.id), storedPath = runtime.store.mediaPath(stored), changed = Buffer.from(originals[0]);
  const dataOffset = changed.indexOf(Buffer.from('data')) + 8, sampleOffset = dataOffset + 62 * 480 * 2 * 2;
  changed.writeInt16LE(32767, sampleOffset); changed.writeInt16LE(-32768, sampleOffset + 2); await fs.writeFile(storedPath, changed);
  const mutated = await ready(wave); assert.equal(mutated.status, 'ready'); assert.notEqual(mutated.cacheKey, waveData.cacheKey); assert.equal(mutated.peaks[62], 65535);
  const kept = (await fs.readdir(runtime.store.dirs.waveforms)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
  assert.ok(kept.length <= WAVEFORM_LIMITS.cacheFiles); assert.ok((await Promise.all(kept.map(name => fs.stat(path.join(runtime.store.dirs.waveforms, name))))).reduce((bytes, stat) => bytes + stat.size, 0) <= WAVEFORM_LIMITS.cacheBytes);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'preserve');
  await fs.writeFile(storedPath, 'not audio'); const failed = await ready(wave); assert.equal(failed.status, 'failed'); assert.ok(!failed.peaks);
  assert.equal((await api(url(wave))).body.status, 'failed', 'failure must not loop automatic retries');
  const retried = await api(url(wave) + '/retry', { method: 'POST' }); assert.ok(['queued', 'processing'].includes(retried.body.status)); assert.equal((await ready(wave)).status, 'failed');
  await fs.writeFile(storedPath, originals[0]); await api(url(wave) + '/retry', { method: 'POST' }); assert.equal((await ready(wave)).cacheKey, waveData.cacheKey);
  for (let i = 0; i < files.length; i++) assert.equal(hash(await fs.readFile(files[i])), hash(originals[i]), 'source fixture files remain unchanged');
  await evidence({ scope: 'Real production HTTP API in isolated Library; WAV and AAC peaks compared with independently scanned decoded stereo float PCM', comparisons,
    originalSHA256: originals.map(hash), waveData, aacData, zeroData, noAudio: first[3].body, contentChangeKey: mutated.cacheKey,
    restartUsedUnchangedCacheMtime: true, explicitRetry: true });
});

test('waveform single child owner bounds queue and awaited close terminates a stopped real decoder', { timeout: 10000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'weijian-waveform-close-'));
  const store = await createStore(dir), filename = 'owned.wav';
  await encode(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-c:a', 'pcm_s16le', path.join(store.dirs.media, filename)]);
  for (let i = 0; i < 67; i++) store.media.set('m' + i, { id: 'm' + i, filename, duration: 2, type: 'audio', hasAudio: true });
  let child, spawnedResolve, live = 0, maximumLive = 0;
  const spawned = new Promise(resolve => { spawnedResolve = resolve; });
  const service = createWaveformService(store, { runProcess: (binary, args, options) => run(binary, args, { ...options, onChild(value) {
    child = value; options.onChild(value); live++; maximumLive = Math.max(maximumLive, live); value.once('close', () => live--);
    value.kill('SIGSTOP'); spawnedResolve();
  } }) });
  t.after(async () => { child?.kill('SIGKILL'); await service.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await service.get('m0'); await spawned;
  for (let i = 1; i <= 64; i++) assert.equal((await service.get('m' + i)).status, 'queued');
  await assert.rejects(service.get('m65'), error => error.status === 429);
  const closing = service.close(); assert.equal(service.close(), closing); await closing;
  assert.equal(live, 0); assert.equal(maximumLive, 1); assert.ok(child.signalCode || child.exitCode !== null);
  await assert.rejects(service.get('m66'), error => error.status === 503);
  assert.equal((await fs.readdir(store.dirs.waveforms)).length, 0, 'cancelled decode must not publish a cache');
});

test('production createApp close retries retained export cleanup after EACCES and closes waveforms on the first attempt', { timeout: 20000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'weijian-runtime-close-retry-')), dataDir = path.join(dir, 'Library');
  const originalRemove = fs.rm; let deny = true, runtime;
  // Controlled failure is confined to this runtime's job work directories.
  // createExportQueue captures the production fs.rm owner at createApp time.
  fs.rm = async (filename, options) => {
    if (deny && path.dirname(filename) === path.join(dataDir, 'work')) throw Object.assign(new Error('controlled runtime cleanup EACCES'), { code: 'EACCES' });
    return originalRemove(filename, options);
  };
  t.after(async () => { deny = false; fs.rm = originalRemove; await runtime?.close(); await originalRemove(dir, { recursive: true, force: true }); });
  const filename = path.join(dir, 'source.mp4');
  await encode(['-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=30:d=0.4', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', filename]);
  runtime = await open(dataDir);
  const form = new FormData(); form.append('files', new Blob([await fs.readFile(filename)]), 'source.mp4');
  const imported = await (await fetch(runtime.base + '/api/media', { method: 'POST', body: form })).json();
  const project = { id: 'close-retry', version: 1, name: 'real export cleanup retry', width: 320, height: 180, fps: 30,
    media: imported.media, clips: [{ id: 'picture', mediaId: imported.media[0].id, track: 'video', layer: 0, start: 0, sourceStart: 0, duration: .4, speed: 1, volume: 1 }], subtitles: [] };
  const response = await fetch(runtime.base + '/api/exports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project, settings: { quality: 'standard' } }) });
  assert.equal(response.status, 202); const job = await response.json(); let state;
  for (let i = 0; i < 300; i++) {
    state = await (await fetch(runtime.base + '/api/exports/' + job.id)).json();
    if (state.cleanupError) break;
    if (state.status === 'failed') assert.fail(state.error);
    await delay(10);
  }
  assert.equal(state.status, 'completed'); assert.match(state.cleanupError, /EACCES/);
  const first = runtime.queue.close(); assert.equal(runtime.queue.close(), first); await assert.rejects(first, /EACCES/);
  assert.ok((await fs.readdir(runtime.store.dirs.work)).includes(job.id));
  assert.equal((await fetch(`${runtime.base}/api/media/${imported.media[0].id}/waveform`)).status, 503, 'waveform close must finish even when export cleanup rejects');
  deny = false; fs.rm = originalRemove;
  const second = runtime.queue.close(); assert.notEqual(first, second); await second; assert.equal(runtime.queue.close(), second);
  assert.deepEqual(await fs.readdir(runtime.store.dirs.work), []); assert.equal(runtime.queue.get(job.id).cleanupError, undefined);
});
