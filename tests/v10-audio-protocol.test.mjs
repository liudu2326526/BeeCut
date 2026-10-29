import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAudioCommand, floatWav, AUDIO_CAPTURE_FRAMES } from '../desktop/audio-protocol.mjs';
import { compileAudioPlan } from '../shared/audio-dsp.mjs';
import { newProject } from '../shared/model.mjs';
import { createPCMProvider } from '../src/audio-host/pcm-provider.mjs';

test('desktop audio IPC preserves bounded named commands and rejects URLs/oversized clocks', () => {
  assert.deepEqual(parseAudioCommand({ type: 'retry' }), { type: 'retry' });
  const project = newProject(); project.media = [{id:'m',hasAudio:true}]; project.clips = [{id:'c',mediaId:'m',track:'audio',start:1/48000,duration:9009/48000,sourceStart:0,speed:1}]; const plan = compileAudioPlan(project);
  const base = { type: 'install', epoch: 1, revision: 1, frame: 0, plan, assets: [{ clipId: 'c', key: 'f'.repeat(64), url: `/api/audio-clock-assets/${'f'.repeat(64)}`, frames: 9009, sampleRate: 48000, channels: 2, format: 'f32le' }], lease: 'abcd' };
  assert.equal(parseAudioCommand(base).assets[0].url, base.assets[0].url);
  assert.throws(() => parseAudioCommand({ ...base, frame: 1e12 }));
  assert.throws(() => parseAudioCommand({ ...base, assets: [{ ...base.assets[0], url: 'file:///private/data' }] }));
  assert.throws(() => parseAudioCommand({ type: 'eval', code: '1' }));
});
test('capture Float32 WAV retains exact sample bytes and 30 second resource bound', () => {
  const samples = new Float32Array([.2, -.4, .6, -.8]);
  const wav = floatWav([samples.buffer], 2), view = new DataView(wav.buffer);
  assert.equal(view.getUint16(20, true), 3); assert.equal(view.getUint32(40, true), 16);
  assert.deepEqual(new Float32Array(wav.buffer.slice(44)), samples);
  assert.throws(() => floatWav([], AUDIO_CAPTURE_FRAMES + 1)); assert.throws(() => floatWav([], 1));
});
test('prepared PCM global window consumes server mapping once and pads frame/asset tails', async () => {
  const requests = [], source = new Float32Array([1, 2, 3, 4, 5, 6]);
  const read = createPCMProvider({ clips: [{ id: 'c', first: 3, end: 6 }] }, [{ clipId: 'c', frames: 3, url: '/asset' }], 'lease', { fetcher: async url => {
    requests.push(url); const q = new URL(url, 'http://test').searchParams, first = Number(q.get('first')), count = Number(q.get('frames'));
    return { ok: true, arrayBuffer: async () => source.slice(first * 2, (first + count) * 2).buffer };
  } });
  assert.deepEqual((await read(1, 8)).c, new Float32Array([0,0,0,0,1,2,3,4,5,6,0,0,0,0,0,0]));
  assert.match(requests[0], /first=0&frames=3&lease=lease/);
  assert.deepEqual(await read(6, 8), {});
});
