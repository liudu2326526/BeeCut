import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import ffprobe from '@ffprobe-installer/ffprobe';
import { createApp } from '../server/index.mjs';
import { newProject, audioGainAt, splitClip, clipFades } from '../shared/model.mjs';

const exec = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const pixel = (frame, x, y) => [...frame.subarray((y * 320 + x) * 3, (y * 320 + x) * 3 + 3)];

test('layered projects persist compatible defaults and export transforms, RGB adjustments, opacity, and timeline audio fades', { timeout: 120000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'weijian-layers-'));
  const runtime = await createApp({ dataDir: path.join(root, 'library') });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await runtime.queue.close();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const files = ['red.mp4', 'blue.png', 'marker.png', 'tone.wav'].map(name => path.join(root, name));
  const make = args => exec(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  await make(['-f', 'lavfi', '-i', 'color=red:s=320x180:r=30:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', files[0]]);
  await make(['-f', 'lavfi', '-i', 'color=blue:s=320x180', '-frames:v', '1', files[1]]);
  await make(['-f', 'lavfi', '-i', 'color=blue:s=320x180,drawbox=x=0:y=0:w=80:h=45:color=lime:t=fill', '-frames:v', '1', files[2]]);
  await make(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-c:a', 'pcm_s16le', files[3]]);
  const form = new FormData();
  for (const file of files) form.append('files', new Blob([await readFile(file)]), path.basename(file));
  const imported = await fetch(`${base}/api/media`, { method: 'POST', body: form });
  assert.equal(imported.status, 201);
  const { media } = await imported.json();
  const [red, blue, marker, tone] = files.map(file => media.find(item => item.name === path.basename(file)));
  const project = { ...newProject('四轨画面 + 变换调色 + 音频淡入出'), width: 320, height: 180, media };
  const clip = (id, source, extra = {}) => ({ id, mediaId: source.id, track: 'video', start: 0, sourceStart: 0, duration: 3, speed: 1, volume: 1, ...extra });
  project.clips = [
    clip('background', red),
    clip('pip', blue, { start: .5, duration: 1.5, layer: 1, transform: { scale: .5, x: 40, y: -10, opacity: .5 }, adjustments: { brightness: 1.2, contrast: .8, saturation: 0 } }),
    clip('highest', marker, { start: 2, duration: .5, layer: 3, transform: { scale: .5, rotation: 90, flipX: true } }),
    clip('music', tone, { track: 'audio', duration: 3, volume: .8, fadeIn: .6, fadeOut: .6 }),
  ];
  project.subtitles = [{ id: 'subtitle', text: '字', start: 0, duration: .2, fontSize: 18, color: '#FFFFFF', position: 'bottom', outlineWidth: 0, outlineColor: '#33AAFF' }];
  const savedResponse = await fetch(`${base}/api/projects`, json(project));
  const saved = await savedResponse.json();
  assert.equal(savedResponse.status, 200, JSON.stringify(saved));
  const loaded = await (await fetch(`${base}/api/projects/${project.id}`)).json();
  assert.deepEqual(loaded.project, saved.project);
  assert.equal(loaded.project.clips[0].layer, 0, 'v0.2 missing layer defaults to the main track');
  assert.deepEqual(loaded.project.clips[0].transform, { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1, flipX: false, flipY: false });
  assert.deepEqual(loaded.project.clips[0].adjustments, { brightness: 1, contrast: 1, saturation: 1 });
  assert.equal(loaded.project.clips[0].fadeIn, 0);
  assert.equal(loaded.project.subtitles[0].outlineWidth, 0);
  for (const [label, mutate] of [
    ['same-layer overlap', p => { p.clips[1].layer = 0; }],
    ['out-of-range layer', p => { p.clips[1].layer = 4; }],
    ['fractional layer', p => { p.clips[1].layer = .5; }],
    ['singular transform', p => { p.clips[1].transform.scale = 0; }],
    ['malformed transform', p => { p.clips[1].transform = null; }],
    ['non-boolean flip', p => { p.clips[1].transform.flipX = 1; }],
    ['combined fades exceed duration', p => { p.clips[3].fadeIn = 2; p.clips[3].fadeOut = 2; }],
    ['invalid outline', p => { p.subtitles[0].outlineColor = 'red'; }],
  ]) {
    const invalid = structuredClone(project);
    mutate(invalid);
    const rejected = await fetch(`${base}/api/projects`, json(invalid));
    assert.equal(rejected.status, 400, label);
  }
  const exportResponse = await fetch(`${base}/api/exports`, json({ project, settings: { width: 320, height: 180, fps: 30 } }));
  let job = await exportResponse.json();
  assert.equal(exportResponse.status, 202, JSON.stringify(job));
  for (let attempt = 0; attempt < 400 && !['completed', 'failed', 'cancelled'].includes(job.status); attempt++) {
    await delay(50);
    job = await (await fetch(`${base}/api/exports/${job.id}`)).json();
  }
  assert.equal(job.status, 'completed', JSON.stringify(job));
  const output = path.join(root, 'composed.mp4');
  await writeFile(output, Buffer.from(await (await fetch(`${base}${job.url}`)).arrayBuffer()));
  const metadata = JSON.parse((await exec(ffprobe.path, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', output])).stdout);
  assert.equal(metadata.streams.find(item => item.codec_type === 'video').codec_name, 'h264');
  assert.equal(metadata.streams.find(item => item.codec_type === 'audio').codec_name, 'aac');
  assert.ok(Math.abs(Number(metadata.format.duration) - 3) < .1);
  const frameAt = async time => (await exec(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', output, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 1024 * 1024 })).stdout;
  const before = await frameAt(.3);
  assert.ok(pixel(before, 200, 80)[0] > 220, 'upper video does not appear before its timeline start');
  const composed = await frameAt(.9);
  const center = pixel(composed, 200, 80);
  assert.ok(center[0] > 130 && center[0] < 170 && center[1] > 10 && center[1] < 35 && Math.abs(center[1] - center[2]) < 8, `half-opaque CSS-style grayscale over red, got ${center}`);
  const outside = pixel(composed, 90, 80);
  assert.ok(outside[0] > 220 && outside[1] < 30 && outside[2] < 30, `scaled and translated layer preserves outside background, got ${outside}`);
  const top = await frameAt(2.2);
  const transformedMarker = pixel(top, 194, 150);
  assert.ok(transformedMarker[1] > 180 && transformedMarker[0] < 50 && transformedMarker[2] < 50, `90° clockwise rotation plus horizontal flip moves the source's green upper-left marker to lower-right, got ${transformedMarker}`);
  assert.ok(pixel(top, 160, 90)[2] > 180, 'highest layer renders in front of the background');
  const after = await frameAt(2.8);
  assert.ok(pixel(after, 194, 150)[0] > 220, 'ended layers release their last frame instead of freezing over later timeline');
  const pcm = (await exec(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-i', output, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 })).stdout;
  const rms = (start, seconds = .03) => {
    const first = Math.round(start * 48000), count = Math.round(seconds * 48000);
    let sum = 0;
    for (let index = first; index < first + count; index++) sum += pcm.readFloatLE(index * 4) ** 2;
    return Math.sqrt(sum / count);
  };
  const middle = rms(1.5);
  assert.ok(middle > .04, 'the retained music is audible');
  assert.ok(rms(.03) < middle * .2, 'fade-in affects encoded audio, not only preview');
  assert.ok(rms(2.94) < middle * .2, 'fade-out affects encoded audio, not only preview');
  t.diagnostic(`Encoded RGB blend=${center.join(',')}, transformed marker=${transformedMarker.join(',')}; measured early/middle/late PCM RMS=${rms(.03).toFixed(5)}/${middle.toFixed(5)}/${rms(2.94).toFixed(5)}.`);
});

test('audioGainAt uses timeline fades and splitting retains only the original outer fades', () => {
  const clip = { id: 'fade', start: 2, duration: 4, sourceStart: 1, speed: 2, volume: 1.5, fadeIn: 1, fadeOut: 1 };
  assert.equal(audioGainAt(clip, 1), 0);
  assert.equal(audioGainAt(clip, 2), 0);
  assert.equal(audioGainAt(clip, 2.5), .75);
  assert.equal(audioGainAt(clip, 4), 1.5);
  assert.equal(audioGainAt(clip, 5.5), .75);
  assert.equal(audioGainAt(clip, 6), 0);
  const [first, second] = splitClip(clip, 2.5);
  assert.deepEqual(clipFades(first), { fadeIn: .5, fadeOut: 0 });
  assert.deepEqual(clipFades(second), { fadeIn: 0, fadeOut: 1 });
  assert.equal(second.sourceStart, 2);
  assert.deepEqual(clipFades({ duration: 1, fadeIn: .7, fadeOut: .7 }), { fadeIn: .7, fadeOut: .30000000000000004 });
});
