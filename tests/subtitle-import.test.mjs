import test from 'node:test';
import assert from 'node:assert/strict';
import { subtitlesFromSrt } from '../src/subtitle-import.mjs';

const cue = (index, start, end, text = '字幕') => `${index}\n00:00:${start} --> 00:00:${end}\n${text}\n`;

test('rejects an entire SRT when a later cue is shorter than the project minimum', () => {
  const existing = [{ id: 'old', text: '已有字幕' }];
  const before = structuredClone(existing);
  let generated = 0;
  assert.throws(() => subtitlesFromSrt(
    `${cue(1, '00,000', '01,000')}\n${cue(2, '01,000', '01,001')}`,
    existing,
    () => `new-${++generated}`,
  ), /第 2 条.*1 毫秒.*40 毫秒/);
  assert.deepEqual(existing, before);
  assert.equal(generated, 0);
});

test('accepts exact 40 ms cues despite binary subtraction and assigns independent IDs and styles', () => {
  let generated = 0;
  const result = subtitlesFromSrt(
    `${cue(1, '10,010', '10,050', '甲')}\n${cue(2, '10,050', '11,000', '乙')}`,
    [],
    () => `new-${++generated}`,
  );
  assert.equal(result[0].duration, .04);
  assert.equal(result[0].id, 'new-1');
  assert.equal(result[1].id, 'new-2');
  assert.equal(result[0].fontSize, 56);
  assert.equal(result[0].outlineWidth, 56 / 24);
  assert.equal(result[0].outlineColor, '#000000');
});

test('enforces 120 cues across the existing project and imported file', () => {
  const existing = Array.from({ length: 119 }, () => ({ text: '已有' }));
  assert.equal(subtitlesFromSrt(cue(1, '00,000', '01,000'), existing).length, 1);
  assert.throws(() => subtitlesFromSrt(`${cue(1, '00,000', '01,000')}\n${cue(2, '01,000', '02,000')}`, existing), /第 2 条.*数量超过 1 条/);
});

test('enforces the combined text budget and rejects empty imports', () => {
  const existing = Array.from({ length: 15 }, () => ({ text: '甲'.repeat(1999) }));
  assert.equal(subtitlesFromSrt(cue(1, '00,000', '01,000', '乙'.repeat(15)), existing).length, 1);
  assert.throws(() => subtitlesFromSrt(cue(1, '00,000', '01,000', '乙'.repeat(16)), existing), /第 1 条.*字幕总字数超过 15/);
  assert.throws(() => subtitlesFromSrt('\uFEFF\r\n', []), /没有字幕条目/);
});
