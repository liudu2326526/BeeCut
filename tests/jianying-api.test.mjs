import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '../server/index.mjs';
import { createDraftImportAccess } from '../desktop/draft-import-access.mjs';
import { newProject } from '../shared/model.mjs';
import { run, ffmpegPath, ffprobePath } from '../server/process.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const exec = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const importPath = id => `/api/jianying/imports/${id}`;
const range = (start, duration) => ({ start, duration });

function draft({ audio = 'missing.wav', video, caption = '自制草稿\n保留两行中文' } = {}) {
  const materials = { videos: video ? [{ id: 'video-source', type: 'video', path: video, duration: 2000000, width: 320, height: 180 }] : [], audios: [{ id: 'audio-source', type: 'music', path: audio, duration: 2000000 }], texts: [] };
  const tracks = [];
  if (video) tracks.push({ id: 'video-track', type: 'video', segments: [{ id: 'video-segment', material_id: 'video-source', target_timerange: range(123456, 1000000), source_timerange: range(400000, 1000000), speed: 1, volume: 0 }] });
  tracks.push({ id: 'audio-track', type: 'audio', segments: [{ id: 'audio-segment', material_id: 'audio-source', target_timerange: range(0, 1100000), source_timerange: range(200000, 1100000), speed: 1, volume: .7 }] });
  if (video) {
    materials.texts.push({ id: 'caption-source', type: 'text', content: JSON.stringify({ text: caption }) });
    tracks.push({ id: 'text-track', type: 'text', segments: [{ id: 'caption-segment', material_id: 'caption-source', target_timerange: range(150000, 800000) }] });
  }
  return { version: 360000, name: 'API 自制草稿', platform: { app_version: '5.9.0' }, canvas_config: { width: 320, height: 180 }, fps: 30, materials, tracks };
}
async function tone(filename) {
  await run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-c:a', 'pcm_s16le', filename]);
}
async function runtime(library, access) {
  const engine = await createApp({ dataDir: library, draftImportAccess: access });
  const server = engine.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let closing;
  return {
    ...engine, origin,
    async api(endpoint, options, expected = 200) {
      const response = await fetch(`${origin}${endpoint}`, options);
      const body = await response.json();
      assert.equal(response.status, expected, `${endpoint}: ${JSON.stringify(body)}`);
      return { body, response };
    },
    close: () => closing ??= (async () => {
      await engine.queue.close(); access?.clear();
      await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections?.(); server.closeAllConnections?.(); });
    })(),
  };
}
async function preflight(api, id) {
  for (let count = 0; count < 1000; count++) {
    const { body } = await api(importPath(id));
    if (body.status !== 'scanning') return body;
    await pause(10);
  }
  throw new Error('草稿预检未在 10 秒内结束');
}
async function unpublished(store) {
  assert.equal(store.media.size, 0);
  for (const directory of ['media', 'thumbnails', 'projects', 'work']) assert.deepEqual(await fs.readdir(store.dirs[directory]), [], directory);
  assert.deepEqual((await fs.readdir(store.dirs.imports)).filter(item => item !== '.pending'), []);
  assert.deepEqual(await fs.readdir(path.join(store.dirs.imports, '.pending')), []);
}
async function inventory(root) {
  const entries = [];
  async function visit(directory, prefix = '') {
    for (const item of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = path.posix.join(prefix, item.name), filename = path.join(directory, item.name);
      if (item.isDirectory()) { entries.push({ path: relative, type: 'directory' }); await visit(filename, relative); }
      else { assert.equal(item.isFile(), true); entries.push({ path: relative, type: 'file', sha256: sha(await fs.readFile(filename)) }); }
    }
  }
  await visit(root); return entries;
}

