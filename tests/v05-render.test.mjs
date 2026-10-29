import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';
import { ffmpegPath } from '../server/process.mjs';
import { MAX_TRANSFORM_KEYS, newProject, clipTransform, clipTiming, sourceTimeAt, sourceRateAt, changeClipTiming, trimClip, splitClip, transformAt, pictureTransformAt, upsertTransformKey, removeTransformKey, transformKeyNavigation, animationAlphaAt, visualLayersAt } from '../shared/model.mjs';
const exec = promisify(execFile);
const post = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const key = (id, time, values, easing = 'linear') => ({ id, time, values: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1, ...values }, easing });

test('key slices preserve eased motion and alpha; timing edits map source spans once and keep split ownership', () => {
  const clip = { id: 'a', start: 2, sourceStart: 1, duration: 5, speed: 1, speedSegments: [{ sourceDuration: 2, speed: 2 }, { sourceDuration: 2, speed: .5 }], transformKeys: [key('k0', 0, { opacity: .2 }, 'easeInOut'), key('k1', 5, { scale: 2, x: 100, opacity: .8 })], animation: { in: .5, out: .5, inType: 'fade', outType: 'zoom', easing: 'easeInOut' }, transitionOut: { type: 'wipeRight', duration: .5, nextClipId: 'b' } };
  assert.deepEqual(clipTiming(clip).segments.map(s => [s.start, s.duration]), [[0, 1], [1, 4]]);
  near(sourceTimeAt(clip, 2.5), 2); near(sourceTimeAt(clip, 4), 3.5);
  assert.equal(sourceRateAt(clip, 2.99), 2); assert.equal(sourceRateAt(clip, 3), .5);
  const [a, b] = splitClip(clip, 4.25, { duration: 8 });
  near(b.sourceStart, 3.625); near(clipTiming(a).sourceEnd, b.sourceStart); near(clipTiming(b).sourceEnd, 5);
  assert.equal(a.transitionOut.type, 'none'); assert.equal(b.transitionOut.nextClipId, 'b');
  for (let i = 0; i <= 100; i++) {
    const t = 2 + i / 20;
    const actual = transformAt(t < b.start ? a : b, t), expected = transformAt(clip, t);
    for (const field of ['scale', 'x', 'y', 'rotation', 'opacity']) near(actual[field], expected[field]);
  }
  const trimmed = trimClip(clip, { start: 2.6, end: 6.4 }, { duration: 8 });
  for (let i = 0; i <= 38; i++) near(transformAt(trimmed, 2.6 + i / 10).x, transformAt(clip, 2.6 + i / 10).x);
  const regular = changeClipTiming(clip, { speed: 4 }, { duration: 8 });
  near(regular.duration, 1); near(clipTiming(regular).sourceDuration, 4); assert.deepEqual(regular.speedSegments, []);
  near(regular.transformKeys.at(-1).time, 1);
  const edge = trimClip({ ...clip, start: 8, sourceStart: .1, duration: 1, speed: .3, speedSegments: [], transformKeys: [] }, { start: 8 - .1 / .3 }, { duration: 8 });
  assert.ok(edge.sourceStart >= 0);
  const minimum = trimClip({ ...clip, start: 8, duration: 1, speed: 1, speedSegments: [], transformKeys: [] }, { end: 8.04 }, { duration: 8 });
  assert.equal(minimum.duration, .04);
  const tiny = changeClipTiming({ ...clip, transformKeys: [], speedSegments: [], duration: .04, speed: .25 }, { speed: 4 }, { duration: 8 });
  near(tiny.duration, .04); near(tiny.speed, .25);
  const shifted = changeClipTiming(clip, { sourceStart: 7 }, { duration: 8 });
  near(clipTiming(shifted).sourceEnd, 8); near(shifted.duration, .5);
  const moved = changeClipTiming(clip, { start: 10 }, { duration: 8 });
  near(sourceTimeAt(moved, 12), sourceTimeAt(clip, 4));
  const added = upsertTransformKey(clip, 3.1, { x: 40 });
  assert.equal(transformKeyNavigation(added, 3.1).current.values.x, 40);
  const one = { ...clip, transformKeys: [key('only', 2, { opacity: .3 })] };
  assert.equal(removeTransformKey(one, 'only', 3).transform.opacity, .3);
  near(animationAlphaAt(clip, 2.25) * transformAt(clip, 2.25).opacity, .5 * transformAt(clip, 2.25).opacity);
  const slide = { ...clip, transformKeys: [], animation: { in: 1, out: 0, inType: 'slideRight', outType: 'fade' } };
  near(pictureTransformAt(slide, 2.5, { width: 320 }).x, 160);
});

