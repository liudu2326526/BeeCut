import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';
import { ffmpegPath, ffprobePath } from '../server/process.mjs';
import { newProject, animationAlphaAt, clipAnimation, clipMask, maskGeometry, splitClip, inspectTransitions, reconcileTransitions, visualLayersAt, maxTransitionDuration, clipPictureEdges } from '../shared/model.mjs';

const exec = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const post = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('visual envelopes have their own time domain and split only retains outer animations', () => {
  const clip = { id: 'original', start: 2, duration: 4, sourceStart: 1, speed: 2, volume: .8, fadeIn: .5, fadeOut: .4, animation: { in: 1, out: 1 } };
  assert.deepEqual(clipAnimation({}), { in: 0, out: 0, inType: 'fade', outType: 'fade', easing: 'linear' });
  assert.equal(animationAlphaAt(clip, 1.9), 0);
  assert.equal(animationAlphaAt(clip, 2.25), .25);
  assert.equal(animationAlphaAt(clip, 4), 1);
  assert.equal(animationAlphaAt(clip, 5.75), .25);
  assert.equal(animationAlphaAt(clip, 6), 0);
  const [left, right] = splitClip(clip, 3.5);
  assert.deepEqual(left.animation, { in: 1, out: 0, inType: 'fade', outType: 'fade', easing: 'linear' });
  assert.deepEqual(right.animation, { in: 0, out: 1, inType: 'fade', outType: 'fade', easing: 'linear' });
  assert.equal(right.sourceStart, 4);
  assert.deepEqual(maskGeometry({ mask: { type: 'ellipse', x: .25, y: -.2, width: .5, height: .6, rotation: 90, feather: 30, invert: true } }, { width: 320, height: 180 }),
    { type: 'ellipse', cx: 240, cy: 54, width: 160, height: 108, rotation: 90, feather: 30, sigma: 10, padding: 30, invert: true });
});

test('centered transitions preserve pair identity and preview samples; reconciliation removes gaps and intersecting windows', () => {
  const a = { id: 'a', track: 'video', layer: 1, start: 0, duration: 2, transitionOut: { type: 'dissolve', duration: 1, nextClipId: 'b' } };
  const b = { id: 'b', track: 'video', layer: 1, start: 2, duration: 2 };
  const project = { fps: 30, clips: [b, a], subtitles: [] };
  assert.equal(inspectTransitions(project).invalid.length, 0);
  assert.equal(maxTransitionDuration(project, a), 4);
  const middle = visualLayersAt(project, 2)[0];
  assert.equal(middle.layer, 1);
  assert.deepEqual(middle.samples.map(sample => [sample.clip.id, sample.weight]), [['a', .5], ['b', .5]]);
  assert.equal(middle.samples[0].sampleTime, 2 - 1 / 30, 'outgoing preview holds the final frame beyond its original interval');
  assert.equal(middle.samples[1].sampleTime, 2, 'incoming preview holds its first frame before it starts');
  assert.equal(visualLayersAt(project, 1.75)[0].samples[1].sampleTime, 2);
  assert.equal(visualLayersAt(project, 2.25)[0].samples[0].sampleTime, 2 - 1 / 30);
  const moved = { ...project, clips: [a, { ...b, start: 3 }] };
  const reconciled = reconcileTransitions(moved);
  assert.equal(reconciled.removedCount, 1);
  assert.equal(reconciled.project.clips[0].transitionOut.type, 'none');
  assert.equal(moved.clips[0].transitionOut.type, 'dissolve', 'reconciliation is pure');
  const foreignNext = { ...project, clips: [a, { ...b, id: 'replacement' }] };
  assert.equal(reconcileTransitions(foreignNext).removedCount, 1, 'an adjacent replacement cannot inherit a transition that names another clip');
  const middleClip = { ...b, duration: .5, transitionOut: { type: 'dissolve', duration: 1, nextClipId: 'c' } };
  const conflicting = { ...project, clips: [a, middleClip, { ...b, id: 'c', start: 2.5, duration: 2 }] };
  assert.equal(inspectTransitions(conflicting).invalid.length, 2);
  assert.equal(reconcileTransitions(conflicting).removedCount, 2, 'conflicting half-windows remove both owners instead of silently changing their durations');
  const [left, right] = splitClip({ ...a, sourceStart: 0, speed: 1 }, 1);
  assert.equal(left.transitionOut.type, 'none');
  assert.equal(right.transitionOut.nextClipId, 'b', 'splitting retains the outgoing transition only on the right fragment');
  assert.equal(clipPictureEdges({ start: 2, duration: .95 }, 30).last, 88 / 30, 'non-integral frame durations hold absolute project-grid frame 88 strictly inside the clip');
});

