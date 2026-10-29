import test from 'node:test';
import assert from 'node:assert/strict';
import { audioLaneLayout, audioClipTop } from '../src/audio-lane-layout.mjs';

test('legacy overlapping audio remains on its original lane and gets disjoint visible rows', () => {
  const clips = [
    { id: 'a', track: 'audio', start: 0, duration: 5 },
    { id: 'b', track: 'audio', start: 1, duration: 3 },
    { id: 'c', track: 'audio', start: 4, duration: 2 },
    { id: 'd', track: 'audio', layer: 2, start: 0, duration: 7 },
    { id: 'v', track: 'video', start: 0, duration: 9 },
  ];
  const before = JSON.stringify(clips), lanes = audioLaneLayout(clips, 4);
  assert.equal(JSON.stringify(clips), before);
  assert.equal(lanes.length, 4);
  assert.equal(lanes[0].rowCount, 2);
  assert.equal(lanes[0].height, 96);
  assert.equal(audioClipTop(lanes[0], 'a'), 7);
  assert.equal(audioClipTop(lanes[0], 'b'), 51);
  assert.equal(audioClipTop(lanes[0], 'c'), 51);
  assert.equal(lanes[1].height, 52);
  assert.equal(lanes[2].rows.get('d'), 0);
  assert.equal(lanes[0].rows.has('v'), false);
});

test('packing reuses a row at exact half-open clip boundaries and is deterministic', () => {
  const clips = Array.from({ length: 32 }, (_, i) => ({ id: `c${i}`, track: 'audio', layer: 3, start: i / 4, duration: 1 }));
  const result = audioLaneLayout(clips, 4)[3];
  assert.equal(result.rowCount, 4);
  for (let i = 4; i < clips.length; i++) assert.equal(result.rows.get(`c${i}`), result.rows.get(`c${i - 4}`));
  assert.deepEqual([...result.rows], [...audioLaneLayout(clips, 4)[3].rows]);
});
