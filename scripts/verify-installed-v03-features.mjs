import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Uses only the actual installed application's listener and shipped binaries.
// Extends the isolated project created by verify-installed-desktop.mjs, never
// selects the GUI project and never launches an application or dev server.
const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1]; };
const artifacts = path.resolve(option('artifacts', path.join(root, 'artifacts/v03-release-20261017/installed-api')));
const receiptPath = path.join(artifacts, 'installed-desktop-api-result.json');
const baseReceipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
const result = { startedAt: new Date().toISOString(), kind: 'actual installed v0.3 API feature acceptance; not GUI', stages: [] };
const digest = value => createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function verify() {
  assert.equal(baseReceipt.passed, true);
  const runtimeFile = path.join(homedir(), 'Library/Application Support/微剪/runtime.json');
  const runtime = JSON.parse(await fs.readFile(runtimeFile, 'utf8'));
  assert.deepEqual(runtime, baseReceipt.runtime, 'The same actual installed process must still be running');
  assert.equal(runtime.appVersion, '0.3.0');
  const origin = new URL(runtime.origin);
  assert.equal(origin.protocol, 'http:');
  assert.equal(origin.hostname, '127.0.0.1');
  const executable = await fs.realpath(path.join(baseReceipt.appPath, 'Contents/MacOS/微剪'));
  const processPath = (await exec('/bin/ps', ['-ww', '-p', String(runtime.pid), '-o', 'comm='], { env: { ...process.env, LC_ALL: 'en_US.UTF-8' } })).stdout.trim();
  assert.equal(await fs.realpath(processPath), executable);
  const listener = (await exec('/usr/sbin/lsof', ['-nP', '-a', '-p', String(runtime.pid), `-iTCP:${origin.port}`, '-sTCP:LISTEN', '-Fn'])).stdout;
  assert.ok(listener.split('\n').includes(`p${runtime.pid}`));
  assert.ok(listener.split('\n').includes(`n127.0.0.1:${origin.port}`));
  Object.assign(result, { runtime, processPath, listener, baseReceipt: receiptPath });
  const api = async (route, options) => {
    const response = await fetch(new URL(route, runtime.origin), { ...options, signal: AbortSignal.timeout(30000) });
    return { response, body: await response.json() };
  };
  const owned = (await api(`/api/projects/${baseReceipt.project.id}`)).body.project;
  assert.equal(owned.name, baseReceipt.project.name, 'Only the isolated API acceptance project may be extended');
  assert.ok(owned.name.startsWith('桌面包API验收-0.3.0-'));
  const projectDir = path.join(runtime.dataDir, 'projects');
  const otherProjects = new Map();
  for (const filename of await fs.readdir(projectDir)) if (filename.endsWith('.json') && filename !== `${owned.id}.json`) otherProjects.set(filename, digest(await fs.readFile(path.join(projectDir, filename))));
  const registryBefore = JSON.parse(await fs.readFile(path.join(runtime.dataDir, 'media.json'), 'utf8'));
  const tools = path.join(baseReceipt.appPath, 'Contents/Resources/app.asar.unpacked/node_modules');
  const ffmpeg = path.join(tools, '@ffmpeg-installer/darwin-arm64/ffmpeg');
  const ffprobe = path.join(tools, '@ffprobe-installer/darwin-arm64/ffprobe');
  result.stages.push('same installed PID, dynamic loopback listener and isolated API-project ownership');

  const fixtureDir = path.join(artifacts, 'v03-feature-fixtures');
  await fs.mkdir(fixtureDir, { recursive: true });
  const files = ['红色原声.mp4', '蓝色画面.png', '翻转标记.png', '配乐淡入出.wav'].map(name => path.join(fixtureDir, name));
  const make = args => exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  await make(['-f', 'lavfi', '-i', 'color=red:s=320x180:r=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', files[0]]);
  await make(['-f', 'lavfi', '-i', 'color=blue:s=320x180', '-frames:v', '1', files[1]]);
  await make(['-f', 'lavfi', '-i', 'color=blue:s=320x180,drawbox=x=0:y=0:w=80:h=45:color=lime:t=fill', '-frames:v', '1', files[2]]);
  await make(['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=3', '-c:a', 'pcm_s16le', files[3]]);
  const fixtureHashes = await Promise.all(files.map(async file => digest(await fs.readFile(file))));
  const form = new FormData();
  for (const file of files) form.append('files', new Blob([await fs.readFile(file)]), path.basename(file));
  const imported = await api('/api/media', { method: 'POST', body: form });
  assert.equal(imported.response.status, 201, JSON.stringify(imported.body));
  const [red, blue, marker, tone] = files.map(file => imported.body.media.find(media => media.name === path.basename(file)));
  assert.ok(red.hasAudio);
  const clip = (media, extra = {}) => ({ id: randomUUID(), mediaId: media.id, track: 'video', start: 0, sourceStart: 0, duration: 3, speed: 1, volume: 0, ...extra });
  const project = { ...owned, width: 320, height: 180, fps: 30, media: [...owned.media, ...imported.body.media], clips: [
    clip(marker, { layer: 3, start: 2, duration: .5, transform: { scale: .5, rotation: 90, flipX: true } }),
    clip(red, { layer: 0, volume: .25, fadeIn: .6, fadeOut: .6 }),
    clip(blue, { layer: 1, start: .5, duration: 1.5, transform: { scale: .5, x: 40, y: -10, opacity: .5 }, adjustments: { brightness: 1.2, contrast: .8, saturation: 0 } }),
    clip(marker, { layer: 2, start: .8, duration: .2, transform: { scale: .2, x: -100, y: -50, flipY: true } }),
    clip(marker, { layer: 3, start: .8, duration: .2, transform: { scale: .1, x: 110, y: 60 } }),
    clip(tone, { track: 'audio', volume: .4, fadeIn: .6, fadeOut: .6 }),
  ], subtitles: [{ id: randomUUID(), text: '包验证', start: 0, duration: 3, fontSize: 12, color: '#FFFFFF', position: 'bottom', outlineWidth: 2, outlineColor: '#33AAFF' }] };
  const saved = await api('/api/projects', json(project));
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  const reopened = await api(`/api/projects/${project.id}`);
  assert.deepEqual(reopened.body.project, saved.body.project);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(projectDir, `${project.id}.json`), 'utf8')), saved.body.project);
  assert.equal(reopened.body.project.clips[2].transform.opacity, .5);
  assert.equal(reopened.body.project.clips[2].adjustments.saturation, 0);
  assert.equal(reopened.body.project.subtitles[0].outlineWidth, 2);
  await fs.writeFile(path.join(artifacts, 'installed-v03-feature-project.json'), JSON.stringify(saved.body.project, null, 2));
  result.project = { id: project.id, name: project.name, path: path.join(projectDir, `${project.id}.json`), saved: true, reopened: true, layers: [0, 1, 2, 3], clipCount: project.clips.length, newlyImportedMedia: imported.body.media };
  result.stages.push('bundled-FFmpeg fixtures, real multipart import, all new fields saved and exact API/disk reopen');

  const exported = await api('/api/exports', json({ project: reopened.body.project, settings: { width: 640, height: 360, fps: 30, quality: 'high' } }));
  assert.equal(exported.response.status, 202, JSON.stringify(exported.body));
  let job;
  for (let count = 0; count < 600; count++) {
    job = (await api(`/api/exports/${exported.body.id}`)).body;
    if (['completed', 'failed', 'cancelled'].includes(job.status)) break;
    await delay(100);
  }
  assert.equal(job.status, 'completed', JSON.stringify(job));
  const output = path.join(artifacts, '桌面包0.3真实多轨导出.mp4');
  const bytes = Buffer.from(await (await fetch(new URL(job.url, runtime.origin))).arrayBuffer());
  await fs.writeFile(output, bytes);
  const probe = JSON.parse((await exec(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', output])).stdout);
  const video = probe.streams.find(stream => stream.codec_type === 'video');
  assert.deepEqual([video.codec_name, video.width, video.height], ['h264', 640, 360]);
  assert.equal(probe.streams.find(stream => stream.codec_type === 'audio').codec_name, 'aac');
  assert.ok(Math.abs(Number(probe.format.duration) - 3) < .1);
  const frame = async time => (await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', output, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 })).stdout;
  const pixel = (raw, x, y) => [...raw.subarray(((y * 2) * 640 + x * 2) * 3, ((y * 2) * 640 + x * 2) * 3 + 3)];
  const early = await frame(.3);
  assert.ok(pixel(early, 200, 80)[0] > 220);
  const allLayers = await frame(.9);
  const blend = pixel(allLayers, 200, 80), verticalFlip = pixel(allLayers, 36, 53), topLayer = pixel(allLayers, 258, 143), outside = pixel(allLayers, 90, 80);
  assert.ok(blend[0] > 130 && blend[0] < 170 && blend[1] > 10 && blend[1] < 35 && Math.abs(blend[1] - blend[2]) < 8, `RGB adjustment and opacity blend: ${blend}`);
  for (const sample of [verticalFlip, topLayer]) assert.ok(sample[1] > 180 && sample[0] < 50 && sample[2] < 50, `Expected transformed green marker: ${sample}`);
  assert.ok(outside[0] > 220 && outside[1] < 30 && outside[2] < 30);
  const rotatedFrame = await frame(2.2), rotation = pixel(rotatedFrame, 194, 150);
  assert.ok(rotation[1] > 180 && rotation[0] < 50 && rotation[2] < 50, `90-degree clockwise and horizontal flip: ${rotation}`);
  const after = await frame(2.8);
  assert.ok(pixel(after, 194, 150)[0] > 220, 'Ended layer must not freeze its final frame');
  const outlinePixels = Array.from({ length: 640 * 360 }, (_, index) => allLayers.subarray(index * 3, index * 3 + 3)).filter(([r, g, b], index) => index >= 280 * 640 && b > 150 && g > 80 && r < 120).length;
  assert.ok(outlinePixels > 10, 'Blue subtitle outline must be present in encoded picture');
  const screenshot = path.join(artifacts, '桌面包0.3真实多轨导出-帧.png');
  await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '0.9', '-i', output, '-frames:v', '1', screenshot]);
  const pcm = (await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', output, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 })).stdout;
  const rms = start => {
    const first = Math.round(start * 48000), count = 1440;
    let sum = 0;
    for (let index = first; index < first + count; index++) sum += pcm.readFloatLE(index * 4) ** 2;
    return Math.sqrt(sum / count);
  };
  const levels = { early: rms(.03), middle: rms(1.5), late: rms(2.94) };
  assert.ok(levels.middle > .02);
  assert.ok(levels.early < levels.middle * .2 && levels.late < levels.middle * .2, 'Timeline fades must affect actual mixed source/video and music AAC');
  result.export = { outputPath: output, screenshot, job, sha256: digest(bytes), bytes: bytes.length, probe, pixels: { blend, verticalFlip, topLayer, outside, rotation }, outlinePixels, rms: levels };
  result.stages.push('actual packaged H.264/AAC: four overlapping layers, RGB blend, position, rotation, two flips, subtitle outline and mixed-audio fades');

  for (const [filename, sha256] of otherProjects) assert.equal(digest(await fs.readFile(path.join(projectDir, filename))), sha256, `Existing project changed: ${filename}`);
  const registryAfter = JSON.parse(await fs.readFile(path.join(runtime.dataDir, 'media.json'), 'utf8'));
  for (const media of registryBefore) assert.deepEqual(registryAfter.find(candidate => candidate.id === media.id), media);
  for (let index = 0; index < files.length; index++) assert.equal(digest(await fs.readFile(files[index])), fixtureHashes[index]);
  assert.deepEqual(JSON.parse(await fs.readFile(runtimeFile, 'utf8')), runtime);
  result.preservation = { passed: true, otherProjectFiles: otherProjects.size, existingMediaRecords: registryBefore.length, onlyPreviouslyCreatedApiProjectUpdated: project.id, sameDesktopInstance: true };
  result.stages.push('other projects, existing media records and fixture bytes preserved; same installed process');
  Object.assign(result, { passed: true, completedAt: new Date().toISOString() });
}

try {
  await verify();
  const reportPath = path.join(artifacts, 'installed-v03-feature-result.json');
  await fs.writeFile(reportPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: true, pid: result.runtime.pid, origin: result.runtime.origin, projectId: result.project.id, export: result.export.outputPath, pixels: result.export.pixels, rms: result.export.rms, reportPath }, null, 2));
} catch (error) {
  Object.assign(result, { passed: false, failedAt: new Date().toISOString(), error: { message: error.message, stack: error.stack } });
  await fs.writeFile(path.join(artifacts, 'installed-v03-feature-failure.json'), JSON.stringify(result, null, 2));
  console.error(error);
  process.exitCode = 1;
}
