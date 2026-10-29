import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createStore } from '../server/store.mjs';
import { createJianyingImportService } from '../server/jianying-import.mjs';
import { run, ffmpegPath } from '../server/process.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function document(source = 'tone.wav', kind = 'audio') {
  return { version: 360000, name: 'Readable source', canvas_config: { width: 320, height: 180 }, fps: 30,
    materials: { videos: kind === 'video' ? [{ id: 'source-media', type: 'video', path: source, duration: 2000000, width: 320, height: 180 }] : [], audios: kind === 'audio' ? [{ id: 'source-media', type: 'music', path: source, duration: 2000000 }] : [], texts: [] },
    tracks: [{ id: 'source-track', type: kind, segments: [{ id: 'source-clip', material_id: 'source-media', source_timerange: { start: 250000, duration: 1000000 }, target_timerange: { start: 100000, duration: 1000000 }, speed: 1, volume: .75 }] }] };
}
function wav() {
  const frames = 96000, buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(48000, 24); buffer.writeUInt32LE(96000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) buffer.writeInt16LE(Math.round(Math.sin(frame * 2 * Math.PI * 440 / 48000) * 4000), 44 + frame * 2);
  return buffer;
}
async function setup(t, options = {}) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'weijian-draft-import-'));
  const directory = path.join(root, 'source'), library = path.join(root, 'library');
  await fs.mkdir(directory); await fs.writeFile(path.join(directory, 'tone.wav'), wav());
  await fs.writeFile(path.join(directory, 'draft_info.json'), JSON.stringify(document()));
  const store = await createStore(library), service = createJianyingImportService(store, options);
  t.after(async () => { await service.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, directory, library, store, service };
}
async function scanned(service, input) {
  const started = await service.scan(input);
  assert.equal(started.status, 'scanning');
  return settled(service, started.id);
}
async function settled(service, id) {
  for (let count = 0; count < 1000; count++) {
    const result = service.get(id);
    if (result.status !== 'scanning') return result;
    await delay(5);
  }
  throw new Error('Preflight did not settle');
}
async function emptyLibrary(store) {
  assert.equal(store.media.size, 0);
  for (const directory of ['media', 'thumbnails', 'projects', 'work']) assert.deepEqual(await fs.readdir(store.dirs[directory]), [], directory);
  assert.deepEqual((await fs.readdir(store.dirs.imports)).filter(name => name !== '.pending'), []);
  assert.deepEqual(await fs.readdir(path.join(store.dirs.imports, '.pending')), []);
}

test('read-only preflight and real probe publish independent media, project and source report atomically', async t => {
  const { directory, store, service } = await setup(t);
  const before = await fs.readFile(path.join(directory, 'draft_info.json'));
  const source = await fs.readFile(path.join(directory, 'tone.wav'));
  const ready = await scanned(service, { directory });
  assert.equal(ready.status, 'ready', JSON.stringify(ready.issues));
  assert.equal(ready.canCommit, true);
  assert.equal(ready.materials[0].sha256, sha(source));
  assert.equal(ready.materials[0].metadata.duration, 2);
  await emptyLibrary(store);
  const result = await service.commit(ready.id, { acknowledgeWarnings: true });
  assert.equal(result.status, 'completed'); assert.equal(result.project.id, ready.id);
  assert.equal(result.project.importReportId, ready.id);
  assert.equal(result.project.clips[0].start, .1);
  assert.equal(result.project.clips[0].sourceStart, .25);
  assert.equal(result.project.clips[0].volume, .75);
  const own = store.media.get(result.project.media[0].id);
  assert.notEqual(own.filename, 'tone.wav');
  assert.equal(sha(await fs.readFile(store.mediaPath(own))), sha(source));
  assert.equal(sha(await fs.readFile(path.join(directory, 'draft_info.json'))), sha(before));
  assert.equal(sha(await fs.readFile(path.join(directory, 'tone.wav'))), sha(source));
  const persisted = JSON.parse(await fs.readFile(path.join(store.dirs.imports, `${ready.id}.json`), 'utf8'));
  assert.equal(persisted.id, ready.id); assert.equal(persisted.sources[0].sha256, sha(source));
  assert.equal(persisted.documents[0].sha256, sha(before));
  assert.deepEqual(await fs.readdir(store.dirs.work), []);
});