test('draft HTTP API rejects ungranted paths, consumes exact single-use and revision-bound grants, and never falls back from opaque content', { timeout: 30000 }, async t => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'weijian-draft-api-authority-'));
  let plain, allowed;
  t.after(async () => { await plain?.close(); await allowed?.close(); await fs.rm(root, { recursive: true, force: true }); });
  const directory = path.join(root, 'source'); await fs.mkdir(directory);
  plain = await runtime(path.join(root, 'no-desktop'));
  await plain.api('/api/jianying/imports', json({ grantId: '00000000-0000-4000-8000-000000000000' }), 403);
  await plain.api('/api/jianying/imports', json({ directory }), 400);
  await unpublished(plain.store); await plain.close();

  const access = createDraftImportAccess();
  allowed = await runtime(path.join(root, 'scoped-library'), access);
  await allowed.api('/api/jianying/imports', json({ directory }), 400);
  await allowed.api('/api/jianying/imports', json({ grantId: '00000000-0000-4000-8000-000000000000' }), 403);
  const external = path.join(root, 'selected-tone.wav'); await tone(external);
  await fs.mkdir(path.join(directory, 'Timelines', 'timeline-a'), { recursive: true });
  await fs.mkdir(path.join(directory, 'Timelines', 'timeline-b'), { recursive: true });
  await fs.writeFile(path.join(directory, 'Timelines', 'project.json'), JSON.stringify({ timelines: [{ id: 'timeline-a', name: '第一条' }, { id: 'timeline-b', name: '第二条' }] }));
  for (const id of ['timeline-a', 'timeline-b']) await fs.writeFile(path.join(directory, 'Timelines', id, 'draft_info.json'), JSON.stringify(draft({ audio: external })));
  const sourcesBefore = await inventory(directory), externalHash = sha(await fs.readFile(external));
  const grantId = access.issueDirectory(directory);
  const { body: scanning } = await allowed.api('/api/jianying/imports', json({ grantId }), 202);
  await allowed.api('/api/jianying/imports', json({ grantId }), 403);
  let report = await preflight(allowed.api, scanning.id);
  assert.equal(report.status, 'needs-timeline');
  await allowed.api(`${importPath(report.id)}/timeline`, json({ timelineId: '../../escape' }), 400);
  await allowed.api(`${importPath(report.id)}/timeline`, json({ timelineId: 'timeline-a' }), 202);
  report = await preflight(allowed.api, report.id);
  assert.equal(report.status, 'blocked'); assert.equal(report.canCommit, false);
  const revisionA = report.revision;
  const staleGrant = access.issueMedia(external, report.id, 'audio-source', revisionA);
  await allowed.api(`${importPath(report.id)}/timeline`, json({ timelineId: 'timeline-b' }), 202);
  report = await preflight(allowed.api, report.id);
  assert.ok(report.revision > revisionA, 'time-line reinspection must change grant revision');
  await allowed.api(`${importPath(report.id)}/relink`, json({ sourceId: 'audio-source', grantId: staleGrant }), 403);
  await allowed.api(`${importPath(report.id)}/relink`, json({ sourceId: 'audio-source', path: external }), 400);
  const anotherSourceGrant = access.issueMedia(external, report.id, 'other-source', report.revision);
  await allowed.api(`${importPath(report.id)}/relink`, json({ sourceId: 'audio-source', grantId: anotherSourceGrant }), 403);
  const currentGrant = access.issueMedia(external, report.id, 'audio-source', report.revision);
  await allowed.api(`${importPath(report.id)}/relink`, json({ sourceId: 'audio-source', grantId: currentGrant }), 202);
  report = await preflight(allowed.api, report.id);
  assert.equal(report.status, 'ready', JSON.stringify(report.issues));
  assert.equal(report.materials[0].selectedPath, await fs.realpath(external));
  await allowed.api(`${importPath(report.id)}/relink`, json({ sourceId: 'audio-source', grantId: currentGrant }), 403);
  await allowed.api(importPath(report.id), { method: 'DELETE' });
  await unpublished(allowed.store);

  const opaque = path.join(root, 'opaque'); await fs.mkdir(opaque);
  await fs.writeFile(path.join(opaque, 'draft_info.json'), 'OPAQUE-PRIVATE-CONTENT-NOT-JSON');
  await fs.writeFile(path.join(opaque, 'draft_content.json'), JSON.stringify(draft()));
  const opaqueBefore = await inventory(opaque);
  const { body: opaqueStarted } = await allowed.api('/api/jianying/imports', json({ grantId: access.issueDirectory(opaque) }), 202);
  const unsupported = await preflight(allowed.api, opaqueStarted.id);
  assert.equal(unsupported.status, 'unsupported'); assert.equal(unsupported.canCommit, false);
  assert.ok(unsupported.issues.some(issue => issue.code === 'UNSUPPORTED_DOCUMENT'));
  await allowed.api(`${importPath(unsupported.id)}/commit`, json({ acknowledgeWarnings: true }), 409);
  await unpublished(allowed.store);
  assert.deepEqual(await inventory(opaque), opaqueBefore, 'opaque authoritative document and alternate remain untouched');
  assert.deepEqual(await inventory(directory), sourcesBefore, 'grant rejection and relink never mutate timeline source files');
  assert.equal(sha(await fs.readFile(external)), externalHash);
  t.diagnostic(JSON.stringify({ coverage: 'real createApp HTTP + actual WAV probe; grants issued by test owner, no native dialog', sourceFilesUnchanged: sourcesBefore.filter(item => item.type === 'file').length + opaqueBefore.length + 1, staleRevisionRejected: true, opaqueFallbackRefused: true }));
});

