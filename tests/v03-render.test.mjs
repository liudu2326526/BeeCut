import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';
import { ffmpegPath, ffprobePath } from '../server/process.mjs';
import { newProject } from '../shared/model.mjs';

const exec = promisify(execFile);
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const post = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('four simultaneous layers retain native PNG alpha and flipY through scaled export, with drawn subtitle outlines and source-video fades', { timeout: 120000 }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'weijian-v03-independent-'));
  const runtime = await createApp({ dataDir: path.join(dir, 'library') });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await runtime.queue.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const make = args => exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  const video = path.join(dir, '原声与变速.mp4');
  const blue = path.join(dir, '蓝色.png');
  const green = path.join(dir, '绿色.png');
  const transparent = path.join(dir, '透明标记.png');
  const rgbaFile = path.join(dir, 'transparent.rgba');
  await make(['-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=30:d=5', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  await make(['-f', 'lavfi', '-i', 'color=c=blue:s=320x180', '-frames:v', '1', blue]);
  await make(['-f', 'lavfi', '-i', 'color=c=lime:s=320x180', '-frames:v', '1', green]);
  const rgba = Buffer.alloc(320 * 180 * 4);
  for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) {
    // Bright cyan RGB under zero alpha catches accidental loss of PNG transparency.
    const visible = x < 160 && y < 90;
    const offset = (y * 320 + x) * 4;
    rgba[offset] = visible ? 255 : 0;
    rgba[offset + 1] = 255;
    rgba[offset + 2] = visible ? 0 : 255;
    rgba[offset + 3] = visible ? 255 : 0;
  }
  await writeFile(rgbaFile, rgba);
  await make(['-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', '320x180', '-i', rgbaFile, '-frames:v', '1', transparent]);
  const form = new FormData();
  for (const filename of [video, blue, green, transparent]) form.append('files', new Blob([await readFile(filename)]), path.basename(filename));
  const imported = await fetch(`${origin}/api/media`, { method: 'POST', body: form });
  const importedBody = await imported.json();
  assert.equal(imported.status, 201, JSON.stringify(importedBody));
  const media = importedBody.media;
  assert.deepEqual(media.map(item => item.type), ['video', 'image', 'image', 'image']);
  const project = { ...newProject('独立验收：四层、透明 PNG 与纵向翻转'), width: 320, height: 180, media };
  const clip = (id, index, extra) => ({ id, mediaId: media[index].id, track: 'video', start: 0, sourceStart: 0, duration: 2, speed: 1, volume: 0, ...extra });
  // The array is deliberately out of z-order: rendering must follow layer identity.
  project.clips = [
    clip('upper-alpha', 3, { layer: 3, transform: { scale: .5, x: 80, flipY: true } }),
    clip('bottom-source', 0, { layer: 0, sourceStart: .2, speed: 2, volume: .8, fadeIn: .5, fadeOut: .5 }),
    clip('green', 2, { layer: 2, transform: { scale: .25, x: 80 } }),
    clip('blue-alpha', 1, { layer: 1, transform: { scale: .5, x: 80, opacity: .5 } }),
  ];
  project.subtitles = [{ id: 'outlined', text: 'X', start: 1, duration: .8, fontSize: 40, color: '#FFFFFF', position: 'center', outlineWidth: 8, outlineColor: '#00FF00' }];
  const save = await fetch(`${origin}/api/projects`, post(project));
  const savedBody = await save.json();
  assert.equal(save.status, 200, JSON.stringify(savedBody));
  const reopen = await (await fetch(`${origin}/api/projects/${project.id}`)).json();
  assert.deepEqual(reopen.project, savedBody.project);
  assert.equal(reopen.project.clips[0].transform.flipY, true);
  assert.equal(reopen.project.subtitles[0].outlineWidth, 8);

  const exported = await fetch(`${origin}/api/exports`, post({ project: reopen.project, settings: { width: 640, height: 360, fps: 30 } }));
  let job = await exported.json();
  assert.equal(exported.status, 202, JSON.stringify(job));
  for (let attempt = 0; attempt < 800 && !['completed', 'failed', 'cancelled'].includes(job.status); attempt++) {
    await pause(50);
    job = await (await fetch(`${origin}/api/exports/${job.id}`)).json();
  }
  assert.equal(job.status, 'completed', JSON.stringify(job));
  const output = path.join(dir, 'four-layers.mp4');
  await writeFile(output, Buffer.from(await (await fetch(`${origin}${job.url}`)).arrayBuffer()));
  const metadata = JSON.parse((await exec(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output])).stdout);
  const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
  assert.equal(videoStream.codec_name, 'h264');
  assert.equal(videoStream.width, 640);
  assert.equal(videoStream.height, 360);
  assert.equal(metadata.streams.find(stream => stream.codec_type === 'audio')?.codec_name, 'aac');
  assert.ok(Math.abs(Number(metadata.format.duration) - 2) < .1);
  const frameAt = async time => (await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', output, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 1024 * 1024 })).stdout;
  const frame = await frameAt(.75);
  const pixel = (x, y, source = frame) => [...source.subarray((Math.round(y * 2) * 640 + Math.round(x * 2)) * 3, (Math.round(y * 2) * 640 + Math.round(x * 2)) * 3 + 3)];
  const base = pixel(80, 90), blueBlend = pixel(300, 90), greenLayer = pixel(250, 80), yellowMarker = pixel(220, 100), aboveMarker = pixel(180, 60);
  assert.ok(base[0] > 220 && base[1] < 30 && base[2] < 30, `base remains red outside scaled overlays, got ${base}`);
  assert.ok(blueBlend[0] > 100 && blueBlend[0] < 155 && blueBlend[1] < 30 && blueBlend[2] > 100 && blueBlend[2] < 155, `50% blue over red survives final 2x scale and transparent upper PNG, got ${blueBlend}`);
  assert.ok(greenLayer[1] > 220 && greenLayer[0] < 30 && greenLayer[2] < 30, `layer 2 covers layer 1 through transparent layer 3, got ${greenLayer}`);
  assert.ok(yellowMarker[0] > 220 && yellowMarker[1] > 220 && yellowMarker[2] < 30, `vertical flip moves opaque PNG marker below center and above layer 2, got ${yellowMarker}`);
  assert.ok(aboveMarker[0] > 100 && aboveMarker[0] < 155 && aboveMarker[1] < 30 && aboveMarker[2] > 100, `upper-left source marker must disappear from its unflipped position, got ${aboveMarker}`);

  const withText = await frameAt(1.25);
  let whiteFill = 0, greenOutline = 0;
  for (let y = 60; y < 120; y++) for (let x = 140; x < 180; x++) {
    const [r, g, b] = pixel(x, y, withText);
    if (r > 210 && g > 210 && b > 210) whiteFill++;
    if (r < 60 && g > 180 && b < 60) greenOutline++;
  }
  assert.ok(whiteFill > 80, `subtitle white glyph is burned into exported video, counted ${whiteFill}`);
  assert.ok(greenOutline > 150, `configured green outline is visibly burned into exported video, counted ${greenOutline}`);

  const pcm = (await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', output, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { encoding: 'buffer', maxBuffer: 1024 * 1024 })).stdout;
  const rms = (start, seconds = .03) => {
    const first = Math.round(start * 48000), count = Math.round(seconds * 48000);
    let sum = 0;
    for (let index = first; index < first + count; index++) sum += pcm.readFloatLE(index * 4) ** 2;
    return Math.sqrt(sum / count);
  };
  const early = rms(.025), middle = rms(.8), late = rms(1.94);
  assert.ok(middle > .04, 'Source-video audio remains audible after 2x playback speed.');
  assert.ok(early < middle * .2, `source-video fade-in uses timeline seconds after source trim/speed: ${early}/${middle}`);
  assert.ok(late < middle * .2, `source-video fade-out uses timeline seconds after source trim/speed: ${late}/${middle}`);
  t.diagnostic(`Actual 640x360 export RGB base/blend/green/flipped-marker=${[base, blueBlend, greenLayer, yellowMarker].map(value => value.join(',')).join(' / ')}; subtitle fill/outline=${whiteFill}/${greenOutline}; source-video RMS=${early.toFixed(5)}/${middle.toFixed(5)}/${late.toFixed(5)}.`);
});