test('external paths are inert until exact relink; digest identity uncertainty requires acknowledgement', async t => {
  let probes = 0;
  const fixture = await setup(t, { probeMedia: async () => { probes++; return { streams: [{ codec_type: 'audio' }], format: { duration: 2, format_name: 'wav' } }; } });
  const { root, directory, store, service } = fixture;
  const external = path.join(root, 'tone.wav'); await fs.writeFile(external, wav());
  await fs.writeFile(path.join(directory, 'draft_info.json'), JSON.stringify(document(external)));
  const missing = await scanned(service, { directory });
  assert.equal(missing.status, 'blocked'); assert.equal(probes, 0);
  assert.equal(missing.materials[0].status, 'needs-relink');
  const updating = service.update(missing.id, { relinks: [{ sourceId: 'source-media', path: external }] });
  assert.equal(updating.status, 'scanning');
  const ready = await settled(service, missing.id);
  assert.equal(ready.status, 'ready'); assert.equal(probes, 1);
  assert.ok(ready.issues.some(item => item.code === 'RELINK_IDENTITY_UNVERIFIED'));
  await assert.rejects(service.commit(ready.id), /确认/);
  await emptyLibrary(store);
  const completed = await service.commit(ready.id, { acknowledgeWarnings: true });
  assert.equal(completed.sources[0].selectedPath, await fs.realpath(external));
  assert.equal(completed.sources[0].originalPath, external);
});

test('changed media after confirmation snapshot refuses publication and leaves no partial files', async t => {
  const { directory, store, service } = await setup(t);
  const ready = await scanned(service, { directory }); assert.equal(ready.status, 'ready');
  const source = path.join(directory, 'tone.wav'), bytes = await fs.readFile(source); bytes[100] ^= 0xff; await fs.writeFile(source, bytes);
  await assert.rejects(service.commit(ready.id, { acknowledgeWarnings: true }), /预检之后发生变化/);
  assert.equal(service.get(ready.id).status, 'failed'); await emptyLibrary(store);
});

test('stored extension follows the probed container rather than an active-content source filename', async t => {
  const { directory, store, service } = await setup(t);
  await fs.rename(path.join(directory, 'tone.wav'), path.join(directory, 'misnamed.html'));
  await fs.writeFile(path.join(directory, 'draft_info.json'), JSON.stringify(document('misnamed.html')));
  const ready = await scanned(service, { directory }); assert.equal(ready.status, 'ready');
  const result = await service.commit(ready.id, { acknowledgeWarnings: true });
  const media = store.media.get(result.project.media[0].id);
  assert.ok(media.filename.endsWith('.wav')); assert.ok(!media.filename.endsWith('.html'));
  assert.equal(media.type, 'audio');
});

test('changed draft or timeline registry invalidates preflight rather than importing stale choices', async t => {
  const { directory, store, service } = await setup(t);
  const ready = await scanned(service, { directory });
  await fs.writeFile(path.join(directory, 'draft_info.json'), JSON.stringify({ ...document(), name: 'changed' }));
  await assert.rejects(service.commit(ready.id, { acknowledgeWarnings: true }), /草稿在预检之后发生变化/);
  await emptyLibrary(store);
});

test('new authoritative documents invalidate an earlier root or fallback selection', async t => {
  const { directory, store, service } = await setup(t);
  await fs.rename(path.join(directory, 'draft_info.json'), path.join(directory, 'draft_content.json'));
  const fallback = await scanned(service, { directory }); assert.equal(fallback.status, 'ready');
  await fs.writeFile(path.join(directory, 'draft_info.json'), JSON.stringify(document()));
  await assert.rejects(service.commit(fallback.id, { acknowledgeWarnings: true }), /文件或时间线选择.*发生变化/);
  await emptyLibrary(store);
  const root = await scanned(service, { directory }); assert.equal(root.status, 'ready');
  await fs.mkdir(path.join(directory, 'Timelines'));
  await fs.writeFile(path.join(directory, 'Timelines', 'project.json'), JSON.stringify({ timelines: [{ id: 'a', name: 'A' }] }));
  await assert.rejects(service.commit(root.id, { acknowledgeWarnings: true }), /文件或时间线选择.*发生变化/);
  await emptyLibrary(store);
});

