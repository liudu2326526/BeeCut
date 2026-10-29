import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { createApp } from '../server/index.mjs';
import { newProject, detachClipAudio, clipAudioSettings, clipAudioEnabled, audioGainAt,
  clipTiming, changeClipTiming, createSpeedCurve, sourceTimeAt, trimClip, splitClip,
  gainToDb, dbToGain, audioFadeFilterName } from '../shared/model.mjs';

const exec = promisify(execFile);
const sourceClip = () => ({ id: 'picture', mediaId: 'source', track: 'video', layer: 2,
  start: .137, sourceStart: .25, duration: 2, speed: 1, volume: .5,
  fadeIn: .2, fadeOut: .3, fadeInCurve: 'easeIn', fadeOutCurve: 'equalPower',
  transform: { scale: .4, x: 20 }, mask: { type: 'ellipse' }, animation: { in: .5, out: .5 },
  transformKeys: [{ id: 'key', time: 0 }], transitionOut: { type: 'none', duration: 0 } });

test('detached audio retains each source clock, is independent of picture/mute, and keeps outer fade shapes through split/trim', () => {
  const media = { id: 'source', type: 'video', duration: 4, hasAudio: true };
  const base = sourceClip();
  const modes = [base,
    changeClipTiming(base, { speedSegments: [{ sourceDuration: .5, speed: 2 }, { sourceDuration: 1.5, speed: .5 }] }, media),
    createSpeedCurve(base, 'rampUp', media)];
  for (const source of modes) {
    const project = { ...newProject(), media: [media], clips: [source] }, before = structuredClone(project);
    const detached = detachClipAudio(project, source.id, 'sound');
    assert.deepEqual(project, before, 'producer never mutates the accepted project');
    const [picture, audio] = detached.clips;
    assert.equal(picture.audioDetached, true);
    assert.equal(clipAudioEnabled(picture, media), false);
    assert.equal(clipAudioEnabled(audio, media), true);
    assert.deepEqual(clipTiming(audio), clipTiming(source));
    for (let i = 0; i <= 20; i++) {
      const time = source.start + source.duration * i / 20;
      assert.equal(sourceTimeAt(audio, time), sourceTimeAt(source, time));
      assert.equal(audioGainAt(audio, time), audioGainAt(source, time));
      assert.equal(audioGainAt(picture, time), 0);
    }
    for (const field of ['transform', 'mask', 'animation', 'transformKeys', 'adjustments', 'transitionOut', 'audioDetached'])
      assert.equal(Object.hasOwn(audio, field), false, `audio omits ${field}`);
    if (audio.speedCurve) assert.notEqual(audio.speedCurve.points, source.speedCurve.points);
    if (audio.speedSegments) assert.notEqual(audio.speedSegments, source.speedSegments);
    const [left, right] = splitClip(audio, audio.start + audio.duration / 2);
    assert.equal(left.fadeInCurve, 'easeIn'); assert.equal(left.fadeOut, 0);
    assert.equal(right.fadeOutCurve, 'equalPower'); assert.equal(right.fadeIn, 0);
    assert.equal(left.muted, false); assert.equal(right.muted, false);
    const trimmed = trimClip(audio, { start: audio.start + .1, end: audio.start + audio.duration }, media);
    assert.equal(trimmed.fadeIn, 0); assert.equal(trimmed.fadeOutCurve, 'equalPower');
    assert.throws(() => detachClipAudio(detached, picture.id), /已分离/);
    assert.throws(() => detachClipAudio(detached, audio.id), /包含原声/);
  }
  const muted = { ...base, muted: true };
  const detached = detachClipAudio({ media: [media], clips: [muted] }, muted.id, 'muted-sound');
  assert.equal(detached.clips[1].muted, true);
  assert.equal(detached.clips[1].volume, .5);
  assert.equal(clipAudioEnabled(detached.clips[1], media), false);
  assert.equal(audioGainAt(detached.clips[1], 1), 0);
  assert.equal(gainToDb(0), -Infinity); assert.equal(dbToGain(-Infinity), 0);
  for (const gain of [1e-7, .001, .5, 1, 2]) assert.ok(Math.abs(dbToGain(gainToDb(gain)) - gain) < 1e-12);
  assert.deepEqual(clipAudioSettings({ track: 'video', duration: 3 }), {
    volume: 1, muted: false, audioDetached: false, fadeIn: 0, fadeOut: 0, fadeInCurve: 'linear', fadeOutCurve: 'linear' });
});

test('four fade shapes match actual FFmpeg PCM in both directions against independent gain equations', async () => {
  const formulas = { linear: u => u, easeIn: u => u * u,
    easeOut: u => u * (2 - u), equalPower: u => Math.sin(Math.PI * u / 2) };
  for (const [type, equation] of Object.entries(formulas)) {
    const filter = audioFadeFilterName(type);
    const { stdout } = await exec(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
      'aevalsrc=0.125:s=48000:d=3', '-af', `afade=t=in:st=0:d=1:curve=${filter},afade=t=out:st=2:d=1:curve=${filter}`,
      '-f', 'f32le', '-ac', '1', 'pipe:1'], { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 });
    assert.equal(stdout.length, 3 * 48000 * 4);
    const clip = { track: 'audio', start: 7, duration: 3, volume: .125, fadeIn: 1, fadeOut: 1, fadeInCurve: type, fadeOutCurve: type };
    for (const u of [.1, .25, .5, .75, .9]) {
      for (const local of [u, 3 - u]) {
        const actual = stdout.readFloatLE(Math.round(local * 48000) * 4), expected = .125 * equation(u);
        assert.ok(Math.abs(actual - expected) < 1e-7, `${type}/${local}: PCM ${actual}, expected ${expected}`);
        assert.ok(Math.abs(audioGainAt(clip, clip.start + local) - expected) < 1e-12);
      }
    }
  }
});