async function harness(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'weijian-v05-'));
  const runtime = await createApp({ dataDir: path.join(root, 'library') });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await runtime.queue.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const make = args => exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  const importFiles = async files => {
    const form = new FormData();
    for (const file of files) form.append('files', new Blob([await readFile(file)]), path.basename(file));
    const response = await fetch(`${origin}/api/media`, { method: 'POST', body: form });
    const body = await response.json(); assert.equal(response.status, 201, JSON.stringify(body)); return body.media;
  };
  const save = async project => {
    const response = await fetch(`${origin}/api/projects`, post(project)); const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    const reopened = await (await fetch(`${origin}/api/projects/${project.id}`)).json(); assert.deepEqual(reopened.project, body.project); return body.project;
  };
  const render = async project => {
    const response = await fetch(`${origin}/api/exports`, post({ project, settings: { width: 320, height: 180, fps: 30 } }));
    let job = await response.json(); assert.equal(response.status, 202, JSON.stringify(job));
    for (let i = 0; i < 1000 && !['completed', 'failed'].includes(job.status); i++) { await pause(20); job = await (await fetch(`${origin}/api/exports/${job.id}`)).json(); }
    assert.equal(job.status, 'completed', JSON.stringify(job));
    const file = path.join(root, `${job.id}.mp4`); await writeFile(file, Buffer.from(await (await fetch(`${origin}${job.url}`)).arrayBuffer())); return file;
  };
  const frames = async file => (await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 })).stdout;
  const pcm = async file => (await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 })).stdout;
  return { root, origin, make, importFiles, save, render, frames, pcm };
}
const pixel = (frames, n, x, y) => [...frames.subarray((n * 320 * 180 + y * 320 + x) * 3, (n * 320 * 180 + y * 320 + x) * 3 + 3)];
const dominant = (rgb, channel) => rgb[channel] > 210 && rgb[(channel + 1) % 3] < 40 && rgb[(channel + 2) % 3] < 40;