test('symlinks, remote paths and traversal never grant access or enter the media probe', async t => {
  let probes = 0;
  const { root, directory, store, service } = await setup(t, { probeMedia: async () => { probes++; throw new Error('must not probe'); } });
  const external = path.join(root, 'outside.wav'); await fs.writeFile(external, wav());
  await fs.symlink(external, path.join(directory, 'linked.wav'));
  for (const value of ['linked.wav', '../outside.wav', 'https://example.invalid/sound.wav', 'file:///etc/passwd']) {
    await fs.writeFile(path.join(directory, 'draft_info.json'), JSON.stringify(document(value)));
    const report = await scanned(service, { directory });
    assert.equal(report.canCommit, false, value);
    if (report.materials.length) assert.equal(report.materials[0].status, 'needs-relink');
    await service.cancel(report.id);
  }
  assert.equal(probes, 0); await emptyLibrary(store);
  const selectedLink = path.join(root, 'selected-link'); await fs.symlink(directory, selectedLink);
  await assert.rejects(service.scan({ directory: selectedLink }), /符号链接/);
});

test('multiple timelines require an explicit safe choice and only selected document is interpreted', async t => {
  const { directory, store, service } = await setup(t);
  await fs.mkdir(path.join(directory, 'Timelines', 'a'), { recursive: true });
  await fs.mkdir(path.join(directory, 'Timelines', 'b'), { recursive: true });
  await fs.writeFile(path.join(directory, 'Timelines', 'project.json'), JSON.stringify({ main_timeline_id: 'a', timelines: [{ id: 'a', name: 'First' }, { id: 'b', name: 'Second' }] }));
  await fs.writeFile(path.join(directory, 'Timelines', 'a', 'draft_info.json'), 'opaque private bytes');
  await fs.writeFile(path.join(directory, 'Timelines', 'b', 'draft_content.json'), JSON.stringify(document()));
  const choose = await scanned(service, { directory });
  assert.equal(choose.status, 'needs-timeline'); assert.equal(choose.timelines.length, 2);
  service.update(choose.id, { timelineId: 'b' });
  const ready = await settled(service, choose.id);
  assert.equal(ready.status, 'ready', JSON.stringify(ready.issues)); assert.equal(ready.selectedTimelineId, 'b');
  const result = await service.commit(ready.id, { acknowledgeWarnings: true });
  assert.deepEqual(result.documents.map(item => item.name).sort(), ['Timelines/b/draft_content.json', 'Timelines/project.json']);
  assert.equal(store.media.size, 1);
});

test('timeline selection and changed source declarations revoke old exact-file relinks', async t => {
  const { root, directory, store, service } = await setup(t);
  const firstPath = path.join(root, 'first.wav'), secondPath = path.join(root, 'second.wav');
  await fs.writeFile(firstPath, wav()); await fs.writeFile(secondPath, wav());
  await fs.mkdir(path.join(directory, 'Timelines', 'a'), { recursive: true });
  await fs.mkdir(path.join(directory, 'Timelines', 'b'), { recursive: true });
  await fs.writeFile(path.join(directory, 'Timelines', 'project.json'), JSON.stringify({ timelines: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }));
  await fs.writeFile(path.join(directory, 'Timelines', 'a', 'draft_info.json'), JSON.stringify(document(firstPath)));
  await fs.writeFile(path.join(directory, 'Timelines', 'b', 'draft_info.json'), JSON.stringify(document(secondPath)));
  const choosing = await scanned(service, { directory });
  service.update(choosing.id, { timelineId: 'a' }); const first = await settled(service, choosing.id);
  assert.equal(first.status, 'blocked');
  service.update(first.id, { relinks: [{ sourceId: 'source-media', path: firstPath }] });
  const ready = await settled(service, first.id); assert.equal(ready.status, 'ready');
  assert.ok(ready.revision > first.revision);
  service.update(first.id, { timelineId: 'b' }); const second = await settled(service, first.id);
  assert.equal(second.status, 'blocked'); assert.equal(second.materials[0].sourcePath, secondPath);
  assert.equal(second.materials[0].selectedPath, undefined); assert.ok(second.revision > ready.revision);
  service.update(first.id, { relinks: [{ sourceId: 'source-media', path: secondPath }] });
  const secondReady = await settled(service, first.id); assert.equal(secondReady.status, 'ready');
  await fs.writeFile(path.join(directory, 'Timelines', 'b', 'draft_info.json'), JSON.stringify(document(firstPath)));
  service.update(first.id); const changed = await settled(service, first.id);
  assert.equal(changed.status, 'blocked'); assert.equal(changed.materials[0].selectedPath, undefined);
  await emptyLibrary(store);
});

