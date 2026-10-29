import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { createApp } from '../server/index.mjs';
import { newProject, clipTiming, changeClipTiming, createSpeedCurve, updateSpeedCurvePoint, clipSpeedCurve, clipTransform } from '../shared/model.mjs';
import { pushFollowingVideoClips } from '../src/clip-edits.mjs';

const exec = promisify(execFile);
test('curve retiming pushes only its actual neighbour chain at full precision and persists; switching to segments retains the source span', { timeout: 30000 }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'weijian-v06-ui-edits-'));
  const runtime = await createApp({ dataDir: path.join(dir, 'library') });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => {
    await runtime.queue.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
    await rm(dir, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const file = path.join(dir, 'source.mp4');
  await exec(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
  const form = new FormData(); form.append('files', new Blob([await readFile(file)]), 'source.mp4');
  const imported = await fetch(`${origin}/api/media`, { method: 'POST', body: form });
  assert.equal(imported.status, 201);
  const media = (await imported.json()).media[0];
  const project = newProject(); project.media.push(media);
  const clip = (id, start, duration, layer = 0) => ({ id, mediaId: media.id, track: 'video', start, sourceStart: 0, duration, speed: 1, volume: 1, layer });
  project.clips = [clip('changed', .123456789, 1), clip('pushed', 1.123456789, 1), clip('unaffected', 8.987654321, 1), clip('other-layer', .345678901, 2, 1)];
  project.clips[3].transformKeys = [
    { id: 'other-key-a', time: 0, values: { ...clipTransform({}) }, easing: 'easeIn', phase: [0, 1] },
    { id: 'other-key-b', time: 1.345678901, values: { ...clipTransform({}), x: 37.123456789 }, easing: 'easeOut', phase: [0, 1] },
  ];
  const save = async value => {
    const response = await fetch(`${origin}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result.project;
  };
  const normalized = await save(project), before = structuredClone(normalized);
  let changed = createSpeedCurve(normalized.clips[0], 'smooth', media);
  for (const point of clipSpeedCurve(changed).points) changed = updateSpeedCurvePoint(changed, point.id, { speed: .5 }, media);
  normalized.clips[0] = changed;
  pushFollowingVideoClips(normalized, changed.id);
  assert.equal(normalized.clips[1].start, changed.start + changed.duration);
  assert.notEqual(normalized.clips[1].start, Math.round(normalized.clips[1].start * 1000) / 1000);
  assert.deepEqual(normalized.clips.slice(2), before.clips.slice(2), 'unaffected distant and other-layer clips, including all keys, retain exact values');
  assert.equal(clipTiming(changed).sourceDuration, 1);
  const saved = await save(normalized);
  const reopenedResponse = await fetch(`${origin}/api/projects/${saved.id}`);
  assert.equal(reopenedResponse.status, 200);
  const reopened = (await reopenedResponse.json()).project;
  assert.deepEqual(reopened.clips, saved.clips);
  assert.deepEqual(reopened.clips.slice(2), before.clips.slice(2));
  const curveTiming = clipTiming(reopened.clips[0]);
  const switched = changeClipTiming(reopened.clips[0], { speedSegments: curveTiming.segments.map(({ sourceDuration, speed }) => ({ sourceDuration, speed })) }, media);
  assert.equal(clipSpeedCurve(switched), null);
  assert.equal(clipTiming(switched).sourceDuration, curveTiming.sourceDuration);
  assert.equal(switched.duration, curveTiming.sourceDuration, 'curve decoder placeholder is converted using sourceDuration, never the old integrated output duration');
  const switchedProject = structuredClone(reopened); switchedProject.clips[0] = switched;
  const switchedSaved = await save(switchedProject);
  const switchedReopened = (await (await fetch(`${origin}/api/projects/${switchedSaved.id}`)).json()).project;
  assert.deepEqual(switchedReopened.clips, switchedSaved.clips);
  const segmented = changeClipTiming(reopened.clips[0], { speedSegments: [{ sourceDuration: curveTiming.sourceDuration * .4, speed: 2 }, { sourceDuration: curveTiming.sourceDuration * .6, speed: .5 }] }, media);
  assert.equal(clipSpeedCurve(segmented), null);
  assert.equal(clipTiming(segmented).sourceDuration, curveTiming.sourceDuration);
  assert.ok(Math.abs(segmented.duration - 1.4) < 1e-12);
  reopened.clips[0] = segmented; pushFollowingVideoClips(reopened, segmented.id);
  const stepSaved = await save(reopened);
  const stepReopened = (await (await fetch(`${origin}/api/projects/${stepSaved.id}`)).json()).project;
  assert.deepEqual(stepReopened.clips, stepSaved.clips);
  assert.deepEqual(stepReopened.clips.slice(2), before.clips.slice(2));
  assert.equal(stepReopened.clips[1].start, saved.clips[1].start, 'shrinking duration does not pull an unaffected neighbour left');
});
