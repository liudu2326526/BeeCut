import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../server/index.mjs';
import { newProject } from '../shared/model.mjs';
import { run, ffmpegPath, ffprobePath } from '../server/process.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('offline audio preview and video export share detached/muted/gain/fade mix, producing real WAV and MP4', { timeout: 120000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'weijian-v08-audio-'));
  const runtime = await createApp({ dataDir: path.join(root, 'library') });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await runtime.queue.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const source = path.join(root, 'video-tone.mp4'), mutedSource = path.join(root, 'muted-tone.wav');
  await run(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=blue:s=128x128:r=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', source]);
  await run(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=3', '-c:a', 'pcm_s16le', mutedSource]);
  const form = new FormData();
  for (const file of [source, mutedSource]) form.append('files', new Blob([await fs.readFile(file)]), path.basename(file));
  const response = await fetch(`${base}/api/media`, { method: 'POST', body: form });
  assert.equal(response.status, 201);
  const { media } = await response.json();
  const [video, music] = [source, mutedSource].map(file => media.find(item => item.name === path.basename(file)));
  const clip = (id, mediaId, track, fields = {}) => ({ id, mediaId, track, start: 0, sourceStart: 0, duration: 3, speed: 1, volume: 1, ...fields });
  const project = { ...newProject('离线保调预听混音'), width: 128, height: 128, fps: 30, media, clips: [
    clip('picture', video.id, 'video', { audioDetached: true }),
    clip('detached', video.id, 'audio', { volume: .5, fadeIn: .5, fadeOut: .5, fadeInCurve: 'easeIn', fadeOutCurve: 'equalPower' }),
    clip('muted', music.id, 'audio', { muted: true, volume: 2 }),
  ] };
  const finish = async (endpoint, body) => {
    const response = await fetch(`${base}${endpoint}`, json(body));
    let job = await response.json();
    assert.equal(response.status, 202, JSON.stringify(job));
    for (let i = 0; i < 1000 && !['completed', 'failed', 'cancelled'].includes(job.status); i++) {
      await delay(20); job = await (await fetch(`${base}/api/exports/${job.id}`)).json();
    }
    assert.equal(job.status, 'completed', JSON.stringify(job));
    return job;
  };
  const audio = await finish('/api/audio-previews', { project });
  assert.match(audio.url, /\.wav$/);
  assert.match(audio.filename, /\.wav$/);
  const wave = path.join(root, 'preview.wav');
  await fs.writeFile(wave, Buffer.from(await (await fetch(`${base}${audio.url}`)).arrayBuffer()));
  const waveProbe = JSON.parse((await run(ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', wave])).stdout);
  assert.equal(waveProbe.streams.length, 1);
  assert.equal(waveProbe.streams[0].codec_name, 'pcm_s16le');
  assert.equal(waveProbe.streams[0].sample_rate, '48000');
  assert.equal(waveProbe.streams[0].channels, 2);
  assert.equal(waveProbe.streams[0].duration_ts, 144000);
  // Requesting audioOnly through the normal export endpoint must not silently
  // switch its contract: that endpoint validates and returns an actual MP4.
  const videoJob = await finish('/api/exports', { project, settings: { width: 128, height: 128, fps: 30, audioOnly: true } });
  assert.match(videoJob.url, /\.mp4$/);
  const movie = path.join(root, 'mixed.mp4');
  await fs.writeFile(movie, Buffer.from(await (await fetch(`${base}${videoJob.url}`)).arrayBuffer()));
  const decode = async file => {
    const raw = path.join(root, `${path.basename(file)}.f32`);
    await run(ffmpegPath, ['-v', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_f32le', '-f', 'f32le', raw]);
    return fs.readFile(raw);
  };
  // 100ms contains an integral 44/66 cycles for these two fixtures. This
  // prevents rectangular-window leakage from the live 440Hz tone from being
  // misclassified as the muted 660Hz source; mute threshold stays unchanged.
  const amplitude = (pcm, hz, time, seconds = .1) => {
    const first = Math.round((time - seconds / 2) * 48000), count = Math.round(seconds * 48000);
    let re = 0, im = 0;
    for (let n = 0; n < count; n++) { const value = pcm.readFloatLE((first + n) * 4), phase = 2 * Math.PI * hz * n / 48000; re += value * Math.cos(phase); im += value * Math.sin(phase); }
    return 2 * Math.hypot(re, im) / count;
  };
  const wavPcm = await decode(wave), mp4Pcm = await decode(movie);
  const middle = amplitude(wavPcm, 440, 1.5);
  assert.ok(Math.abs(middle - .125 * .5 / .95) < .003, `single detached source, -6.0206dB gain and existing limiter gain: ${middle}`);
  assert.ok(amplitude(wavPcm, 660, 1.5) < .001, 'muted 660Hz source is absent');
  assert.ok(Math.abs(amplitude(wavPcm, 440, .25) / middle - .25) < .04, 'quadratic fade-in is encoded');
  assert.ok(Math.abs(amplitude(wavPcm, 440, 2.75) / middle - Math.sin(Math.PI / 4)) < .04, 'sine fade-out is encoded');
  for (const time of [.25, 1.5, 2.75]) assert.ok(Math.abs(amplitude(mp4Pcm, 440, time) / amplitude(wavPcm, 440, time) - 1) < .05, 'native export and offline preview use the same gain/envelope mix');
  await runtime.queue.close();
  const files = await fs.readdir(runtime.store.dirs.work);
  assert.deepEqual(files, [], 'both jobs release owned work after completion');
  assert.deepEqual(await fs.readdir(runtime.store.dirs.projects), [], 'generating a preview does not save or overwrite projects');
  await fs.writeFile(path.join(runtime.store.dirs.exports, 'private.partial.wav'), 'incomplete');
  assert.equal((await fetch(`${base}/exports/private.partial.wav`)).status, 404, 'unfinished audio cannot be served');
  t.diagnostic(`PCM440 amplitude=${middle.toFixed(6)}, mute660=${amplitude(wavPcm, 660, 1.5).toFixed(6)}; both outputs share detached source and nonlinear fades.`);
});