test('opaque, unknown-version, oversized JSON and unsafe timeline index fail with bounded reports', async t => {
  const { directory, store, service } = await setup(t);
  for (const bytes of [Buffer.from([0xff, 0, 0x90]), JSON.stringify({ ...document(), version: 999999 }), ' '.repeat(2 * 1024 * 1024 + 1)]) {
    await fs.writeFile(path.join(directory, 'draft_info.json'), bytes);
    const report = await scanned(service, { directory });
    assert.equal(report.canCommit, false); assert.ok(report.issues.length > 0);
    await service.cancel(report.id);
  }
  await fs.mkdir(path.join(directory, 'Timelines'));
  await fs.writeFile(path.join(directory, 'Timelines', 'project.json'), JSON.stringify({ timelines: [{ id: '../outside', name: 'unsafe' }] }));
  const report = await scanned(service, { directory });
  assert.equal(report.canCommit, false); assert.match(report.issues[0].message, /越界标识/);
  await emptyLibrary(store);
});

test('real video probe and thumbnail are owned copies, with ordinary editable clips', async t => {
  const { directory, store, service } = await setup(t);
  await run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(directory, 'clip.mp4')]);
  await fs.writeFile(path.join(directory, 'draft_info.json'), JSON.stringify(document('clip.mp4', 'video')));
  const ready = await scanned(service, { directory }); assert.equal(ready.status, 'ready', JSON.stringify(ready.issues));
  const result = await service.commit(ready.id, { acknowledgeWarnings: true });
  const media = store.media.get(result.project.media[0].id);
  const thumbnail = await fs.readFile(path.join(store.dirs.thumbnails, `${media.id}.jpg`));
  assert.equal(thumbnail.readUInt16BE(0), 0xffd8); assert.equal(media.width, 320); assert.equal(media.type, 'video');
});

test('cancellation during source preparation closes its owner and publishes nothing', async t => {
  const entered = deferred();
  const { directory, store, service } = await setup(t, { probeMedia: async (_filename, { signal }) => {
    entered.resolve(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    return { streams: [{ codec_type: 'audio' }], format: { duration: 2 } };
  } });
  const initial = await service.scan({ directory }); await entered.promise;
  const result = await service.cancel(initial.id);
  assert.equal(result.status, 'cancelled'); await emptyLibrary(store);
});

test('cancellation during thumbnail preparation removes copied bytes before publication', async t => {
  const entered = deferred();
  const { directory, store, service } = await setup(t, { makeThumbnail: async (_source, output, _media, { signal }) => {
    await fs.writeFile(output, 'owned incomplete thumbnail'); entered.resolve();
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
  } });
  await run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(directory, 'clip.mp4')]);
  await fs.writeFile(path.join(directory, 'draft_info.json'), JSON.stringify(document('clip.mp4', 'video')));
  const before = sha(await fs.readFile(path.join(directory, 'clip.mp4')));
  const ready = await scanned(service, { directory }); assert.equal(ready.status, 'ready');
  const committing = service.commit(ready.id, { acknowledgeWarnings: true });
  // Observe rejection before triggering cancellation so it cannot be unhandled.
  const rejected = assert.rejects(committing, /已取消/);
  await entered.promise;
  assert.equal((await fs.readdir(store.dirs.work)).length, 1);
  const result = await service.cancel(ready.id); await rejected;
  assert.equal(result.status, 'cancelled'); await emptyLibrary(store);
  assert.equal(sha(await fs.readFile(path.join(directory, 'clip.mp4'))), before);
});

test('cancel after publication begins awaits actual completion', async t => {
  const { directory, store, service } = await setup(t);
  const ready = await scanned(service, { directory });
  const entered = deferred(), release = deferred(), publish = store.publishImport.bind(store);
  store.publishImport = async input => { entered.resolve(); await release.promise; return publish(input); };
  const committing = service.commit(ready.id, { acknowledgeWarnings: true }); await entered.promise;
  const cancelling = service.cancel(ready.id); release.resolve();
  const [committed, cancelledReport] = await Promise.all([committing, cancelling]);
  assert.equal(committed.status, 'completed'); assert.equal(cancelledReport.status, 'completed'); assert.equal(store.media.size, 1);
  assert.deepEqual(await fs.readdir(store.dirs.work), []);
});