test('real API dynamic keys and all four animation types preserve RGBA geometry, opacity and saved state', { timeout: 120000 }, async t => {
  const h = await harness(t);
  const blue = path.join(h.root, 'blue.png'), green = path.join(h.root, 'green.png');
  await h.make(['-f', 'lavfi', '-i', 'color=blue:s=320x180', '-frames:v', '1', blue]);
  await h.make(['-f', 'lavfi', '-i', 'color=lime:s=320x180', '-frames:v', '1', green]);
  const media = await h.importFiles([blue, green]);
  const base = { id: 'base', mediaId: media[1].id, track: 'video', start: 0, sourceStart: 0, duration: 10, speed: 1, volume: 0 };
  const moving = { id: 'motion', mediaId: media[0].id, track: 'video', layer: 1, start: 0, sourceStart: 0, duration: 2, speed: 1, volume: 0,
    transformKeys: [key('begin', 0, { scale: .25, x: -80, y: -25, opacity: .3 }, 'easeInOut'), key('end', 2, { scale: .5, x: 80, y: 25, rotation: 90, opacity: .9 })], animation: { in: .4, out: .4, inType: 'fade', outType: 'fade', easing: 'easeInOut' } };
  const project = { ...newProject('关键帧与四类动画'), width: 320, height: 180, media, clips: [base, moving,
    ...['fade', 'slideLeft', 'slideRight', 'zoom'].map((type, i) => ({ id: `preset${i}`, mediaId: media[0].id, track: 'video', layer: 1, start: 2 + 2 * i, sourceStart: 0, duration: 2, speed: 1, volume: 0,
      transform: { scale: .5, opacity: .8 }, animation: { in: .8, out: .8, inType: type, outType: type, easing: 'linear' } }))] };
  const saved = await h.save(project);
  assert.deepEqual(saved.clips[0].transformKeys, []); assert.deepEqual(saved.clips[0].speedSegments, []);
  for (const mutate of [p => p.clips[1].transformKeys[0].phase = [1, 0], p => p.clips[1].transformKeys[1].time = 0, p => p.clips[1].transformKeys[1].time = Number.MIN_VALUE, p => p.clips[1].animation.inType = 'spin', p => p.clips[1].transformKeys[0].values.opacity = 2]) {
    const bad = structuredClone(saved); mutate(bad); const result = await fetch(`${h.origin}/api/projects`, post(bad)); assert.equal(result.status, 400);
  }
  const over = structuredClone(saved);
  over.clips[0].transformKeys = Array.from({ length: MAX_TRANSFORM_KEYS }, (_, i) => key(`limit${i}`, 10 * i / (MAX_TRANSFORM_KEYS - 1), {}));
  const rejected = await fetch(`${h.origin}/api/projects`, post(over));
  assert.equal(rejected.status, 400); assert.match(JSON.stringify(await rejected.json()), /关键帧总数/);
  const file = await h.render(saved), frames = await h.frames(file);
  assert.equal(frames.length / (320 * 180 * 3), 300);
  for (const n of [6, 15, 30, 45, 54]) {
    const time = n / 30, pose = pictureTransformAt(moving, time, project);
    const rgb = pixel(frames, n, Math.round(160 + pose.x), Math.round(90 + pose.y));
    const opacity = pose.opacity * animationAlphaAt(moving, time);
    near(rgb[2], 255 * opacity, 10); near(rgb[1], 255 * (1 - opacity), 10);
    const bounds = [];
    for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) if (pixel(frames, n, x, y)[2] > 25) bounds.push([x, y]);
    const xs = bounds.map(p => p[0]), ys = bounds.map(p => p[1]);
    const angle = pose.rotation * Math.PI / 180;
    const expectedHeight = pose.scale * (320 * Math.abs(Math.sin(angle)) + 180 * Math.abs(Math.cos(angle)));
    near((Math.min(...xs) + Math.max(...xs)) / 2, 160 + pose.x, 3);
    near((Math.min(...ys) + Math.max(...ys)) / 2, (Math.max(0, 90 + pose.y - expectedHeight / 2) + Math.min(179, 90 + pose.y + expectedHeight / 2)) / 2, 3);
    near(Math.max(...xs) - Math.min(...xs) + 1, pose.scale * (320 * Math.abs(Math.cos(angle)) + 180 * Math.abs(Math.sin(angle))), 7);
  }
  // The same real key-opacity/fade composition survives a split inside the
  // eased interval and a trim inside the steady part of both preset envelopes.
  for (const edited of [splitClip(moving, 1.1, media[0]), [trimClip(moving, { start: .5, end: 1.5 }, media[0])]]) {
    const branch = { ...project, id: crypto.randomUUID(), clips: [{ ...base, duration: 2 }, ...edited] };
    const branchFrames = await h.frames(await h.render(await h.save(branch)));
    assert.equal(branchFrames.length / (320 * 180 * 3), 60);
    for (let n = 0; n < 60; n++) {
      const time = n / 30, active = edited.find(c => time >= c.start && time < c.start + c.duration);
      if (!active) continue;
      const pose = pictureTransformAt(moving, time, project), alpha = pose.opacity * animationAlphaAt(moving, time);
      near(pixel(branchFrames, n, Math.round(160 + pose.x), Math.round(90 + pose.y))[2], 255 * alpha, 12);
    }
  }
  for (let i = 0; i < 4; i++) {
    const c = project.clips[i + 2], n = Math.round((c.start + .4) * 30), pose = pictureTransformAt(c, n / 30, project);
    const x = Math.round(160 + pose.x), y = 90;
    if (x >= 0 && x < 320) near(pixel(frames, n, x, y)[2], 255 * pose.opacity * animationAlphaAt(c, n / 30), 10);
    assert.ok(dominant(pixel(frames, Math.round((c.start + 1) * 30), 160, 90), 2) || pixel(frames, Math.round((c.start + 1) * 30), 160, 90)[2] > 190);
  }
});

