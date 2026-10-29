import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createStore } from '../server/store.mjs';
import { createDraftImportAccess } from '../desktop/draft-import-access.mjs';
import { run } from '../server/process.mjs';

async function fixture(t, checkpoint) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'weijian-publication-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = await createStore(root, { importCheckpoint: checkpoint });
  await store.addMedia([{ id: 'old', filename: 'old.wav', url: '/media/old.wav' }]);
  await fs.writeFile(path.join(store.dirs.media, 'old.wav'), 'protected old media');
  const before = await fs.readFile(path.join(root, 'media.json'));
  const source = path.join(store.dirs.work, 'owned.wav'); await fs.writeFile(source, 'owned imported audio');
  const input = { project: { id: 'new-project', name: 'Imported' },
    media: [{ id: 'new-media', filename: 'new-media.wav', url: '/media/new-media.wav' }],
    files: [{ source, directory: 'media', filename: 'new-media.wav' }], report: { id: 'new-project' } };
  return { root, store, before, input };
}
async function preserved({ root, store, before }) {
  assert.deepEqual(await fs.readFile(path.join(root, 'media.json')), before);
  assert.deepEqual(await fs.readdir(store.dirs.projects), []);
  assert.deepEqual(await fs.readdir(store.dirs.media), ['old.wav']);
  assert.equal(await fs.readFile(path.join(store.dirs.media, 'old.wav'), 'utf8'), 'protected old media');
  assert.deepEqual(await fs.readdir(path.join(store.dirs.imports, '.pending')), []);
}

test('publication rollback at every externally visible precommit phase preserves exact old registry', async t => {
  for (const phase of ['journal', 'file:media', 'file:projects', 'file:imports', 'registry']) {
    await t.test(phase, async t => {
      const f = await fixture(t, actual => { if (actual === phase) throw new Error('injected fault'); });
      await assert.rejects(f.store.publishImport(f.input), /injected fault/);
      await preserved(f); assert.equal(f.store.media.size, 1);
    });
  }
});