test('real API exports preserve ellipse, rotated rectangle, inverted/feathered masks, native alpha, and independent visual fades', { timeout: 120000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'weijian-v04-'));
  const runtime = await createApp({ dataDir: path.join(root, 'library') });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await runtime.queue.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const make = args => exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  const files = ['green.png', 'blue.mp4', 'transparent.png'].map(name => path.join(root, name));
  await make(['-f', 'lavfi', '-i', 'color=lime:s=320x180', '-frames:v', '1', files[0]]);
  await make(['-f', 'lavfi', '-i', 'color=blue:s=320x180:r=30:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', files[1]]);
  const rgba = Buffer.alloc(320 * 180 * 4);
  for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) {
    const offset = (y * 320 + x) * 4;
    rgba[offset + 2] = 255;
    rgba[offset + 3] = x < 160 ? 255 : 0;
  }
  const raw = path.join(root, 'alpha.rgba');
  await writeFile(raw, rgba);
  await make(['-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', '320x180', '-i', raw, '-frames:v', '1', files[2]]);
  const form = new FormData();
  for (const filename of files) form.append('files', new Blob([await readFile(filename)]), path.basename(filename));
  const response = await fetch(`${origin}/api/media`, { method: 'POST', body: form });
  const { media } = await response.json();
  assert.equal(response.status, 201);
  const project = { ...newProject('圆形矩形蒙版与画面动画'), width: 320, height: 180, media };
  const clip = (id, index, extra) => ({ id, mediaId: media[index].id, track: 'video', start: 0, sourceStart: 0, duration: 1, speed: 1, volume: 0, ...extra });
  project.clips = [
    clip('base', 0, { duration: 7 }),
    clip('ellipse', 1, { layer: 1, mask: { type: 'ellipse', width: .5, height: .8 } }),
    clip('rotated', 1, { layer: 1, start: 1, mask: { type: 'rectangle', x: .2, width: .5, height: .2, rotation: 90 } }),
    clip('inverse', 1, { layer: 1, start: 2, mask: { type: 'ellipse', width: .5, height: .8, invert: true } }),
    clip('feather', 1, { layer: 1, start: 3, mask: { type: 'rectangle', width: .5, height: .5, feather: 30 } }),
    clip('animated', 1, { layer: 1, start: 4, duration: 2, volume: .8, transform: { opacity: .8 }, animation: { in: .5, out: .5 } }),
    clip('native-alpha', 2, { layer: 1, start: 6, mask: { type: 'ellipse', width: .5, height: .8 } }),
  ];
  const savedResponse = await fetch(`${origin}/api/projects`, post(project));
  const saved = await savedResponse.json();
  assert.equal(savedResponse.status, 200, JSON.stringify(saved));
  const loaded = await (await fetch(`${origin}/api/projects/${project.id}`)).json();
  assert.deepEqual(loaded.project, saved.project);
  assert.deepEqual(loaded.project.clips[0].animation, clipAnimation({}));
  assert.deepEqual(loaded.project.clips[0].mask, clipMask({}));
  for (const [label, mutate] of [
    ['unsupported mask', p => { p.clips[1].mask.type = 'star'; }],
    ['zero width', p => { p.clips[1].mask.width = 0; }],
    ['negative feather', p => { p.clips[1].mask.feather = -1; }],
    ['oversized feather', p => { p.clips[1].mask.feather = 201; }],
    ['nonboolean inversion', p => { p.clips[1].mask.invert = 'yes'; }],
    ['bad mask object', p => { p.clips[1].mask = []; }],
    ['overlapping visual fades', p => { p.clips[5].animation = { in: 1.1, out: 1.1 }; }],
    ['nonfinite animation', p => { p.clips[5].animation.in = null; }],
    ['audio mask', p => { p.clips[1].track = 'audio'; p.clips[1].layer = 0; }],
  ]) {
    const invalid = structuredClone(project); mutate(invalid);
    const rejected = await fetch(`${origin}/api/projects`, post(invalid));
    assert.equal(rejected.status, 400, label);
  }
  const exported = await fetch(`${origin}/api/exports`, post({ project: loaded.project, settings: { width: 320, height: 180, fps: 30 } }));
  let job = await exported.json();
  assert.equal(exported.status, 202, JSON.stringify(job));
  for (let attempt = 0; attempt < 800 && !['completed', 'failed', 'cancelled'].includes(job.status); attempt++) {
    await pause(50); job = await (await fetch(`${origin}/api/exports/${job.id}`)).json();
  }
  assert.equal(job.status, 'completed', JSON.stringify(job));
  const output = path.join(root, 'mask-animation.mp4');
  await writeFile(output, Buffer.from(await (await fetch(`${origin}${job.url}`)).arrayBuffer()));
  const metadata = JSON.parse((await exec(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output])).stdout);
  assert.ok(Math.abs(Number(metadata.format.duration) - 7) < .1, 'visual effects preserve timeline duration');
  const frameAt = async time => (await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', output, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 1024 * 1024 })).stdout;
  const pixel = (frame, x, y) => [...frame.subarray((y * 320 + x) * 3, (y * 320 + x) * 3 + 3)];
  const blue = rgb => rgb[2] > 210 && rgb[0] < 30 && rgb[1] < 30;
  const green = rgb => rgb[1] > 210 && rgb[0] < 30 && rgb[2] < 30;
  const ellipse = await frameAt(.5);
  assert.ok(blue(pixel(ellipse, 160, 90)) && green(pixel(ellipse, 40, 90)), 'ellipse exposes its center and preserves the lower layer outside');
  const rotated = await frameAt(1.5);
  assert.ok(blue(pixel(rotated, 224, 30)) && green(pixel(rotated, 160, 90)), '90 degree clockwise rectangle uses positioned project coordinates');
  const inverse = await frameAt(2.5);
  assert.ok(green(pixel(inverse, 160, 90)) && blue(pixel(inverse, 40, 90)), 'inversion exchanges inside and outside alpha');
  const feather = await frameAt(3.5);
  const edge = pixel(feather, 80, 90), inner = pixel(feather, 120, 90), outer = pixel(feather, 40, 90);
  assert.ok(edge[1] > 75 && edge[1] < 180 && edge[2] > 75 && edge[2] < 180, `feather creates a partially transparent boundary, got ${edge}`);
  assert.ok(blue(inner) && green(outer), 'feather does not blur the image RGB or unrelated background');
  const enter = pixel(await frameAt(4.25), 160, 90), middle = pixel(await frameAt(5), 160, 90), exit = pixel(await frameAt(5.75), 160, 90);
  assert.ok(enter[2] > 85 && enter[2] < 125 && enter[1] > 125, `entry opacity multiplies base .8 rather than replacing it, got ${enter}`);
  assert.ok(middle[2] > 185 && middle[2] < 220 && middle[1] > 35 && middle[1] < 70, `middle retains configured opacity, got ${middle}`);
  assert.ok(exit[2] > 80 && exit[2] < 120 && exit[1] > 125, `exit fades the picture, got ${exit}`);
  const alpha = await frameAt(6.5);
  assert.ok(blue(pixel(alpha, 130, 90)) && green(pixel(alpha, 190, 90)) && green(pixel(alpha, 40, 90)), 'mask multiplies existing PNG alpha instead of replacing it');
  const pcm = (await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', output, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 })).stdout;
  const rms = start => {
    let sum = 0; const first = Math.round(start * 48000), count = 1440;
    for (let i = first; i < first + count; i++) sum += pcm.readFloatLE(i * 4) ** 2;
    return Math.sqrt(sum / count);
  };
  const early = rms(4.03), steady = rms(4.9), late = rms(5.94);
  assert.ok(steady > .04 && early > steady * .8 && late > steady * .8, `visual fades leave original audio audible, RMS ${early}/${steady}/${late}`);
  t.diagnostic(`Real exported mask feather edge=${edge}; entry/middle/exit RGB=${enter}/${middle}/${exit}; unchanged audio RMS=${early.toFixed(5)}/${steady.toFixed(5)}/${late.toFixed(5)}.`);
});

