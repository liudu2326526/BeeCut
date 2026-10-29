import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { mkdtemp, readFile, writeFile, rm, access, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { newProject, splitClip } from '../shared/model.mjs';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const delay = ms => new Promise(done => setTimeout(done, ms));
const hash = buffer => createHash('sha256').update(buffer).digest('hex');

async function freePort() {
  const server = createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  await new Promise(done => server.close(done));
  return port;
}

test('real local workflow imports, trims, saves, reopens, subtitles, mixes, exports, and cancels', { timeout: 180000 }, async t => {
  const dir = await mkdtemp(resolve(tmpdir(), 'jianying-flow-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let output = '';
  const server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: resolve(dir, 'store') }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', chunk => { output = (output + chunk).slice(-20000); });
  server.stderr.on('data', chunk => { output = (output + chunk).slice(-20000); });
  let launchError;
  server.once('error', error => { launchError = error; });
  t.after(async () => {
    if (server.exitCode === null && !launchError) {
      const closed = new Promise(done => server.once('close', done));
      server.kill('SIGTERM');
      const force = setTimeout(() => server.kill('SIGKILL'), 5000);
      await closed;
      clearTimeout(force);
    }
    await rm(dir, { recursive: true, force: true });
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (launchError || server.exitCode !== null) throw new Error(`Server did not start: ${launchError?.message || output}`);
    try {
      const response = await fetch(`${base}/api/health`);
      const status = await response.json();
      if (response.ok && status.ok) { assert.equal(status.ffmpegAvailable, true); assert.equal(status.ffprobeAvailable, true); ready = true; break; }
    } catch { /* Wait for the private test server to listen. */ }
    await delay(100);
  }
  assert.equal(ready, true, `Server readiness timed out: ${output}`);

  const api = async (path, init) => {
    const response = await fetch(`${base}${path}`, init);
    const body = await response.json();
    return { response, body };
  };
  const post = (path, data) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const files = [resolve(dir, 'video-red.mp4'), resolve(dir, 'video-blue.mp4'), resolve(dir, 'music.wav')];
  await exec(ffmpegInstaller.path, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', "color=c=red:s=320x180:r=30:d=3,drawbox=color=lime:x=0:y=0:w=iw:h=ih:t=fill:enable='gte(t,1)'", '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', files[0]]);
  await exec(ffmpegInstaller.path, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=550:sample_rate=48000:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', files[1]]);
  await exec(ffmpegInstaller.path, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=3', '-c:a', 'pcm_s16le', files[2]]);
  const sourceHashes = await Promise.all(files.map(async file => hash(await readFile(file))));
  const form = new FormData();
  for (const file of files) form.append('files', new Blob([await readFile(file)]), basename(file));
  const imported = await api('/api/media', { method: 'POST', body: form });
  assert.ok(imported.response.ok, JSON.stringify(imported.body));
  assert.equal(imported.body.media.length, 3);
  const [red, blue, music] = files.map(file => imported.body.media.find(item => item.name === basename(file)));
  assert.equal(red.type, 'video');
  assert.equal(red.hasAudio, true);
  assert.equal(blue.type, 'video');
  assert.equal(music.type, 'audio');
  assert.ok(red.duration >= 3 && red.duration < 3.2);
  assert.equal(red.width, 320);
  for (const item of [red, blue]) {
    assert.ok(item.thumbnailUrl);
    assert.equal((await fetch(`${base}${item.thumbnailUrl}`)).status, 200);
  }
  for (let i = 0; i < files.length; i++) {
    const item = [red, blue, music][i];
    const copy = Buffer.from(await (await fetch(`${base}${item.url}`)).arrayBuffer());
    assert.equal(hash(copy), sourceHashes[i]);
  }
  const sentinel = resolve(dir, 'subtitle-must-remain-literal');
  const subtitleText = `山海：你好，世界！ 'quoted' : 100% \\ [a];\n$(touch ${sentinel})`;
  const project = { ...newProject('真实流程：裁剪 + 字幕 + 配乐'), width: 320, height: 180, fps: 30, media: imported.body.media };
  const trimmed = { id: crypto.randomUUID(), mediaId: red.id, track: 'video', start: 0, sourceStart: 0.4, duration: 0.8, speed: 1.25, volume: 0.15 };
  const pieces = splitClip(trimmed, 0.4);
  project.clips = [...pieces, { id: crypto.randomUUID(), mediaId: blue.id, track: 'video', start: 0.8, sourceStart: 0.6, duration: 0.8, speed: 0.75, volume: 0.2 }, { id: crypto.randomUUID(), mediaId: music.id, track: 'audio', start: 0, sourceStart: 0.25, duration: 1.6, speed: 1, volume: 0.35 }];
  project.subtitles = [{ id: crypto.randomUUID(), text: subtitleText, start: 0.1, duration: 1.4, fontSize: 12, color: '#FFFFFF', position: 'bottom' }];
  const saved = await post('/api/projects', project);
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  for (let i = 0; i < 2; i++) {
    const reopened = await api(`/api/projects/${project.id}`);
    assert.equal(reopened.response.status, 200);
    assert.deepEqual(reopened.body.project, saved.body.project);
    assert.equal(reopened.body.project.subtitles[0].text, subtitleText);
    assert.equal(reopened.body.project.clips[1].sourceStart, 0.9);
  }
  const list = await api('/api/projects');
  assert.ok(list.body.projects.some(item => item.id === project.id && Math.abs(item.duration - 1.6) < 0.01));

  for (const [description, mutate] of [
    ['overlapping video clips', candidate => { candidate.clips[2].start = 0.7; }],
    ['unknown media identity', candidate => { candidate.clips[0].mediaId = '../../outside'; }],
    ['source interval beyond media duration', candidate => { candidate.clips[0].sourceStart = 20; }],
  ]) {
    const invalid = structuredClone(project);
    mutate(invalid);
    const rejected = await post('/api/projects', invalid);
    assert.ok(rejected.response.status >= 400 && rejected.response.status < 500, `${description}: ${JSON.stringify(rejected.body)}`);
    assert.equal(typeof rejected.body.error, 'string');
    const unaffected = await api(`/api/projects/${project.id}`);
    assert.deepEqual(unaffected.body.project, saved.body.project, `A rejected ${description} save must preserve the last project.`);
  }
  const hostilePath = structuredClone(project);
  hostilePath.media[0].url = 'file:///etc/passwd';
  hostilePath.media[0].thumbnailUrl = '/media/../../outside';
  const normalized = await post('/api/projects', hostilePath);
  if (normalized.response.ok) {
    assert.equal(normalized.body.project.media[0].url, red.url);
    assert.equal(normalized.body.project.media[0].thumbnailUrl, red.thumbnailUrl);
  } else {
    assert.ok(normalized.response.status >= 400 && normalized.response.status < 500);
  }
  const corruptForm = new FormData();
  corruptForm.append('files', new Blob(['this is not a playable MP4']), 'invalid.mp4');
  const corrupt = await api('/api/media', { method: 'POST', body: corruptForm });
  assert.ok(corrupt.response.status >= 400 && corrupt.response.status < 500);
  assert.equal(typeof corrupt.body.error, 'string');

  const exported = await post('/api/exports', { project, settings: { width: 320, height: 180, fps: 30, quality: 'standard' } });
  assert.ok(exported.response.ok, JSON.stringify(exported.body));
  assert.ok(exported.body.id);
  let job;
  for (let i = 0; i < 400; i++) {
    job = (await api(`/api/exports/${exported.body.id}`)).body;
    if (['completed', 'failed', 'cancelled'].includes(job.status)) break;
    await delay(100);
  }
  assert.equal(job.status, 'completed', `${JSON.stringify(job)}\n${output}`);
  assert.equal(job.progress, 100);
  assert.ok(job.url.startsWith('/exports/'));
  const outputPath = resolve(dir, 'completed.mp4');
  const encoded = await fetch(`${base}${job.url}`);
  assert.equal(encoded.status, 200);
  await writeFile(outputPath, Buffer.from(await encoded.arrayBuffer()));
  const probe = JSON.parse((await exec(ffprobeInstaller.path, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', outputPath])).stdout);
  const picture = probe.streams.find(stream => stream.codec_type === 'video');
  const sound = probe.streams.find(stream => stream.codec_type === 'audio');
  assert.equal(picture.codec_name, 'h264');
  assert.equal(picture.width, 320);
  assert.equal(picture.height, 180);
  assert.ok(sound, 'Export must mix source sound and added music into an audio stream.');
  assert.ok(Math.abs(Number(probe.format.duration) - 1.6) < 0.2, `Unexpected duration ${probe.format.duration}`);
  for (const [time, expected] of [[0.1, 'red'], [0.65, 'green'], [1.2, 'blue']]) {
    const sample = (await exec(ffmpegInstaller.path, ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', outputPath, '-frames:v', '1', '-vf', 'crop=8:8:0:0,scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' })).stdout;
    const [r, g, b] = sample;
    assert.ok(expected === 'red' ? r > 180 && g < 70 && b < 70 : expected === 'green' ? g > 180 && r < 70 && b < 70 : b > 180 && r < 70 && g < 70, `At ${time}s expected ${expected}, got rgb(${r},${g},${b}). Source trim and speed must affect exported picture.`);
  }
  const pcm = (await exec(ffmpegInstaller.path, ['-hide_banner', '-loglevel', 'error', '-ss', '0.15', '-i', outputPath, '-t', '0.2', '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { encoding: 'buffer' })).stdout;
  const samples = pcm.length / 4;
  for (const [frequency, label] of [[220, 'added music'], [330, 'source video sound']]) {
    let real = 0, imaginary = 0;
    for (let i = 0; i < samples; i++) {
      const sample = pcm.readFloatLE(i * 4);
      real += sample * Math.cos(2 * Math.PI * frequency * i / 48000);
      imaginary += sample * Math.sin(2 * Math.PI * frequency * i / 48000);
    }
    assert.ok(2 * Math.hypot(real, imaginary) / samples > 0.002, `Export should contain audible ${label} (${frequency} Hz).`);
  }
  const ranged = await fetch(`${base}${job.url}`, { headers: { Range: 'bytes=0-63' } });
  assert.equal(ranged.status, 206);
  assert.equal((await ranged.arrayBuffer()).byteLength, 64);
  await assert.rejects(access(sentinel));
  for (let i = 0; i < files.length; i++) assert.equal(hash(await readFile(files[i])), sourceHashes[i], 'Original sources must not change during editing or export.');

  const cancellable = await post('/api/exports', { project, settings: { width: 1280, height: 720, fps: 60, quality: 'high' } });
  assert.ok(cancellable.response.ok, JSON.stringify(cancellable.body));
  const cancelled = await api(`/api/exports/${cancellable.body.id}`, { method: 'DELETE' });
  assert.ok(cancelled.response.ok, JSON.stringify(cancelled.body));
  for (let i = 0; i < 100; i++) {
    job = (await api(`/api/exports/${cancellable.body.id}`)).body;
    if (['cancelled', 'completed', 'failed'].includes(job.status)) break;
    await delay(50);
  }
  assert.equal(job.status, 'cancelled', JSON.stringify(job));
  assert.equal(job.url, undefined);
  let workFiles;
  for (let i = 0; i < 100; i++) {
    workFiles = await readdir(resolve(dir, 'store/work'));
    if (!workFiles.length) break;
    await delay(50);
  }
  assert.deepEqual(workFiles, [], 'Completed and cancelled export work directories must be released.');
  assert.deepEqual(await readdir(resolve(dir, 'store/uploads')), [], 'Malformed imports must release temporary uploads.');
  assert.ok((await readdir(resolve(dir, 'store/exports'))).every(name => !name.endsWith('.partial.mp4')), 'Cancelled exports must not retain partial MP4 files.');
  t.diagnostic('Verified isolated HTTP import, source preservation, speed-aware trim/split, two repeated reopen reads, validation failures, literal Chinese subtitles, MP4 H.264 + audio, byte ranges, and export cancellation.');
});