test('draft HTTP import relinks real media, acknowledges loss, publishes a new editable project, survives a new server and exports real video/audio', { timeout: 60000 }, async t => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'weijian-draft-api-flow-'));
  const library = path.join(root, 'library'), directory = path.join(root, 'source'), external = path.join(root, 'selected-tone.wav');
  let current;
  t.after(async () => { await current?.close(); await fs.rm(root, { recursive: true, force: true }); });
  await fs.mkdir(directory); await tone(external);
  const video = path.join(directory, 'marker.mp4');
  await run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', "color=c=red:s=320x180:r=30:d=2,drawbox=color=blue:x=0:y=0:w=iw:h=ih:t=fill:enable='gte(t,1)'", '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  const sentinel = path.join(root, 'never-execute-subtitle');
  const text = `自制草稿：100% 'quoted'\n$(touch ${sentinel})`;
  await fs.writeFile(path.join(directory, 'draft_info.json'), JSON.stringify(draft({ video: 'marker.mp4', audio: 'missing.wav', caption: text })));
  const sourceBefore = await inventory(directory), externalHash = sha(await fs.readFile(external));
  const access = createDraftImportAccess(); current = await runtime(library, access);
  const oldProject = { ...newProject('保留原有工程'), width: 320, height: 180 };
  await current.api('/api/projects', json(oldProject));
  const oldBytes = await fs.readFile(path.join(library, 'projects', `${oldProject.id}.json`));
  const { body: started } = await current.api('/api/jianying/imports', json({ grantId: access.issueDirectory(directory) }), 202);
  let report = await preflight(current.api, started.id);
  assert.equal(report.status, 'blocked'); assert.equal(report.canCommit, false);
  assert.equal(report.materials.find(item => item.sourceId === 'audio-source').status, 'needs-relink');
  assert.equal(current.store.media.size, 0, 'read-only preflight must not publish its probed video');
  assert.deepEqual(await fs.readdir(current.store.dirs.projects), [`${oldProject.id}.json`]);
  const mediaGrant = access.issueMedia(external, report.id, 'audio-source', report.revision);
  await current.api(`${importPath(report.id)}/relink`, json({ sourceId: 'audio-source', grantId: mediaGrant }), 202);
  report = await preflight(current.api, report.id);
  assert.equal(report.status, 'ready', JSON.stringify(report.issues)); assert.equal(report.canCommit, true);
  assert.ok(report.issues.some(issue => issue.code === 'RELINK_IDENTITY_UNVERIFIED'));
  await current.api(`${importPath(report.id)}/commit`, json({ acknowledgeWarnings: false }), 409);
  assert.equal(current.store.media.size, 0, 'unacknowledged loss cannot publish media');
  const { body: completed } = await current.api(`${importPath(report.id)}/commit`, json({ acknowledgeWarnings: true }));
  assert.equal(completed.status, 'completed'); assert.equal(completed.canCommit, false);
  assert.equal(completed.project.id, report.id); assert.notEqual(completed.project.id, oldProject.id);
  assert.equal(completed.project.importReportId, report.id); assert.equal(completed.project.media.length, 2);
  assert.equal(completed.project.clips.length, 2); assert.equal(completed.project.subtitles[0].text, text);
  const importedVideo = completed.project.clips.find(clip => clip.track === 'video');
  assert.equal(importedVideo.start, .123456); assert.equal(importedVideo.sourceStart, .4);
  const { body: persistedReport, response: reportResponse } = await current.api(`/api/jianying/reports/${report.id}`);
  assert.equal(reportResponse.headers.get('cache-control'), 'no-store');
  assert.equal(persistedReport.projectId, report.id);
  assert.equal(persistedReport.documents.find(item => item.name === 'draft_info.json').sha256, sha(await fs.readFile(path.join(directory, 'draft_info.json'))));
  assert.equal(persistedReport.sources.find(item => item.sourceId === 'audio-source').sha256, externalHash);
  assert.ok(persistedReport.mappings.some(mapping => mapping.sourceValue === 123456 && mapping.targetValue === .123456));
  for (const media of completed.project.media) {
    const data = Buffer.from(await (await fetch(`${current.origin}${media.url}`)).arrayBuffer());
    assert.equal(sha(data), media.type === 'video' ? sha(await fs.readFile(video)) : externalHash);
    assert.notEqual(path.basename(media.url), media.type === 'video' ? 'marker.mp4' : 'selected-tone.wav');
  }
  const edited = structuredClone(completed.project);
  edited.name = '导入后继续编辑';
  edited.clips.find(clip => clip.track === 'video').start += 1 / 30;
  edited.clips.find(clip => clip.track === 'video').layer = 1;
  edited.clips.find(clip => clip.track === 'audio').volume = .4;
  edited.subtitles[0].fontSize = 16;
  const { body: saved } = await current.api('/api/projects', json(edited));
  const savedReport = JSON.stringify(persistedReport);
  await current.close();
  current = await runtime(library, createDraftImportAccess());
  const { body: reopened } = await current.api(`/api/projects/${report.id}`);
  assert.deepEqual(reopened.project, saved.project, 'new createApp must reload every saved field and import report reference');
  assert.equal(JSON.stringify((await current.api(`/api/jianying/reports/${report.id}`)).body), savedReport, 'source import record survives later edits unchanged');
  assert.deepEqual(await fs.readFile(path.join(library, 'projects', `${oldProject.id}.json`)), oldBytes, 'pre-existing project bytes remain unchanged');
  const { body: exportStarted } = await current.api('/api/exports', json({ project: reopened.project, settings: { width: 320, height: 180, fps: 30, quality: 'standard' } }), 202);
  let job;
  for (let count = 0; count < 1500; count++) {
    job = (await current.api(`/api/exports/${exportStarted.id}`)).body;
    if (['completed', 'failed', 'cancelled'].includes(job.status)) break;
    await pause(20);
  }
  assert.equal(job.status, 'completed', JSON.stringify(job));
  const output = path.join(root, 'final.mp4'), outputBytes = Buffer.from(await (await fetch(`${current.origin}${job.url}`)).arrayBuffer());
  await fs.writeFile(output, outputBytes);
  const metadata = JSON.parse((await run(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output])).stdout);
  const picture = metadata.streams.find(stream => stream.codec_type === 'video'), sound = metadata.streams.find(stream => stream.codec_type === 'audio');
  assert.equal(picture.codec_name, 'h264'); assert.equal(picture.width, 320); assert.equal(picture.height, 180);
  assert.equal(sound.codec_name, 'aac'); assert.equal(sound.sample_rate, '48000');
  const finalVideo = reopened.project.clips.find(clip => clip.track === 'video');
  const expectedFrames = Math.ceil((finalVideo.start + finalVideo.duration) * 30 - 1e-9);
  assert.equal(Number(picture.nb_frames), expectedFrames);
  for (const [time, expected] of [[finalVideo.start + .1, 'red'], [finalVideo.start + .8, 'blue']]) {
    const pixels = (await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', String(time), '-i', output, '-frames:v', '1', '-vf', 'crop=8:8:100:20,scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer', timeout: 10000 })).stdout;
    const [red, green, blue] = pixels;
    assert.ok(expected === 'red' ? red > 180 && green < 70 && blue < 70 : blue > 180 && red < 70 && green < 70, `${time} expected ${expected}, actual ${[red, green, blue]}`);
  }
  const pcm = (await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', '0.05', '-i', output, '-t', '0.1', '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { encoding: 'buffer', timeout: 10000 })).stdout;
  const count = pcm.length / 4;
  function amplitude(hz) {
    let re = 0, im = 0, weightSum = 0;
    for (let i = 0; i < count; i++) {
      const value = pcm.readFloatLE(i * 4), weight = .5 - .5 * Math.cos(2 * Math.PI * i / (count - 1));
      assert.equal(Number.isFinite(value), true); weightSum += weight;
      re += value * weight * Math.cos(2 * Math.PI * hz * i / 48000); im += value * weight * Math.sin(2 * Math.PI * hz * i / 48000);
    }
    return 2 * Math.hypot(re, im) / weightSum;
  }
  const music = amplitude(440), mutedOriginal = amplitude(330);
  assert.ok(music > .02, `selected external audio must remain audible: ${music}`);
  assert.ok(mutedOriginal < .003, `video source gain=0 must remain silent: ${mutedOriginal}`);
  await assert.rejects(fs.access(sentinel), { code: 'ENOENT' });
  assert.deepEqual(await inventory(directory), sourceBefore);
  assert.equal(sha(await fs.readFile(external)), externalHash);
  assert.deepEqual(await fs.readdir(current.store.dirs.work), []);
  assert.deepEqual(await fs.readdir(path.join(current.store.dirs.imports, '.pending')), []);
  t.diagnostic(JSON.stringify({ coverage: 'real isolated HTTP import, exact granted relink, actual source probes and copies, durable report, edit/save, new createApp reopen and MP4 render; no native chooser', project: report.id, revision: report.revision, sourceFilesUnchanged: sourceBefore.filter(item => item.type === 'file').length + 1, output: { sha256: sha(outputBytes), frames: expectedFrames, width: 320, height: 180, videoCodec: picture.codec_name, audioCodec: sound.codec_name, audioRate: sound.sample_rate, tone440Amplitude: music, muted330Amplitude: mutedOriginal } }));
});