test('real four-layer export dissolves premultiplied alpha around unchanged cuts, holds edge frames, and keeps original audio timing', { timeout: 120000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'weijian-v04-transition-'));
  const runtime = await createApp({ dataDir: path.join(root, 'library') });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await runtime.queue.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const make = args => exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  const files = ['red.mp4', 'blue.mp4', 'green.png', 'white.png', 'yellow.png'].map(name => path.join(root, name));
  for (let i = 0; i < 2; i++) await make(['-f', 'lavfi', '-i', `color=${i ? 'blue' : 'red'}:s=320x180:r=30:d=2`, '-f', 'lavfi', '-i', `sine=frequency=${i ? 880 : 440}:sample_rate=48000:duration=2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', files[i]]);
  for (const [i, color] of [[2, 'lime'], [3, 'white'], [4, 'yellow']]) await make(['-f', 'lavfi', '-i', `color=${color}:s=320x180`, '-frames:v', '1', files[i]]);
  const form = new FormData();
  for (const filename of files) form.append('files', new Blob([await readFile(filename)]), path.basename(filename));
  const importResponse = await fetch(`${origin}/api/media`, { method: 'POST', body: form });
  const { media } = await importResponse.json();
  assert.equal(importResponse.status, 201);
  const clip = (id, index, extra = {}) => ({ id, mediaId: media[index].id, track: 'video', start: 0, sourceStart: 0, duration: 2, speed: 1, volume: 0, ...extra });
  const project = { ...newProject('透明叠化与音频边界'), width: 320, height: 180, media, clips: [
    clip('base', 2, { duration: 6 }),
    clip('a', 0, { layer: 1, volume: .6, transform: { opacity: .5 }, transitionOut: { type: 'dissolve', duration: 1, nextClipId: 'b' } }),
    clip('b', 1, { layer: 1, start: 2, volume: .6, transitionOut: { type: 'dissolve', duration: .5, nextClipId: 'c' } }),
    clip('c', 3, { layer: 1, start: 4, duration: 1 }),
    clip('small-white', 3, { layer: 2, duration: 5, transform: { scale: .1, x: -120, y: -60 } }),
    clip('highest-yellow', 4, { layer: 3, duration: 5, transform: { scale: .1, x: 120, y: -60 } }),
  ] };
  const save = await fetch(`${origin}/api/projects`, post(project));
  const saved = await save.json();
  assert.equal(save.status, 200, JSON.stringify(saved));
  assert.equal(saved.project.clips[0].transitionOut.type, 'none', 'older clips have no transition by default');
  const loaded = await (await fetch(`${origin}/api/projects/${project.id}`)).json();
  assert.deepEqual(loaded.project, saved.project);
  for (const [label, mutate] of [
    ['gap', p => { p.clips[2].start = 2.1; p.clips[2].duration = 1.9; }],
    ['wrong target identity', p => { p.clips[1].transitionOut.nextClipId = 'c'; }],
    ['unknown target', p => { p.clips[1].transitionOut.nextClipId = 'gone'; }],
    ['cross-layer target', p => { p.clips[2].layer = 2; }],
    ['unavailable handles', p => { p.clips[1].transitionOut.duration = 5; }],
    ['neighbor windows overlap', p => { p.clips[2].transitionOut.duration = 4; }],
    ['invalid transition object', p => { p.clips[1].transitionOut = null; }],
    ['none keeps target', p => { p.clips[1].transitionOut.type = 'none'; }],
  ]) {
    const invalid = structuredClone(project); mutate(invalid);
    const rejected = await fetch(`${origin}/api/projects`, post(invalid));
    assert.equal(rejected.status, 400, label);
  }
  const response = await fetch(`${origin}/api/exports`, post({ project: loaded.project, settings: { width: 320, height: 180, fps: 30 } }));
  let job = await response.json();
  assert.equal(response.status, 202, JSON.stringify(job));
  for (let attempt = 0; attempt < 800 && !['completed', 'failed', 'cancelled'].includes(job.status); attempt++) {
    await pause(50); job = await (await fetch(`${origin}/api/exports/${job.id}`)).json();
  }
  assert.equal(job.status, 'completed', JSON.stringify(job));
  const output = path.join(root, 'dissolve.mp4');
  await writeFile(output, Buffer.from(await (await fetch(`${origin}${job.url}`)).arrayBuffer()));
  const metadata = JSON.parse((await exec(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output])).stdout);
  const video = metadata.streams.find(stream => stream.codec_type === 'video');
  assert.equal(Number(video.nb_frames), 180);
  assert.ok(Math.abs(Number(metadata.format.duration) - 6) < .1, 'transitions never shorten or extend the project');
  const frameAt = async time => (await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', output, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 1024 * 1024 })).stdout;
  const pixel = (frame, x = 160, y = 90) => [...frame.subarray((y * 320 + x) * 3, (y * 320 + x) * 3 + 3)];
  const before = pixel(await frameAt(1));
  assert.ok(before[0] > 110 && before[0] < 145 && before[1] > 110 && before[1] < 145 && before[2] < 20, `half-red alpha before transition covers green correctly: ${before}`);
  const middleFrame = await frameAt(2), middle = pixel(middleFrame);
  assert.ok(middle[0] > 53 && middle[0] < 76 && middle[1] > 53 && middle[1] < 76 && middle[2] > 119 && middle[2] < 139, `premultiplied midpoint retains red/green/blue contributions on the actual cut frame instead of dark double-over or a repeated preceding frame: ${middle}`);
  assert.ok(pixel(middleFrame, 40, 30).every(value => value > 220), 'layer 2 remains above a layer 1 transition');
  const yellow = pixel(middleFrame, 280, 30);
  assert.ok(yellow[0] > 220 && yellow[1] > 220 && yellow[2] < 30, 'layer 3 remains above all transitions');
  const after = pixel(await frameAt(3));
  assert.ok(after[2] > 220 && after[0] < 30 && after[1] < 30, `incoming blue continues after the centered window: ${after}`);
  const secondCut = pixel(await frameAt(4));
  assert.ok(secondCut[0] > 114 && secondCut[0] < 139 && secondCut[1] > 114 && secondCut[1] < 139 && secondCut[2] > 220, `a second transition on the same clip reaches its midpoint at the cut: ${secondCut}`);
  const ended = pixel(await frameAt(5.5));
  assert.ok(ended[1] > 220 && ended[0] < 30 && ended[2] < 30, `ended transition sources do not freeze over the remaining background: ${ended}`);
  const pcm = (await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', output, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 })).stdout;
  const amplitude = (start, frequency) => {
    const first = Math.round(start * 48000), count = 2400; let real = 0, imaginary = 0;
    for (let i = 0; i < count; i++) { const sample = pcm.readFloatLE((first + i) * 4), angle = 2 * Math.PI * frequency * i / 48000; real += sample * Math.cos(angle); imaginary += sample * Math.sin(angle); }
    return Math.hypot(real, imaginary) / count;
  };
  assert.ok(amplitude(1.9, 440) > amplitude(1.9, 880) * 10, 'incoming picture may appear before the cut, but incoming audio does not');
  assert.ok(amplitude(2.1, 880) > amplitude(2.1, 440) * 10, 'outgoing picture is held after the cut, but outgoing audio does not extend');
  t.diagnostic(`Actual centered premultiplied dissolve RGB=${middle}; second cut=${secondCut}; ended=${ended}; 440/880Hz amplitudes before=${amplitude(1.9, 440).toFixed(5)}/${amplitude(1.9, 880).toFixed(5)}, after=${amplitude(2.1, 440).toFixed(5)}/${amplitude(2.1, 880).toFixed(5)}.`);
});

test('transition edge snapshots follow the project picture clock when exporting at another FPS, including short fades and a moving tail', { timeout: 120000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'weijian-v04-edge-clock-'));
  const runtime = await createApp({ dataDir: path.join(root, 'library') });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await runtime.queue.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const source = path.join(root, 'moving-tail.mp4'), green = path.join(root, 'green.png');
  await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', "color=red:s=320x180:r=60:d=3,drawbox=x=0:y=0:w=iw:h=ih:color=blue:t=fill:enable='gte(t,2.975)'", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source]);
  await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=lime:s=320x180', '-frames:v', '1', green]);
  const form = new FormData();
  for (const filename of [source, green]) form.append('files', new Blob([await readFile(filename)]), path.basename(filename));
  const imported = await fetch(`${origin}/api/media`, { method: 'POST', body: form });
  const { media } = await imported.json();
  assert.equal(imported.status, 201);
  const results = [];
  for (const [projectFps, outputFps] of [[30, 60], [60, 30], [30, 24]]) {
    const project = { ...newProject(`边缘时钟 ${projectFps}→${outputFps}`), width: 320, height: 180, fps: projectFps, media, clips: [
      { id: 'base', mediaId: media[1].id, track: 'video', start: 0, sourceStart: 0, duration: 6, speed: 1, volume: 0 },
      { id: 'a', mediaId: media[0].id, track: 'video', layer: 1, start: 0, sourceStart: 0, duration: 3, speed: 1, volume: 0, animation: { in: 0, out: .04 }, mask: { type: 'rectangle', width: .8, height: .8 }, transitionOut: { type: 'dissolve', duration: 1, nextClipId: 'b' } },
      { id: 'b', mediaId: media[1].id, track: 'video', layer: 1, start: 3, sourceStart: 0, duration: 3, speed: 1, volume: 0, transform: { opacity: 0 } },
    ] };
    const samples = visualLayersAt(project, 3.25).find(layer => layer.layer === 1).samples;
    const old = samples.find(sample => sample.clip.id === 'a');
    const expectedAlpha = animationAlphaAt(old.clip, old.sampleTime) * old.weight;
    assert.ok(Math.abs(expectedAlpha - (projectFps === 30 ? 5 / 24 : 5 / 48)) < 1e-8);
    const response = await fetch(`${origin}/api/exports`, post({ project, settings: { width: 320, height: 180, fps: outputFps } }));
    let job = await response.json();
    assert.equal(response.status, 202, JSON.stringify(job));
    for (let attempt = 0; attempt < 800 && !['completed', 'failed', 'cancelled'].includes(job.status); attempt++) {
      await pause(50); job = await (await fetch(`${origin}/api/exports/${job.id}`)).json();
    }
    assert.equal(job.status, 'completed', JSON.stringify(job));
    const output = path.join(root, `edge-${projectFps}-${outputFps}.mp4`);
    await writeFile(output, Buffer.from(await (await fetch(`${origin}${job.url}`)).arrayBuffer()));
    const raw = (await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', '3.25', '-i', output, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 1024 * 1024 })).stdout;
    const rgb = [...raw.subarray((90 * 320 + 160) * 3, (90 * 320 + 160) * 3 + 3)];
    const channel = projectFps === 30 ? 0 : 2;
    assert.ok(Math.abs(rgb[channel] - 255 * expectedAlpha) < 8, `${projectFps}→${outputFps} snapshot has project-clock animation alpha, expected ${expectedAlpha}, got ${rgb}`);
    assert.ok(rgb[2 - channel] < 12, `${projectFps}→${outputFps} holds the project tail's color rather than choosing another output-clock frame, got ${rgb}`);
    assert.ok(Math.abs(rgb[1] - 255 * (1 - expectedAlpha)) < 9, 'uncovered lower layer retains its expected alpha contribution');
    results.push(`${projectFps}→${outputFps}=${rgb}`);
  }
  t.diagnostic(`Moving final frame + 40ms exit animation at t=3.25: ${results.join('; ')}.`);
});