test('piecewise speed exports every frame without boundary holes and retains source-marker timing and audio pitch after split', { timeout: 120000 }, async t => {
  const h = await harness(t), source = path.join(h.root, 'source.mp4');
  await h.make(['-f', 'lavfi', '-i', 'color=red:s=320x180:r=30:d=2', '-f', 'lavfi', '-i', 'color=blue:s=320x180:r=30:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=2', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v];[2:a][3:a]concat=n=2:v=0:a=1[a]', '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
  const media = await h.importFiles([source]);
  const clip = { id: 'speed', mediaId: media[0].id, track: 'video', start: 0, sourceStart: 0, duration: 5, speed: 1, volume: .8, speedSegments: [{ sourceDuration: 2, speed: 2 }, { sourceDuration: 2, speed: .5 }] };
  let project = { ...newProject('分段变速'), width: 320, height: 180, media, clips: [clip] };
  const saved = await h.save(project);
  for (const mutate of [p => p.clips[0].speed = 2, p => p.clips[0].speedSegments[0].speed = 0, p => p.clips[0].duration = 4, p => p.clips[0].speedSegments[0].sourceDuration = null]) {
    const bad = structuredClone(saved); mutate(bad); assert.equal((await fetch(`${h.origin}/api/projects`, post(bad))).status, 400);
  }
  const tooMany = { ...saved, id: crypto.randomUUID(), clips: [0, 1].map(i => ({ ...saved.clips[0], id: `budget${i}`, start: i * 4, duration: 4, speedSegments: Array.from({ length: 33 }, () => ({ sourceDuration: 4 / 33, speed: 1 })) })) };
  const rejected = await fetch(`${h.origin}/api/projects`, post(tooMany)); assert.equal(rejected.status, 400); assert.match(JSON.stringify(await rejected.json()), /解码输入总数/);
  const results = [];
  for (const split of [false, true]) {
    project = { ...saved, id: crypto.randomUUID(), clips: split ? splitClip(saved.clips[0], .75, media[0]) : saved.clips };
    const file = await h.render(project), frames = await h.frames(file), pcm = await h.pcm(file);
    assert.equal(frames.length / (320 * 180 * 3), 150);
    for (let n = 0; n < 150; n++) assert.ok(dominant(pixel(frames, n, 160, 90), n < 30 ? 0 : 2), `${split ? 'split' : 'original'} frame ${n}: ${pixel(frames, n, 160, 90)}`);
    const frequency = (start, end) => {
      let count = 0;
      for (let i = Math.ceil(start * 48000); i < Math.floor(end * 48000) - 1; i++) if (pcm.readFloatLE(i * 4) <= 0 && pcm.readFloatLE((i + 1) * 4) > 0) count++;
      return count / (end - start);
    };
    near(frequency(.2, .6), 440, 8); near(frequency(2, 3), 880, 8); results.push([split, frequency(.2, .6), frequency(2, 3)]);
  }
  t.diagnostic(JSON.stringify(results));
});

test('wipe directions and fade-through-black blend true RGBA and reconnect all frames over lower layers', { timeout: 120000 }, async t => {
  const h = await harness(t), colors = ['blue', 'red', 'lime'], files = colors.map(color => path.join(h.root, `${color}.png`));
  for (let i = 0; i < files.length; i++) await h.make(['-f', 'lavfi', '-i', `color=${colors[i]}:s=320x180`, '-frames:v', '1', files[i]]);
  const media = await h.importFiles(files);
  const project = { ...newProject('三种独立转场'), width: 320, height: 180, media, clips: [
    { id: 'base', mediaId: media[2].id, track: 'video', start: 0, sourceStart: 0, duration: 8, speed: 1, volume: 0 },
    ...[0, 1, 0, 1].map((m, i) => ({ id: `c${i}`, mediaId: media[m].id, track: 'video', layer: 1, start: i * 2, sourceStart: 0, duration: 2, speed: 1, volume: 0, transform: { opacity: .5 }, mask: { type: 'rectangle', width: .8, height: .8 },
      ...(i < 3 ? { transitionOut: { type: ['wipeLeft', 'wipeRight', 'fadeBlack'][i], duration: 1, nextClipId: `c${i + 1}` } } : {}) }))] };
  const file = await h.render(await h.save(project)), frames = await h.frames(file);
  assert.equal(frames.length / (320 * 180 * 3), 240);
  // Left wipe: B occupies the right half; right wipe: B occupies the left half.
  for (const [n, x, channel] of [[60, 80, 2], [60, 240, 0], [120, 80, 2], [120, 240, 0]]) {
    const rgb = pixel(frames, n, x, 90); near(rgb[channel], 127.5, 10); near(rgb[1], 127.5, 10);
  }
  near(pixel(frames, 180, 160, 90).reduce((a, b) => a + b, 0), 0, 6);
  near(pixel(frames, 180, 5, 5).reduce((a, b) => a + b, 0), 0, 6);
  const plan = visualLayersAt(project, 6)[1]; near(plan.blackOpacity, 1);
  for (let n = 0; n < 240; n++) {
    const rgb = pixel(frames, n, 160, 90);
    if (n !== 180) assert.ok(rgb.reduce((a, b) => a + b, 0) > 5, `unexpected black frame ${n}`);
    if (n > 195) { near(rgb[0], 127.5, 10); near(rgb[1], 127.5, 10); }
  }
});