test('crash after registry publication recovers before registry is loaded', async t => {
  const f = await fixture(t), moduleUrl = new URL('../server/store.mjs', import.meta.url).href;
  const script = `import {createStore} from ${JSON.stringify(moduleUrl)}; const s=await createStore(${JSON.stringify(f.root)},{importCheckpoint:p=>{if(p==='registry')process.exit(77)}}); await s.publishImport(${JSON.stringify(f.input)});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const [code] = await once(child, 'close'); assert.equal(code, 77, stderr);
  assert.notDeepEqual(await fs.readFile(path.join(f.root, 'media.json')), f.before);
  const restarted = await createStore(f.root); assert.equal(restarted.media.size, 1);
  await preserved(f);
});

test('owned prepublication allocation recovers a partial journal without interpreting its incomplete bytes', async t => {
  const f = await fixture(t), id = 'interrupted-allocation';
  const folder = path.join(f.store.dirs.imports, '.pending', id); await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'preparing.json'), JSON.stringify({ version: 1, id, projectId: 'new-project' }));
  await fs.writeFile(path.join(folder, 'projects.stage'), '{partial project');
  await fs.writeFile(path.join(folder, 'journal.json'), '{partial journal');
  await createStore(f.root); await preserved(f);
});

test('postcommit cleanup failure returns durable success and restart keeps imported project', async t => {
  const f = await fixture(t, phase => { if (phase === 'committed') throw new Error('cleanup needs retry'); });
  const result = await f.store.publishImport(f.input);
  assert.match(result.cleanupPending, /cleanup needs retry/); assert.equal(f.store.media.size, 2);
  const restarted = await createStore(f.root); assert.equal(restarted.media.size, 2);
  assert.equal(JSON.parse(await fs.readFile(path.join(restarted.dirs.projects, 'new-project.json'))).name, 'Imported');
  assert.deepEqual(await fs.readdir(path.join(restarted.dirs.imports, '.pending')), []);
});

test('foreign identical bytes at a racing destination are preserved and poison further store writes', async t => {
  let store;
  const f = await fixture(t, async phase => {
    if (phase === 'journal') await fs.writeFile(path.join(store.dirs.media, 'new-media.wav'), 'owned imported audio', { flag: 'wx' });
  }); store = f.store;
  await assert.rejects(store.publishImport(f.input), error => error.importRecoveryRequired === true);
  await assert.rejects(store.waitForWrites(), /恢复/);
  await assert.rejects(store.addMedia([{ id: 'later' }]), /恢复/);
  await assert.rejects(store.saveProject({ id: 'later' }), /恢复/);
  assert.deepEqual(await fs.readFile(path.join(f.root, 'media.json')), f.before);
  assert.equal(await fs.readFile(path.join(store.dirs.media, 'new-media.wav'), 'utf8'), 'owned imported audio');
  await assert.rejects(createStore(f.root), /不属于此事务/);
  // The external owner removes its file; recovery can now clean only ours.
  await fs.unlink(path.join(store.dirs.media, 'new-media.wav'));
  await createStore(f.root); await preserved(f);
});

test('changed owned final retains recovery evidence and retry succeeds after exact restoration', async t => {
  let store;
  const f = await fixture(t, async phase => {
    if (phase === 'file:media') { await fs.writeFile(path.join(store.dirs.media, 'new-media.wav'), 'changed'); throw new Error('interrupted'); }
  }); store = f.store;
  await assert.rejects(store.publishImport(f.input), error => error.importRecoveryRequired === true);
  assert.equal((await fs.readdir(path.join(store.dirs.imports, '.pending'))).length, 1);
  await fs.writeFile(path.join(store.dirs.media, 'new-media.wav'), 'owned imported audio');
  await createStore(f.root); await preserved(f);
});

test('normal import, draft publication and project save share one serialized registry owner', async t => {
  const f = await fixture(t);
  await Promise.all([f.store.publishImport(f.input), f.store.addMedia([{ id: 'parallel', filename: 'parallel.wav', url: '/media/parallel.wav' }]), f.store.saveProject({ id: 'existing', name: 'saved' })]);
  assert.deepEqual([...f.store.media.keys()].sort(), ['new-media', 'old', 'parallel']);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.root, 'media.json'))).map(m => m.id).sort(), ['new-media', 'old', 'parallel']);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.store.dirs.projects, 'existing.json'))).name, 'saved');
});

test('uncontrolled files and unreferenced publications are rejected before any final mutation', async t => {
  const f = await fixture(t);
  await assert.rejects(f.store.publishImport({ ...f.input, media: [] }), /数量不一致/);
  const outside = path.join(f.root, 'outside.wav'); await fs.writeFile(outside, 'outside');
  await assert.rejects(f.store.publishImport({ ...f.input, files: [{ ...f.input.files[0], source: outside }] }), /受控临时文件/);
  await preserved(f);
});

test('native path capabilities are exact, bound, single use, bounded and expiring', () => {
  let time = 0;
  const a = createDraftImportAccess({ now: () => time, lifetimeMs: 100, capacity: 2 });
  assert.throws(() => a.issueDirectory('relative'), { status: 403 });
  const folder = a.issueDirectory('/source'), media = a.issueMedia('/media.wav', 'session', 'source', 1);
  assert.throws(() => a.issueDirectory('/third'), /过多/);
  assert.throws(() => a.consumeMedia(folder, 'session', 'source'), { status: 403 });
  assert.throws(() => a.consumeMedia(media, 'other-session', 'source'), { status: 403 });
  assert.equal(a.consumeDirectory(folder), '/source');
  assert.throws(() => a.consumeDirectory(folder), { status: 403 });
  assert.throws(() => a.consumeMedia(media, 'session', 'source', 2), { status: 403 });
  assert.equal(a.consumeMedia(media, 'session', 'source', 1), '/media.wav');
  const expiring = a.issueDirectory('/expires'); time = 100;
  assert.throws(() => a.consumeDirectory(expiring), { status: 403 });
  const cleared = a.issueDirectory('/cleared'); a.clear(); assert.throws(() => a.consumeDirectory(cleared), { status: 403 });
});

test('already aborted processing never spawns a child', async () => {
  let spawned = false; const controller = new AbortController(); controller.abort();
  await assert.rejects(run(process.execPath, ['-e', 'process.exit(0)'], { signal: controller.signal, onChild: () => { spawned = true; } }), { name: 'AbortError' });
  assert.equal(spawned, false);
});

test('processing cancellation waits for actual child close and treats graceful zero exit as cancelled', async () => {
  const controller = new AbortController(); let child, closed = false;
  const operation = run(process.execPath, ['-e', "process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),75));console.log('ready');setInterval(()=>{},1000)"], {
    signal: controller.signal, onChild: value => { child = value; child.once('close', () => { closed = true; }); }, onProgress: () => controller.abort(),
  });
  await assert.rejects(operation, { name: 'AbortError' }); assert.equal(closed, true); assert.equal(child.exitCode, 0);
});