test('publication failure cleans staging; completed publication retains cleanup ownership for close retry', async t => {
  let failRemoval = false;
  const { directory, store, service } = await setup(t, { remove: async (filename, options) => { if (failRemoval) { failRemoval = false; throw new Error('injected cleanup failure'); } return fs.rm(filename, options); } });
  const ready = await scanned(service, { directory }), publish = store.publishImport.bind(store);
  store.publishImport = async () => { throw new Error('injected publication failure'); };
  await assert.rejects(service.commit(ready.id, { acknowledgeWarnings: true }), /publication failure/); await emptyLibrary(store);
  store.publishImport = publish;
  const next = await scanned(service, { directory }); failRemoval = true;
  const result = await service.commit(next.id, { acknowledgeWarnings: true });
  assert.equal(result.status, 'completed'); assert.equal(result.cleanupPending, true); assert.equal(store.media.size, 1);
  assert.ok((await fs.readdir(store.dirs.work)).length === 1);
  await service.close(); assert.deepEqual(await fs.readdir(store.dirs.work), []);
});

test('expired sessions cannot commit and terminal sessions release bounded preflight capacity', async t => {
  let clock = 100000;
  const { directory, service } = await setup(t, { now: () => clock, maxSessions: 1 });
  const ready = await scanned(service, { directory });
  await assert.rejects(service.scan({ directory }), /预检/);
  await service.cancel(ready.id);
  const next = await scanned(service, { directory });
  clock += 10 * 60 * 1000 + 1;
  assert.throws(() => service.commit(next.id), /过期/);
});

test('a failed final close retains staging ownership and permits a cleanup retry', async t => {
  let removalFailures = 2;
  const { directory, store, service } = await setup(t, { remove: async (filename, options) => {
    if (removalFailures-- > 0) throw new Error('retained cleanup owner');
    return fs.rm(filename, options);
  } });
  const ready = await scanned(service, { directory });
  const result = await service.commit(ready.id, { acknowledgeWarnings: true });
  assert.equal(result.status, 'completed'); assert.equal(result.cleanupPending, true);
  await assert.rejects(service.close(), /retained cleanup owner/);
  assert.equal((await fs.readdir(store.dirs.work)).length, 1);
  await service.close(); assert.deepEqual(await fs.readdir(store.dirs.work), []);
  assert.equal(store.media.size, 1);
});

test('a replacement service recovers manifest-owned staging left by an interrupted import', async t => {
  let failRemoval = true;
  const { directory, store, service } = await setup(t, { remove: async (filename, options) => {
    if (failRemoval) { failRemoval = false; throw new Error('simulate process exit before cleanup'); }
    return fs.rm(filename, options);
  } });
  store.publishImport = async () => { throw new Error('stop before publication'); };
  const ready = await scanned(service, { directory });
  await assert.rejects(service.commit(ready.id, { acknowledgeWarnings: true }), /stop before publication/);
  const [staging] = await fs.readdir(store.dirs.work);
  assert.ok(staging.startsWith('jianying-import-'));
  const owner = JSON.parse(await fs.readFile(path.join(store.dirs.work, staging, 'owner.json'), 'utf8'));
  assert.equal(owner.id, ready.id);
  const replacement = createJianyingImportService(store); t.after(() => replacement.close());
  await replacement.ready();
  await emptyLibrary(store);
  assert.equal(sha(await fs.readFile(path.join(directory, 'tone.wav'))), sha(wav()));
});

test('staging recovery preserves unknown files and retries only after the ambiguity is resolved', async t => {
  let failRemoval = true;
  const { directory, store, service } = await setup(t, { remove: async (filename, options) => {
    if (failRemoval) { failRemoval = false; throw new Error('leave stage for recovery'); }
    return fs.rm(filename, options);
  } });
  store.publishImport = async () => { throw new Error('stop before publication'); };
  const ready = await scanned(service, { directory });
  await assert.rejects(service.commit(ready.id, { acknowledgeWarnings: true }), /stop before publication/);
  const [staging] = await fs.readdir(store.dirs.work), folder = path.join(store.dirs.work, staging);
  await fs.writeFile(path.join(folder, 'do-not-delete.txt'), 'unresolved ownership');
  const replacement = createJianyingImportService(store); t.after(() => replacement.close());
  await assert.rejects(replacement.ready(), /未知内容.*已保留/);
  assert.equal(await fs.readFile(path.join(folder, 'do-not-delete.txt'), 'utf8'), 'unresolved ownership');
  await fs.rm(path.join(folder, 'do-not-delete.txt'));
  await replacement.ready(); await emptyLibrary(store);
});

test('closing during the initial folder handshake cannot publish a late session', async t => {
  const { directory, store, service } = await setup(t);
  const starting = service.scan({ directory }), rejected = assert.rejects(starting, /正在关闭/);
  await service.close(); await rejected;
  await assert.rejects(service.scan({ directory }), /正在关闭/);
  await emptyLibrary(store);
});
