import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

// This verifies the already-running, installed app. It never launches a dev
// server or imports a server/FFmpeg module from the source checkout.
const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};
const packageMetadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const expectedVersion = option('version', packageMetadata.version);
const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replaceAll('-', '');
const appPath = path.resolve(option('app', path.join(homedir(), 'Applications', 'BeeCut.app')));
const runtimeFile = path.resolve(option('runtime', path.join(homedir(), 'Library', 'Application Support', '微剪', 'runtime.json')));
const artifacts = path.resolve(option('artifacts', path.join(root, 'artifacts', `mac-desktop-v${expectedVersion}-${date}`)));
const projectName = option('project-name', `桌面包API验收-${expectedVersion}-${date}`);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = { startedAt: new Date().toISOString(), expectedVersion, appPath, runtimeFile, stages: [] };
await fs.mkdir(artifacts, { recursive: true });

async function verify() {
  const runtime = JSON.parse(await fs.readFile(runtimeFile, 'utf8'));
  assert.equal(runtime.appVersion, expectedVersion, `Verification requires the installed ${expectedVersion} desktop app.`);
  assert.ok(Number.isSafeInteger(runtime.pid) && runtime.pid > 0);
  const url = new URL(runtime.origin);
  assert.equal(url.protocol, 'http:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.origin, runtime.origin);
  assert.ok(url.port && !['4173', '4318'].includes(url.port), 'The app must own its private dynamic port.');
  const executableName = (await exec('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', path.join(appPath, 'Contents', 'Info.plist')])).stdout.trim();
  const expectedExecutable = await fs.realpath(path.join(appPath, 'Contents', 'MacOS', executableName));
  // BSD ps escapes non-ASCII process names under the C locale. Ask the producer
  // for UTF-8 rather than attempting to reinterpret its display escaping.
  const processPath = (await exec('/bin/ps', ['-ww', '-p', String(runtime.pid), '-o', 'comm='], { env: { ...process.env, LC_ALL: 'en_US.UTF-8' } })).stdout.trim();
  assert.equal(await fs.realpath(processPath), expectedExecutable, 'runtime.json must belong to the actual installed app process.');
  const listener = (await exec('/usr/sbin/lsof', ['-nP', '-a', '-p', String(runtime.pid), '-iTCP:' + url.port, '-sTCP:LISTEN', '-Fn'])).stdout;
  assert.ok(listener.split('\n').includes(`p${runtime.pid}`));
  assert.ok(listener.split('\n').includes(`n127.0.0.1:${url.port}`), 'The same desktop PID must own the runtime HTTP listener.');
  const expectedLibrary = path.join(path.dirname(runtimeFile), 'Library');
  assert.equal(await fs.realpath(runtime.dataDir), await fs.realpath(expectedLibrary));
  const version = (await exec('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(appPath, 'Contents', 'Info.plist')])).stdout.trim();
  assert.equal(version, runtime.appVersion);
  const unpacked = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules');
  const ffmpeg = path.join(unpacked, '@ffmpeg-installer', 'darwin-arm64', 'ffmpeg');
  const ffprobe = path.join(unpacked, '@ffprobe-installer', 'darwin-arm64', 'ffprobe');
  const ffmpegVersion = (await exec(ffmpeg, ['-version'])).stdout.split('\n')[0];
  const ffprobeVersion = (await exec(ffprobe, ['-version'])).stdout.split('\n')[0];
  Object.assign(results, { runtime, processPath, listener, ffmpeg, ffprobe, ffmpegVersion, ffprobeVersion });
  results.stages.push('installed PID, dynamic loopback listener, userData, app version and bundled native executables');

  const api = async (route, options) => {
    const response = await fetch(new URL(route, runtime.origin), { ...options, signal: AbortSignal.timeout(30000) });
    const body = await response.json();
    return { response, body };
  };
  const post = (route, data) => api(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const health = await api('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.ffmpegAvailable, true);
  assert.equal(health.body.ffprobeAvailable, true);
  assert.equal(health.body.filters.drawtext, true);
  results.health = health.body;
  const home = await fetch(runtime.origin, { signal: AbortSignal.timeout(30000) });
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /^text\/html/);
  const html = await home.text();
  const script = html.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(script, 'Installed UI must load its compiled client.');
  assert.equal((await fetch(new URL(script, runtime.origin))).status, 200);
  for (const route of ['/api/not-a-real-endpoint', '/assets/not-a-real-asset.js']) {
    const missing = await fetch(new URL(route, runtime.origin), { headers: { Accept: 'text/html' } });
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get('content-type'), /application\/json/);
  }
  results.stages.push('installed single-origin UI, media-engine health and API/asset 404s');

  const registryBefore = JSON.parse(await fs.readFile(path.join(runtime.dataDir, 'media.json'), 'utf8'));
  const projectFilesBefore = await fs.readdir(path.join(runtime.dataDir, 'projects'));
  const originalProjects = new Map(await Promise.all(projectFilesBefore.filter(name => name.endsWith('.json')).map(async name => [name, sha256(await fs.readFile(path.join(runtime.dataDir, 'projects', name)))])));
  const videoPath = path.join(artifacts, '桌面包验收素材.mp4');
  const musicPath = path.join(artifacts, '桌面包验收配乐.wav');
  await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', "color=c=red:s=320x180:r=30:d=2,drawbox=color=blue:x=0:y=0:w=iw:h=ih:t=fill:enable='gte(t,1)'", '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', videoPath]);
  await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=2', '-c:a', 'pcm_s16le', musicPath]);
  const fixtureHashes = await Promise.all([videoPath, musicPath].map(async filename => sha256(await fs.readFile(filename))));
  const form = new FormData();
  for (const filename of [videoPath, musicPath]) form.append('files', new Blob([await fs.readFile(filename)]), path.basename(filename));
  const imported = await api('/api/media', { method: 'POST', body: form });
  assert.equal(imported.response.status, 201, JSON.stringify(imported.body));
  assert.equal(imported.body.media.length, 2);
  assert.deepEqual(imported.body.media.map(media => media.name), ['桌面包验收素材.mp4', '桌面包验收配乐.wav']);
  const [picture, sound] = imported.body.media;
  assert.equal(picture.type, 'video');
  assert.equal(sound.type, 'audio');
  assert.equal((await fetch(new URL(picture.thumbnailUrl, runtime.origin))).status, 200);
  results.imported = imported.body.media;
  results.stages.push('bundled-FFmpeg fixture generation and real multipart media import');

  const now = new Date().toISOString();
  const project = { id: randomUUID(), version: 1, name: projectName, width: 320, height: 180, fps: 30, createdAt: now, updatedAt: now, media: imported.body.media,
    clips: [
      { id: randomUUID(), mediaId: picture.id, track: 'video', start: 0, sourceStart: .1, duration: .7, speed: 1, volume: .25 },
      { id: randomUUID(), mediaId: picture.id, track: 'video', start: .7, sourceStart: 1, duration: .9, speed: 1, volume: .25 },
      { id: randomUUID(), mediaId: sound.id, track: 'audio', start: 0, sourceStart: 0, duration: 1.6, speed: 1, volume: .5 },
    ], subtitles: [{ id: randomUUID(), text: 'BeeCut 桌面版 · 保存与导出验收', start: .1, duration: 1.4, fontSize: 14, color: '#FFFFFF', position: 'bottom' }],
  };
  assert.equal(projectFilesBefore.includes(`${project.id}.json`), false);
  const saved = await post('/api/projects', project);
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  const savedPath = path.join(runtime.dataDir, 'projects', `${project.id}.json`);
  assert.deepEqual(JSON.parse(await fs.readFile(savedPath, 'utf8')), saved.body.project);
  assert.equal((await fs.readdir(path.dirname(savedPath))).some(name => name.startsWith(project.id) && name.endsWith('.tmp')), false);
  const reopened = await api(`/api/projects/${project.id}`);
  assert.equal(reopened.response.status, 200);
  assert.deepEqual(reopened.body.project, saved.body.project);
  results.project = { id: project.id, name: project.name, path: savedPath, saved: true, reopened: true };
  await fs.writeFile(path.join(artifacts, 'installed-desktop-project.json'), JSON.stringify(saved.body.project, null, 2));
  results.stages.push('new isolated project atomic save and exact HTTP reopen from installed userData');

  const exported = await post('/api/exports', { project: reopened.body.project, settings: { width: 320, height: 180, fps: 30, quality: 'standard' } });
  assert.equal(exported.response.status, 202, JSON.stringify(exported.body));
  let job;
  for (let count = 0; count < 600; count++) {
    job = (await api(`/api/exports/${exported.body.id}`)).body;
    if (['completed', 'failed', 'cancelled'].includes(job.status)) break;
    await delay(100);
  }
  assert.equal(job.status, 'completed', JSON.stringify(job));
  assert.equal(job.progress, 100);
  const download = await fetch(new URL(job.url, runtime.origin));
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-type'), /^video\/mp4/);
  const outputPath = path.join(artifacts, `${projectName.replace(/[\\/<>:"|?*\u0000-\u001f]/g, '_')}.mp4`);
  const outputBytes = Buffer.from(await download.arrayBuffer());
  await fs.writeFile(outputPath, outputBytes);
  const outputInfo = JSON.parse((await exec(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', outputPath])).stdout);
  const videoStream = outputInfo.streams.find(stream => stream.codec_type === 'video');
  const audioStream = outputInfo.streams.find(stream => stream.codec_type === 'audio');
  assert.equal(videoStream.codec_name, 'h264');
  assert.equal(videoStream.width, 320);
  assert.equal(videoStream.height, 180);
  assert.equal(audioStream.codec_name, 'aac');
  assert.ok(Math.abs(Number(outputInfo.format.duration) - 1.6) < .15);
  for (const [seconds, channel] of [[.25, 0], [1.1, 2]]) {
    const sample = (await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(seconds), '-i', outputPath, '-frames:v', '1', '-vf', 'crop=8:8:0:0,scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' })).stdout;
    assert.ok(sample[channel] > 180 && sample[(channel + 1) % 3] < 70 && sample[(channel + 2) % 3] < 70, 'Source trim/split must appear in the actual exported picture.');
  }
  const subtitleFrame = path.join(artifacts, '桌面包API验收-字幕帧.png');
  await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '0.3', '-i', outputPath, '-frames:v', '1', subtitleFrame]);
  const pcm = (await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', '0.15', '-i', outputPath, '-t', '0.2', '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { encoding: 'buffer' })).stdout;
  const audioChecks = [];
  for (const [frequency, label] of [[220, 'added music'], [440, 'source video audio']]) {
    let real = 0, imaginary = 0;
    const samples = pcm.length / 4;
    for (let index = 0; index < samples; index++) {
      const sample = pcm.readFloatLE(index * 4);
      real += sample * Math.cos(2 * Math.PI * frequency * index / 48000);
      imaginary += sample * Math.sin(2 * Math.PI * frequency * index / 48000);
    }
    const amplitude = 2 * Math.hypot(real, imaginary) / samples;
    assert.ok(amplitude > .002, `Actual export must contain audible ${label}.`);
    audioChecks.push({ frequency, label, amplitude });
  }
  const ranges = await fetch(new URL(job.url, runtime.origin), { headers: { Range: 'bytes=0-63' } });
  assert.equal(ranges.status, 206);
  assert.equal((await ranges.arrayBuffer()).byteLength, 64);
  const head = await fetch(new URL(job.url, runtime.origin), { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('content-length')), outputBytes.byteLength);
  results.export = { job, outputPath, subtitleFrame, sha256: sha256(outputBytes), size: outputBytes.byteLength, probe: outputInfo, audioChecks, rangeStatus: ranges.status, headStatus: head.status };
  results.stages.push('installed engine H.264/AAC subtitle+music export, visible source cut, actual mixed audio and range/HEAD download');

  const registryAfter = JSON.parse(await fs.readFile(path.join(runtime.dataDir, 'media.json'), 'utf8'));
  for (const item of registryBefore) assert.deepEqual(registryAfter.find(candidate => candidate.id === item.id), item, 'Existing media registry entries must remain unchanged.');
  for (const [filename, digest] of originalProjects) assert.equal(sha256(await fs.readFile(path.join(runtime.dataDir, 'projects', filename))), digest, 'Existing project files must remain unchanged.');
  for (let index = 0; index < fixtureHashes.length; index++) assert.equal(sha256(await fs.readFile([videoPath, musicPath][index])), fixtureHashes[index]);
  assert.deepEqual(JSON.parse(await fs.readFile(runtimeFile, 'utf8')), runtime, 'The same installed process must remain active throughout verification.');
  results.preservation = { existingMediaCount: registryBefore.length, existingProjectCount: originalProjects.size, passed: true, apiProjectAndImportedMediaRetained: true };
  results.stages.push('pre-existing media records/projects and fixture source bytes preserved; same desktop instance retained');
  results.completedAt = new Date().toISOString();
  results.passed = true;
  const filename = path.join(artifacts, 'installed-desktop-api-result.json');
  await fs.writeFile(filename, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: true, origin: runtime.origin, pid: runtime.pid, projectId: project.id, projectName: project.name, outputPath, resultPath: filename }, null, 2));
}

try { await verify(); }
catch (error) {
  results.passed = false;
  results.failedAt = new Date().toISOString();
  results.error = { message: error.message, stack: error.stack };
  await fs.writeFile(path.join(artifacts, 'installed-desktop-api-failure.json'), JSON.stringify(results, null, 2));
  console.error(error);
  process.exitCode = 1;
}