test('fractional transition windows reconnect without an uncovered or displaced frame at 24, 30, 60 and 29.97 fps', { timeout: 120000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'weijian-v04-frame-boundary-'));
  const runtime = await createApp({ dataDir: path.join(root, 'library') });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await runtime.queue.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const files = ['blue', 'red'].map(color => path.join(root, `${color}.mp4`));
  for (let i = 0; i < files.length; i++) await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=${i ? 'red' : 'blue'}:s=320x180:r=30:d=3`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', files[i]]);
  const form = new FormData();
  for (const filename of files) form.append('files', new Blob([await readFile(filename)]), path.basename(filename));
  const imported = await fetch(`${origin}/api/media`, { method: 'POST', body: form });
  const { media } = await imported.json();
  assert.equal(imported.status, 201);
  const results = [];
  for (const [fps, transitionDuration] of [[30, .5], [24, .55], [60, .55], [29.97, .5]]) {
    const project = { ...newProject(`帧边界 ${fps}`), width: 320, height: 180, media, clips: [
      { id: 'a', mediaId: media[0].id, track: 'video', start: 0, sourceStart: 0, duration: 3, speed: 1, volume: 0, transitionOut: { type: 'dissolve', duration: transitionDuration, nextClipId: 'b' } },
      { id: 'b', mediaId: media[1].id, track: 'video', start: 3, sourceStart: 0, duration: 3, speed: 1, volume: 0 },
    ] };
    const response = await fetch(`${origin}/api/exports`, post({ project, settings: { width: 320, height: 180, fps, quality: 'high' } }));
    let job = await response.json();
    assert.equal(response.status, 202, JSON.stringify(job));
    for (let attempt = 0; attempt < 800 && !['completed', 'failed', 'cancelled'].includes(job.status); attempt++) {
      await pause(50); job = await (await fetch(`${origin}/api/exports/${job.id}`)).json();
    }
    assert.equal(job.status, 'completed', JSON.stringify(job));
    const output = path.join(root, `boundary-${fps}.mp4`);
    await writeFile(output, Buffer.from(await (await fetch(`${origin}${job.url}`)).arrayBuffer()));
    // Decode the whole sequence once, then retain the same central pixel for
    // every frame. Seeking to a few timestamps would miss the original hole.
    const raw = (await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', output, '-vf', 'format=rgb24,crop=1:1:160:90', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 4096 })).stdout;
    const frameCount = Math.ceil(6 * fps - .00001);
    assert.equal(raw.length, frameCount * 3);
    const start = Math.round((3 - transitionDuration / 2) * fps), end = Math.round((3 + transitionDuration / 2) * fps);
    for (let frame = 0; frame < frameCount; frame++) {
      const rgb = [...raw.subarray(frame * 3, frame * 3 + 3)];
      assert.ok(Math.max(...rgb) > 100 && rgb[1] < 20, `fps ${fps} frame ${frame} must never expose an uncovered black/foreign frame: ${rgb}`);
      const progress = frame < start ? 0 : frame >= end ? 1 : Math.max(0, Math.min(1, (frame / fps - (3 - transitionDuration / 2)) / transitionDuration));
      assert.ok(Math.abs(rgb[0] - 253 * progress) < 12 && Math.abs(rgb[2] - 253 * (1 - progress)) < 12,
        `fps ${fps} frame ${frame} transition weight is attached to that integer frame, expected p=${progress}, got ${rgb}`);
    }
    const reconnect = [...raw.subarray(end * 3, end * 3 + 3)];
    assert.ok(reconnect[0] > 235 && reconnect[2] < 15, `first incoming normal frame ${end} must reconnect directly to red, got ${reconnect}`);
    results.push(`${fps}fps:${frameCount} frames/reconnect${end}=${reconnect}`);
  }
  t.diagnostic(`Every decoded frame checked: ${results.join('; ')}.`);
});