test('real import/save/reopen preserves detached audio and old defaults; invalid audio fields and curve capacity leave saved project intact', { timeout: 30000 }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'weijian-v08-audio-'));
  const runtime = await createApp({ dataDir: path.join(dir, 'library') });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => { await runtime.queue.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); }); await rm(dir, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const file = path.join(dir, 'tone.mp4');
  await exec(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=30:d=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
  const form = new FormData(); form.append('files', new Blob([await readFile(file)]), 'tone.mp4');
  const response = await fetch(`${origin}/api/media`, { method: 'POST', body: form });
  assert.equal(response.status, 201);
  const media = (await response.json()).media[0];
  const post = async (endpoint, value) => {
    const response = await fetch(`${origin}${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
    return { status: response.status, body: await response.json() };
  };
  const legacy = { ...newProject('旧工程兼容'), media: [media], clips: [{ id: 'picture', mediaId: media.id, track: 'video', start: .137,
    sourceStart: .25, duration: 2, speed: 1, volume: .5, fadeIn: .2, fadeOut: .3 }] };
  const rawLegacy = Buffer.from(JSON.stringify(legacy, null, 2));
  await writeFile(path.join(runtime.store.dirs.projects, `${legacy.id}.json`), rawLegacy);
  const legacyRead = await fetch(`${origin}/api/projects/${legacy.id}`); assert.equal(legacyRead.status, 200);
  assert.equal((await legacyRead.json()).project.clips[0].muted, false);
  assert.deepEqual(await readFile(path.join(runtime.store.dirs.projects, `${legacy.id}.json`)), rawLegacy, 'reading added defaults never migrates the caller’s saved JSON');
  const savedLegacy = await post('/api/projects', legacy); assert.equal(savedLegacy.status, 200);
  assert.equal(savedLegacy.body.project.clips[0].muted, false);
  assert.equal(savedLegacy.body.project.clips[0].audioDetached, false);
  assert.equal(savedLegacy.body.project.clips[0].fadeInCurve, 'linear');
  const shaped = structuredClone(savedLegacy.body.project);
  Object.assign(shaped.clips[0], { volume: dbToGain(-6), fadeInCurve: 'easeOut', fadeOutCurve: 'equalPower' });
  const separated = detachClipAudio(shaped, 'picture', 'sound');
  const saved = await post('/api/projects', separated); assert.equal(saved.status, 200, JSON.stringify(saved));
  const reopened = (await (await fetch(`${origin}/api/projects/${legacy.id}`)).json()).project;
  assert.deepEqual(reopened, saved.body.project);
  assert.equal(reopened.clips[1].mediaId, media.id);
  assert.equal(reopened.clips[1].volume, dbToGain(-6));
  const savedBytes = await readFile(path.join(runtime.store.dirs.projects, `${legacy.id}.json`));
  for (const patch of [{ muted: 'yes' }, { muted: null }, { audioDetached: 'true' }, { audioDetached: null }, { fadeInCurve: 'unknown' }, { fadeOutCurve: null }, { volume: NaN }]) {
    const bad = structuredClone(reopened); Object.assign(bad.clips[0], patch);
    const rejected = await post('/api/projects', bad); assert.equal(rejected.status, 400, JSON.stringify(patch));
    assert.deepEqual(await readFile(path.join(runtime.store.dirs.projects, `${legacy.id}.json`)), savedBytes);
  }
  const badAudio = structuredClone(reopened); badAudio.clips[1].audioDetached = true;
  assert.equal((await post('/api/projects', badAudio)).status, 400);
  const capacity = structuredClone(savedLegacy.body.project);
  capacity.clips[0] = changeClipTiming(capacity.clips[0], { speedCurve: { sourceDuration: 2,
    points: Array.from({ length: 64 }, (_, i) => ({ id: `point-${i}`, position: i / 63, speed: 1 })) } }, media);
  capacity.clips.push({ ...structuredClone(capacity.clips[0]), id: 'second', start: 2.137 });
  const baseline = await post('/api/projects', capacity); assert.equal(baseline.status, 200);
  const beforeCapacity = await readFile(path.join(runtime.store.dirs.projects, `${legacy.id}.json`));
  const rejected = await post('/api/projects', detachClipAudio(baseline.body.project, 'picture', 'excess-audio'));
  assert.equal(rejected.status, 400); assert.match(rejected.body.error, /128|节点/);
  assert.deepEqual(await readFile(path.join(runtime.store.dirs.projects, `${legacy.id}.json`)), beforeCapacity);
  const noMedia = structuredClone(legacy); noMedia.clips[0].mediaId = 'missing';
  assert.equal((await post('/api/audio-previews', { project: noMedia })).status, 400, 'preview route shares the exact project validator');
  for (const filename of ['test.partial.wav', 'test.partial.mp4']) {
    await writeFile(path.join(runtime.store.dirs.exports, filename), 'unpublished');
    assert.equal((await fetch(`${origin}/exports/${filename}`)).status, 404);
    assert.equal((await fetch(`${origin}/exports/${filename.replaceAll('.', '%2e')}`)).status, 404);
  }
});
