import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';
import { ffmpegPath } from '../server/process.mjs';
import { newProject, pictureTransformAt, splitClip, trimClip } from '../shared/model.mjs';
import { ANIMATION_TYPES, TRANSITION_TYPES } from '../shared/effects.mjs';

const exec = promisify(execFile), W = 320, H = 180;
const post = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const near = (actual, expected, tolerance, note = '') => assert.ok(Math.abs(actual - expected) <= tolerance, `${note}: ${actual} != ${expected}`);
const pixel = (frames, frame, x, y) => [...frames.subarray((frame * W * H + y * W + x) * 3, (frame * W * H + y * W + x) * 3 + 3)];
async function harness(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'weijian-v07-effects-'));
  const runtime = await createApp({ dataDir: path.join(root, 'library') });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await runtime.queue.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const media = [];
  for (const color of ['blue', 'red', 'lime']) {
    const file = path.join(root, `${color}.png`);
    await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=${color}:s=${W}x${H}`, '-frames:v', '1', file]);
    const form = new FormData(); form.append('files', new Blob([await readFile(file)]), path.basename(file));
    const response = await fetch(`${origin}/api/media`, { method: 'POST', body: form });
    assert.equal(response.status, 201); media.push((await response.json()).media[0]);
  }
  const save = async project => {
    const response = await fetch(`${origin}/api/projects`, post(project)), body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual((await (await fetch(`${origin}/api/projects/${project.id}`)).json()).project, body.project);
    return body.project;
  };
  const render = async (project, fps = 30) => {
    const response = await fetch(`${origin}/api/exports`, post({ project, settings: { width: W, height: H, fps } }));
    let job = await response.json(); assert.equal(response.status, 202, JSON.stringify(job));
    for (let count = 0; count < 1500 && !['completed', 'failed'].includes(job.status); count++) { await delay(20); job = await (await fetch(`${origin}/api/exports/${job.id}`)).json(); }
    assert.equal(job.status, 'completed', JSON.stringify(job));
    const file = path.join(root, `${job.id}.mp4`); await writeFile(file, Buffer.from(await (await fetch(`${origin}${job.url}`)).arrayBuffer()));
    return (await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file, '-an', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 80 * 1024 * 1024 })).stdout;
  };
  const clip = (id, index, start, duration, extra = {}) => ({ id, mediaId: media[index].id, track: 'video', start, sourceStart: 0, duration, speed: 1, volume: 0, ...extra });
  return { root, origin, media, save, render, clip };
}

test('eight effects persist through API; new vertical/circular transitions reconnect fractional windows with premultiplied transparency', { timeout: 120000 }, async t => {
  const h = await harness(t), types = ['wipeUp', 'wipeDown', 'circleOpen', 'circleClose'];
  const duration = 1.713, window = .73, length = duration * 5;
  const project = { ...newProject('独立八种转场'), width: W, height: H, fps: 24, media: h.media, clips: [
    h.clip('base', 2, 0, length),
    ...Array.from({ length: 5 }, (_, i) => h.clip(`effect-${i}`, i % 2, i * duration, duration, { layer: 1, transform: { opacity: .5 }, mask: { type: 'rectangle', width: .9, height: .9 }, ...(i < 4 ? { transitionOut: { type: types[i], duration: window, nextClipId: `effect-${i + 1}` } } : {}) })),
  ] };
  const saved = await h.save(project);
  assert.deepEqual(saved.clips.slice(1, 5).map(c => c.transitionOut.type), types);
  for (const type of TRANSITION_TYPES) {
    const variant = structuredClone(saved); variant.clips[1].transitionOut.type = type;
    assert.equal((await fetch(`${h.origin}/api/projects`, post(variant))).status, 200, type);
  }
  const bad = structuredClone(saved); bad.clips[1].transitionOut.type = 'fake-circle';
  assert.equal((await fetch(`${h.origin}/api/projects`, post(bad))).status, 400);
  let probes = 0, boundarySkips = 0;
  for (const fps of [30, 24]) {
    const frames = await h.render(saved, fps), count = Math.ceil(length * fps - 1e-8);
    assert.equal(frames.length / (W * H * 3), count);
    // Independent geometric oracle: no production transition sampling helper.
    // Probe every output frame; skip only eight pixels around an ideal moving
    // boundary, allowing raster antialiasing/chroma subsampling tolerance.
    for (let n = 0; n < count; n++) {
      const at = n / fps;
      let sourceIndex = Math.min(4, Math.floor(at / duration));
      const transition = types.findIndex((_, i) => at >= (i + 1) * duration - window / 2 && at < (i + 1) * duration + window / 2);
      for (const [x, y] of [[45, 35], [160, 35], [275, 35], [45, 90], [160, 90], [275, 90], [45, 145], [160, 145], [275, 145]]) {
        let chosen = sourceIndex, distance = Infinity;
        if (transition >= 0) {
          const p = (at - ((transition + 1) * duration - window / 2)) / window;
          let incoming;
          if (types[transition] === 'wipeUp') { incoming = y >= H * (1 - p); distance = Math.abs(y - H * (1 - p)); }
          if (types[transition] === 'wipeDown') { incoming = y < H * p; distance = Math.abs(y - H * p); }
          if (types[transition].startsWith('circle')) {
            const radius = Math.hypot(W / 2, H / 2) * (types[transition] === 'circleOpen' ? p : 1 - p);
            const r = Math.hypot(x - W / 2, y - H / 2); distance = Math.abs(r - radius);
            incoming = types[transition] === 'circleOpen' ? r < radius : r >= radius;
          }
          chosen = transition + Number(incoming);
        }
        if (distance <= 8) { boundarySkips++; continue; }
        const rgb = pixel(frames, n, x, y), channel = chosen % 2 === 0 ? 2 : 0;
        near(rgb[channel], 127.5, 12, `${fps}fps frame${n}/${x},${y} chosen${chosen}`);
        near(rgb[1], 127.5, 12, 'lower green layer retained'); near(rgb[2 - channel], 0, 12, 'other upper color'); probes++;
      }
      const corner = pixel(frames, n, 3, 3); near(corner[1], 255, 10, 'transparent mask reveals lower layer');
    }
  }
  t.diagnostic(JSON.stringify({ pixelProbes: probes, boundarySkips, fps: [30, 24], allOutputFrames: true }));
});

test('new vertical, rotate and pop entry/exit animations use independent geometry with key opacity and rotating mask', { timeout: 120000 }, async t => {
  const h = await harness(t), types = ['slideUp', 'slideDown', 'rotate', 'pop'];
  const values = (x, rotation, opacity) => ({ scale: .4, x, y: 0, rotation, opacity });
  const project = { ...newProject('独立八种入出动画'), width: W, height: H, media: h.media, clips: [h.clip('base', 2, 0, 8), ...types.map((type, i) => h.clip(`motion-${i}`, 0, i * 2, 2, {
    layer: 1, mask: { type: 'rectangle', width: .8, height: .6 },
    transformKeys: [{ id: `a${i}`, time: 0, values: values(-20, 10, .6), easing: 'linear' }, { id: `b${i}`, time: 2, values: values(20, 30, .8), easing: 'linear' }],
    animation: { in: .8, out: .8, inType: type, outType: type, easing: 'linear' },
  }))] };
  const saved = await h.save(project);
  for (const type of ANIMATION_TYPES) {
    const variant = structuredClone(saved); variant.clips[1].animation.inType = variant.clips[1].animation.outType = type;
    assert.equal((await fetch(`${h.origin}/api/projects`, post(variant))).status, 200, type);
  }
  const bad = structuredClone(saved); bad.clips[1].animation.outType = 'fake-spin'; assert.equal((await fetch(`${h.origin}/api/projects`, post(bad))).status, 400);
  const frames = await h.render(saved); assert.equal(frames.length / (W * H * 3), 240);
  let probes = 0;
  for (let i = 0; i < types.length; i++) for (const localFrame of [12, 18, 30, 42, 48]) {
    const local = localFrame / 30, p = Math.min(local / .8, (2 - local) / .8, 1);
    let scale = .4, x = -20 + 20 * local, y = 0, rotation = 10 + 10 * local;
    if (types[i] === 'slideUp') y = -H * (1 - p);
    if (types[i] === 'slideDown') y = H * (1 - p);
    if (types[i] === 'rotate') rotation -= 90 * (1 - p);
    if (types[i] === 'pop') { const q = p - 1; scale *= .5 + .5 * (1 + 2.70158 * q ** 3 + 1.70158 * q ** 2); }
    const actual = pictureTransformAt(saved.clips[i + 1], i * 2 + local, project);
    for (const [field, expected] of Object.entries({ scale, x, y, rotation })) near(actual[field], expected, 1e-10, `${types[i]} ${field}`);
    const angle = rotation * Math.PI / 180, opacity = .6 + .1 * local;
    for (let py = 8; py < H; py += 12) for (let px = 8; px < W; px += 12) {
      const dx = px - (W / 2 + x), dy = py - (H / 2 + y);
      const rx = (dx * Math.cos(angle) + dy * Math.sin(angle)) / scale;
      const ry = (-dx * Math.sin(angle) + dy * Math.cos(angle)) / scale;
      const edge = Math.min(Math.abs(Math.abs(rx) - W * .8 / 2), Math.abs(Math.abs(ry) - H * .6 / 2)) * scale;
      if (edge <= 8) continue;
      const inside = Math.abs(rx) < W * .8 / 2 && Math.abs(ry) < H * .6 / 2;
      const rgb = pixel(frames, i * 60 + localFrame, px, py);
      near(rgb[2], inside ? 255 * opacity : 0, 13, `${types[i]} t${local} ${px},${py} blue`);
      near(rgb[1], inside ? 255 * (1 - opacity) : 255, 13, `${types[i]} t${local} lower green`); probes++;
    }
  }
  t.diagnostic(JSON.stringify({ newTypes: types, geometryProbes: probes, animatedKeyOpacity: true, maskBeforeTransform: true, entryAndExit: true }));
});

test('fractional clip starts sample key geometry, dynamic opacity and linear fades on the global output clock', { timeout: 120000 }, async t => {
  const h = await harness(t), duration = 1.137;
  const kinds = ['keys', 'fade', 'rotate', 'pop'];
  const clips = kinds.map((kind, i) => h.clip(kind, 0, .013 + i * 1.23, duration, { layer: 1,
    transform: { scale: .45, opacity: .8 },
    ...(kind === 'keys' ? { transformKeys: [
      { id: 'first', time: 0, easing: 'linear', values: { scale: .25, x: -70, y: 0, rotation: 0, opacity: .2 } },
      { id: 'last', time: duration, easing: 'linear', values: { scale: .4, x: 70, y: 0, rotation: 0, opacity: .8 } },
    ] } : { animation: { in: .4, out: .4, inType: kind, outType: kind, easing: kind === 'fade' ? 'linear' : 'easeOut' } }),
  }));
  const project = await h.save({ ...newProject('非整帧姿态采样'), width: W, height: H, media: h.media, clips: [h.clip('base', 2, 0, 5), ...clips] });
  const observations = [];
  for (const fps of [24, 30, 60]) {
    const frames = await h.render(project, fps); assert.equal(frames.length / (W * H * 3), 5 * fps);
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i], kind = kinds[i];
      for (let n = Math.ceil(clip.start * fps); n < Math.ceil((clip.start + duration) * fps); n++) {
        const local = n / fps - clip.start;
        let scale = .45, x = 0, rotation = 0, opacity = .8;
        if (kind === 'keys') { const q = local / duration; scale = .25 + .15 * q; x = -70 + 140 * q; opacity = .2 + .6 * q; }
        else {
          const u = Math.min(1, local / .4, (duration - local) / .4), p = kind === 'fade' ? u : 1 - (1 - u) ** 2;
          if (kind === 'fade') opacity *= p;
          if (kind === 'rotate') rotation = -90 * (1 - p);
          if (kind === 'pop') { const q = p - 1; scale *= .5 + .5 * (1 + 2.70158 * q ** 3 + 1.70158 * q ** 2); }
        }
        const center = pixel(frames, n, Math.round(W / 2 + x), H / 2);
        near(center[2], 255 * opacity, 9, `${fps}/${kind}/n${n} absolute alpha`);
        if (opacity < .1) continue;
        const angle = rotation * Math.PI / 180;
        if (kind === 'keys') {
          const xs = []; for (let px = 0; px < W; px++) if (pixel(frames, n, px, H / 2)[2] > 255 * opacity * .8) xs.push(px);
          near((Math.min(...xs) + Math.max(...xs)) / 2, W / 2 + x, 1.6, `${fps}/${kind}/n${n} key center`);
        }
        // Interior sample regions are independent of actual output. Eight-pixel
        // margins exclude 4:2:0/affine edge ringing without moving any probe to
        // accommodate its observed color. Alpha and key center stay strict.
        for (let py = 8; py < H; py += 16) for (let px = 8; px < W; px += 16) {
          const dx = px - W / 2 - x, dy = py - H / 2;
          const rx = (dx * Math.cos(angle) + dy * Math.sin(angle)) / scale;
          const ry = (-dx * Math.sin(angle) + dy * Math.cos(angle)) / scale;
          if (Math.min(Math.abs(Math.abs(rx) - W / 2), Math.abs(Math.abs(ry) - H / 2)) * scale <= 8) continue;
          const inside = Math.abs(rx) < W / 2 && Math.abs(ry) < H / 2;
          near(pixel(frames, n, px, py)[2], inside ? 255 * opacity : 0, 28, `${fps}/${kind}/n${n} interior ${px},${py}`);
        }
      }
    }
    observations.push({ fps, source: 'independent absolute frame/fps minus saved clip.start', kinds });
  }
  // Mutation consumers retain their own eased/key phase; sampling still uses
  // absolute frame time after a non-grid split or trim.
  for (const fps of [24, 60]) for (const [variant, pieces] of [
    ['split', splitClip(clips[0], clips[0].start + .447, h.media[0])],
    ['trim', [trimClip(clips[0], { start: clips[0].start + .173, end: clips[0].start + .943 }, h.media[0])]],
  ]) {
    const branch = await h.save({ ...newProject(variant), width: W, height: H, media: h.media, clips: [h.clip('base', 2, 0, 1.3), ...pieces] });
    const frames = await h.render(branch, fps);
    for (let n = 1; n < Math.ceil(1.3 * fps); n++) {
      const at = n / fps; if (!pieces.some(c => at >= c.start && at < c.start + c.duration)) continue;
      const q = (at - clips[0].start) / duration, x = -70 + 140 * q, opacity = .2 + .6 * q;
      near(pixel(frames, n, Math.round(160 + x), 90)[2], 255 * opacity, 9, `${fps}/${variant}/n${n} alpha`);
      const xs = []; for (let px = 0; px < W; px++) if (pixel(frames, n, px, 90)[2] > 255 * opacity * .8) xs.push(px);
      near((Math.min(...xs) + Math.max(...xs)) / 2, 160 + x, 1.6, `${fps}/${variant}/n${n} retained absolute pose`);
    }
  }
  t.diagnostic(JSON.stringify(observations));
});

test('mixed FPS incoming holds the project-grid first picture while normal keys and animations follow output time', { timeout: 120000 }, async t => {
  const h = await harness(t), start = 1.713, duration = 1.137, fps = 60, projectFPS = 24;
  const reports = [];
  for (const kind of ['keys', 'fade', 'rotate', 'pop']) {
    const incoming = h.clip('incoming', 0, start, duration, { layer: 1, transform: { scale: .4 },
      ...(kind === 'keys' ? { transformKeys: [
        { id: 'first', time: 0, values: { scale: .4, x: -60, y: 0, rotation: 0, opacity: 1 }, easing: 'linear' },
        { id: 'second', time: .2, values: { scale: .4, x: 60, y: 0, rotation: 0, opacity: 1 }, easing: 'linear' },
      ] } : { animation: { in: kind === 'fade' ? .08 : .2, out: 0, inType: kind, outType: 'fade', easing: 'linear' } }),
    });
    const project = await h.save({ ...newProject('混合帧率首快照'), width: W, height: H, fps: projectFPS, media: h.media, clips: [
      h.clip('base', 2, 0, 3), h.clip('outgoing', 1, 0, start, { layer: 1, transform: { opacity: 0 }, transitionOut: { type: 'dissolve', duration: .6, nextClipId: 'incoming' } }), incoming,
    ] });
    const frames = await h.render(project, fps); assert.equal(frames.length / (W * H * 3), 180);
    for (const n of [95, 99, 102, 103, 104, 106, 110]) {
      const at = n / fps, sample = at < start ? Math.ceil(start * projectFPS) / projectFPS : at, local = sample - start;
      const weight = Math.min(1, Math.max(0, (at - (start - .3)) / .6));
      let x = 0, scale = .4, rotation = 0, alpha = weight;
      if (kind === 'keys') x = -60 + 120 * Math.min(1, local / .2);
      if (kind === 'fade') alpha *= Math.min(1, local / .08);
      if (kind === 'rotate') rotation = -90 * (1 - Math.min(1, local / .2));
      if (kind === 'pop') { const q = Math.min(1, local / .2) - 1; scale *= .5 + .5 * (1 + 2.70158 * q ** 3 + 1.70158 * q ** 2); }
      near(pixel(frames, n, Math.round(W / 2 + x), H / 2)[2], 255 * alpha, 9, `${kind}/n${n} held/normal alpha`);
      if (alpha < .1) continue;
      const angle = rotation * Math.PI / 180;
      if (kind === 'keys') {
        const xs = []; for (let px = 0; px < W; px++) if (pixel(frames, n, px, H / 2)[2] > 255 * alpha * .8) xs.push(px);
        near((Math.min(...xs) + Math.max(...xs)) / 2, W / 2 + x, 1.6, `${kind}/n${n} first-project-pose center`);
      }
      for (let py = 8; py < H; py += 16) for (let px = 8; px < W; px += 16) {
        const dx = px - W / 2 - x, dy = py - H / 2;
        const rx = (dx * Math.cos(angle) + dy * Math.sin(angle)) / scale;
        const ry = (-dx * Math.sin(angle) + dy * Math.cos(angle)) / scale;
        if (Math.min(Math.abs(Math.abs(rx) - W / 2), Math.abs(Math.abs(ry) - H / 2)) * scale <= 8) continue;
        const inside = Math.abs(rx) < W / 2 && Math.abs(ry) < H / 2;
        near(pixel(frames, n, px, py)[2], inside ? 255 * alpha : 0, 28, `${kind}/n${n} held/normal interior ${px},${py}`);
      }
    }
    reports.push({ kind, heldProjectTime: Math.ceil(start * projectFPS) / projectFPS, firstOutputTime: Math.ceil(start * fps) / fps });
  }
  t.diagnostic(JSON.stringify(reports));
});

test('low-FPS slow source pads the required picture count before continued key motion and tail snapshot', { timeout: 120000 }, async t => {
  const h = await harness(t), file = path.join(h.root, 'one-fps.mp4');
  await exec(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:s=320x180:r=1:d=1', '-f', 'lavfi', '-i', 'color=blue:s=320x180:r=1:d=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
  const form = new FormData(); form.append('files', new Blob([await readFile(file)]), 'one-fps.mp4');
  const response = await fetch(`${h.origin}/api/media`, { method: 'POST', body: form }); assert.equal(response.status, 201);
  const media = (await response.json()).media[0], start = .013, cut = start + 8;
  const project = await h.save({ ...newProject('低帧率慢放尾'), width: W, height: H, fps: 24, media: [...h.media, media], clips: [
    h.clip('base', 2, 0, cut + 1),
    { ...h.clip('slow', 0, start, 8, { layer: 1, speed: .25, transitionOut: { type: 'dissolve', duration: .6, nextClipId: 'after' } }), mediaId: media.id,
      transformKeys: [{ id: 'first', time: 0, values: { scale: .4, x: -30, y: 0, rotation: 0, opacity: .8 }, easing: 'linear' }, { id: 'last', time: 8, values: { scale: .4, x: 30, y: 0, rotation: 0, opacity: .8 }, easing: 'linear' }] },
    h.clip('after', 1, cut, 1, { layer: 1, transform: { scale: .4 } }),
  ] });
  const frames = await h.render(project); assert.equal(frames.length / (W * H * 3), Math.ceil((cut + 1) * 30));
  for (const at of [4.5, 6, 7.5, 7.7]) {
    const n = Math.round(at * 30), x = -30 + 60 * (n / 30 - start) / 8;
    const rgb = pixel(frames, n, Math.round(160 + x), 90); near(rgb[2], 204, 12, 'slow blue tail'); near(rgb[1], 51, 12, 'lower green');
    const xs = []; for (let px = 0; px < W; px++) if (pixel(frames, n, px, 90)[2] > 170) xs.push(px);
    near((Math.min(...xs) + Math.max(...xs)) / 2, 160 + x, 1.6, 'tail source holds while key continues');
  }
  const n = 244, p = (n / 30 - (cut - .3)) / .6, rgb = pixel(frames, n, 190, 90);
  near(rgb[0], 255 * p, 12, 'incoming red'); near(rgb[2], 204 * (1 - p), 12, 'held project-clock blue snapshot');
});
