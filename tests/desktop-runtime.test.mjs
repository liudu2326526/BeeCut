import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { executablePath, ffmpegPath, ffprobePath } from '../server/process.mjs';
import { newProject } from '../shared/model.mjs';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function sourceSnapshot(dir, prefix = '') {
  const result = {};
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (error) {
    // A clean clone has no web library. Keep absence distinct from an empty
    // directory, and still fail on missing children or other filesystem errors.
    if (error.code === 'ENOENT' && prefix === '' && dir === path.join(root, 'data')) return null;
    throw error;
  }
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    const filename = path.join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(result, await sourceSnapshot(filename, relative));
    else if (entry.isFile()) result[relative] = hash(await readFile(filename));
  }
  return result;
}

async function startRuntime(dataDir) {
  const runtime = await createApp({ dataDir, staticDir: path.join(root, 'dist/client') });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    ...runtime, base,
    async close() {
      await runtime.queue.close();
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

test('native binary paths map only an actual app.asar path segment', () => {
  assert.equal(executablePath('/Applications/微剪.app/Contents/Resources/app.asar/node_modules/ffmpeg'), '/Applications/微剪.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg');
  for (const filename of ['/tmp/my-app.asar-cache/ffmpeg', '/tmp/app.asar.unpacked/ffmpeg', '/tmp/app.asar-backup/ffmpeg', '/tmp/app.asar']) assert.equal(executablePath(filename), filename);
  assert.equal(executablePath('C:\\Program Files\\微剪\\app.asar\\node_modules\\ffprobe.exe'), 'C:\\Program Files\\微剪\\app.asar.unpacked\\node_modules\\ffprobe.exe');
});

test('desktop single-origin runtime imports, atomically saves, restarts, and exports real media without changing web data', { timeout: 120000 }, async t => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'weijian-desktop-'));
  const dataDir = path.join(temporary, 'Application Support', '微剪', 'Library');
  const sourceData = path.join(root, 'data');
  const originalData = await sourceSnapshot(sourceData);
  let runtime;
  t.after(async () => { await runtime?.close(); await rm(temporary, { recursive: true, force: true }); });
  runtime = await startRuntime(dataDir);
  const request = async (url, options) => {
    const response = await fetch(`${runtime.base}${url}`, options);
    return { response, body: await response.json() };
  };
  const post = (url, body) => request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const home = await fetch(`${runtime.base}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /^text\/html/);
  const html = await home.text();
  const jsAsset = html.match(/src="([^"]+\.js)"/)?.[1];
  const cssAsset = html.match(/href="([^"]+\.css)"/)?.[1];
  assert.ok(jsAsset && cssAsset, 'The bundled client must reference built JS and CSS.');
  for (const [asset, type] of [[jsAsset, /javascript/], [cssAsset, /css/]]) {
    const response = await fetch(`${runtime.base}${asset}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), type);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  const clientRoute = await fetch(`${runtime.base}/editor/local-project`, { headers: { Accept: 'text/html' } });
  assert.equal(clientRoute.status, 200);
  assert.equal(await clientRoute.text(), html);
  for (const route of ['/api/nonexistent', '/assets/nonexistent.js', '/assets/nonexistent', '/media/nonexistent.mp4', '/exports/nonexistent.mp4']) {
    const response = await fetch(`${runtime.base}${route}`, { headers: { Accept: 'text/html' } });
    assert.equal(response.status, 404, route);
    assert.match(response.headers.get('content-type'), /application\/json/);
  }
  assert.equal((await fetch(`${runtime.base}/editor/local-project`, { method: 'POST', headers: { Accept: 'text/html' } })).status, 404);
  const health = await request('/api/health');
  assert.equal(health.body.ffmpegAvailable, true);
  assert.equal(health.body.ffprobeAvailable, true);

  const video = path.join(temporary, '导入素材.mp4');
  const music = path.join(temporary, '配乐.wav');
  await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=navy:s=320x180:r=30:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=2', '-c:a', 'pcm_s16le', music]);
  const originalSources = await Promise.all([video, music].map(async filename => hash(await readFile(filename))));
  const form = new FormData();
  for (const filename of [video, music]) form.append('files', new Blob([await readFile(filename)]), path.basename(filename));
  const imported = await request('/api/media', { method: 'POST', body: form });
  assert.equal(imported.response.status, 201, JSON.stringify(imported.body));
  assert.deepEqual(imported.body.media.map(item => item.name), ['导入素材.mp4', '配乐.wav']);
  const [picture, sound] = imported.body.media;
  const project = { ...newProject('桌面完整流程'), width: 320, height: 180, media: imported.body.media };
  project.clips = [
    { id: randomUUID(), mediaId: picture.id, track: 'video', start: 0, sourceStart: 0.2, duration: 1.2, speed: 1, volume: .25 },
    { id: randomUUID(), mediaId: sound.id, track: 'audio', start: 0, sourceStart: 0, duration: 1.2, speed: 1, volume: .5 },
  ];
  project.subtitles = [{ id: randomUUID(), text: '桌面版：工程保存与视频导出', start: .1, duration: 1, fontSize: 14, color: '#FFFFFF', position: 'bottom' }];
  const saved = await post('/api/projects', project);
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  const savedBytes = await readFile(path.join(dataDir, 'projects', `${project.id}.json`), 'utf8');
  assert.deepEqual(JSON.parse(savedBytes), saved.body.project);
  assert.equal((await readdir(path.join(dataDir, 'projects'))).some(name => name.endsWith('.tmp')), false);
  await runtime.close();
  runtime = undefined;
  runtime = await startRuntime(dataDir);
  const reopened = await request(`/api/projects/${project.id}`);
  assert.equal(reopened.response.status, 200);
  assert.deepEqual(reopened.body.project, saved.body.project);
  const storedVideo = await fetch(`${runtime.base}${picture.url}`);
  assert.equal(hash(Buffer.from(await storedVideo.arrayBuffer())), originalSources[0]);

  const exported = await post('/api/exports', { project: reopened.body.project, settings: { width: 320, height: 180, fps: 30, quality: 'standard' } });
  assert.equal(exported.response.status, 202, JSON.stringify(exported.body));
  let job;
  for (let count = 0; count < 500; count++) {
    job = (await request(`/api/exports/${exported.body.id}`)).body;
    if (['completed', 'failed', 'cancelled'].includes(job.status)) break;
    await delay(100);
  }
  assert.equal(job.status, 'completed', JSON.stringify(job));
  const download = await fetch(`${runtime.base}${job.url}`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-type'), /^video\/mp4/);
  assert.equal(download.headers.get('accept-ranges'), 'bytes');
  const output = path.join(temporary, '桌面验收.mp4');
  await writeFile(output, Buffer.from(await download.arrayBuffer()));
  const outputInfo = JSON.parse((await exec(ffprobePath, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', output])).stdout);
  assert.equal(outputInfo.streams.find(stream => stream.codec_type === 'video')?.codec_name, 'h264');
  assert.equal(outputInfo.streams.find(stream => stream.codec_type === 'audio')?.codec_name, 'aac');
  assert.ok(Math.abs(Number(outputInfo.format.duration) - 1.2) < .15);
  const ranged = await fetch(`${runtime.base}${job.url}`, { headers: { Range: 'bytes=0-63' } });
  assert.equal(ranged.status, 206);
  assert.match(ranged.headers.get('content-range'), /^bytes 0-63\//);
  assert.equal((await ranged.arrayBuffer()).byteLength, 64);
  const head = await fetch(`${runtime.base}${job.url}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('content-length')), (await readFile(output)).byteLength);

  // Closing while work is active must wait for cancellation and final cleanup.
  const pending = runtime.queue.enqueue(reopened.body.project, { width: 1280, height: 720, fps: 60, quality: 'high' });
  await new Promise(resolve => setImmediate(resolve));
  await runtime.queue.close();
  assert.equal(runtime.queue.get(pending.id).status, 'cancelled');
  assert.deepEqual(await readdir(path.join(dataDir, 'work')), []);
  assert.equal((await readdir(path.join(dataDir, 'exports'))).some(name => name.endsWith('.partial.mp4')), false);
  assert.throws(() => runtime.queue.enqueue(reopened.body.project, {}), /正在关闭/);
  for (let index = 0; index < 2; index++) assert.equal(hash(await readFile([video, music][index])), originalSources[index]);
  assert.deepEqual(await sourceSnapshot(sourceData), originalData, 'Desktop userData must never write the existing web data directory.');
  t.diagnostic('Verified built single-origin client/API, real Chinese-name multipart import, custom userData path, atomic project save, restart/reopen, subtitle+music H.264/AAC export, native-download headers/ranges, and awaited final cleanup.');
});
