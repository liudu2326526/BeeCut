import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { deflateSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '../server/index.mjs';
import { newProject } from '../shared/model.mjs';
import { ffmpegPath } from '../server/process.mjs';

const exec = promisify(execFile);
// A known RGBA source avoids accepting a renderer-derived color as the oracle.
function solidPng() {
  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const name = Buffer.from(type), size = Buffer.alloc(4), sum = Buffer.alloc(4);
    size.writeUInt32BE(data.length); sum.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([size, name, data, sum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(128, 0); header.writeUInt32BE(128, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((128 * 4 + 1) * 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) Buffer.from([200, 30, 30, 255]).copy(rows, y * (128 * 4 + 1) + 1 + x * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

test('actual exported key opacity consumes stable retained-phase coefficients at stationary easing endpoints', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'weijian-v09-phase-'));
  const runtime = await createApp({ dataDir: path.join(dir, 'library') }), server = runtime.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await runtime.queue.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
    await fs.rm(dir, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`, form = new FormData();
  form.append('files', new Blob([solidPng()]), 'solid.png');
  const imported = await fetch(origin + '/api/media', { method: 'POST', body: form }); assert.equal(imported.status, 201);
  const media = (await imported.json()).media, values = opacity => ({ scale: 1, x: 0, y: 0, rotation: 0, opacity });
  const definitions = [{ easing: 'easeOut', phase: [1 - 1e-8, 1] }, { easing: 'easeIn', phase: [0, 1e-200] }];
  const project = { ...newProject('Stable phase rendering'), width: 128, height: 128, fps: 30, media,
    clips: definitions.map((definition, i) => ({ id: 'clip' + i, mediaId: media[0].id, track: 'video', start: 2 * i, sourceStart: 0, duration: 2, speed: 1,
      transformKeys: [{ id: 'a' + i, time: 0, easing: definition.easing, phase: definition.phase, values: values(.2) },
        { id: 'b' + i, time: 2, easing: 'linear', phase: [0, 1], values: values(.8) }] })) };
  const queued = await fetch(origin + '/api/exports', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project, settings: { width: 128, height: 128, fps: 30, quality: 'high' } }) });
  assert.equal(queued.status, 202); let job = await queued.json();
  for (let i = 0; i < 2000 && !['completed', 'failed', 'cancelled'].includes(job.status); i++) {
    await new Promise(resolve => setTimeout(resolve, 10)); job = await (await fetch(`${origin}/api/exports/${job.id}`)).json();
  }
  assert.equal(job.status, 'completed', job.error);
  const { stdout } = await exec(ffmpegPath, ['-v', 'error', '-i', path.join(runtime.store.dirs.exports, job.id + '.mp4'), '-an', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
  assert.equal(stdout.length / (128 * 128 * 3), 120);
  let maximum = 0;
  for (let i = 0; i < 2; i++) for (const u of [.25, .5, .75]) {
    const frame = Math.round((2 * i + 2 * u) * 30), offset = (frame * 128 * 128 + 64 * 128 + 64) * 3;
    // Independent endpoint formulas; do not import model sampling as oracle.
    const progress = i === 0 ? 2 * u - u * u : u * u, opacity = .2 + .6 * progress;
    const actual = [...stdout.subarray(offset, offset + 3)], expected = [200, 30, 30].map(channel => channel * opacity);
    const error = Math.max(...actual.map((channel, j) => Math.abs(channel - expected[j]))); maximum = Math.max(maximum, error);
    assert.ok(error <= 6, JSON.stringify({ i, u, frame, actual, expected, error }));
  }
  t.diagnostic(JSON.stringify({ probes: 6, maximumChannelError: maximum }));
});
