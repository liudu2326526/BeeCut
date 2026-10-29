import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initializeLibrary, importLegacyLibrary } from './library.mjs';

const fixture = async (root, id, content = 'media') => {
  await Promise.all(['media', 'thumbnails', 'projects'].map(name => fs.mkdir(path.join(root, name), { recursive: true })));
  const media = { id, name: `${id}.mp4`, type: 'video', filename: `${id}.mp4`, url: `/media/${id}.mp4`, thumbnailUrl: '', duration: 5, width: 640, height: 360, hasAudio: false, size: content.length };
  const project = { id: 'project', version: 1, name: id, width: 640, height: 360, fps: 30, media: [{ ...media }], clips: [{ id: 'clip', mediaId: id, track: 'video', start: 0, sourceStart: 0, duration: 5, speed: 1, volume: 1 }], subtitles: [] };
  await fs.writeFile(path.join(root, 'media', media.filename), content);
  await fs.writeFile(path.join(root, 'media.json'), JSON.stringify([media]));
  await fs.writeFile(path.join(root, 'demo.json'), JSON.stringify(project));
  await fs.writeFile(path.join(root, 'projects/project.json'), JSON.stringify(project));
};

test('desktop seed initializes once, migration preserves both libraries and backs up current data', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'weijian-library-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const seed = path.join(temp, 'seed'), destination = path.join(temp, 'Library'), source = path.join(temp, 'old-web-data');
  await fixture(seed, 'desktop'); await fixture(source, 'old');
  await initializeLibrary(destination, seed);
  await fs.writeFile(path.join(destination, 'local-user-file.txt'), 'keep');
  await initializeLibrary(destination, seed);
  let closed = 0;
  const result = await importLegacyLibrary({ source, destination, beforeCommit: async () => { closed++; } });
  assert.equal(closed, 1);
  assert.equal(await fs.readFile(path.join(source, 'media/old.mp4'), 'utf8'), 'media');
  assert.equal(await fs.readFile(path.join(destination, 'local-user-file.txt'), 'utf8'), 'keep');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(destination, 'media.json'), 'utf8')).map(item => item.id), ['desktop', 'old']);
  assert.equal((await fs.readdir(path.join(destination, 'projects'))).length, 2);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(result.backup, 'media.json'), 'utf8')).map(item => item.id), ['desktop']);
});

test('migration rejects content conflicts before stopping the engine or changing the destination', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'weijian-conflict-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const destination = path.join(temp, 'Library'), source = path.join(temp, 'old');
  await fixture(destination, 'same', 'new'); await fixture(source, 'same', 'different');
  await assert.rejects(importLegacyLibrary({ source, destination, beforeCommit: async () => { assert.fail('engine must remain running'); } }), /冲突/);
  assert.equal(await fs.readFile(path.join(destination, 'media/same.mp4'), 'utf8'), 'new');
  assert.deepEqual((await fs.readdir(temp)).sort(), ['Library', 'old']);
});

test('engine shutdown failure leaves the original library in place and cleans migration staging', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'weijian-close-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const destination = path.join(temp, 'Library'), source = path.join(temp, 'old');
  await fixture(destination, 'desktop'); await fixture(source, 'old');
  await assert.rejects(importLegacyLibrary({ source, destination, beforeCommit: async () => { throw new Error('close failed'); } }), /close failed/);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(destination, 'media.json'), 'utf8')).map(item => item.id), ['desktop']);
  assert.deepEqual((await fs.readdir(temp)).sort(), ['Library', 'old']);
});
