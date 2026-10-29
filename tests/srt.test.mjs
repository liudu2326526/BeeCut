import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSrt, serializeSrt, SrtError } from '../shared/srt.mjs';

test('SRT imports BOM, CRLF, optional numbering, multiline and overlapping cues as literal text', () => {
  const text = '\uFEFF9\r\n00:00:01,230 --> 00:00:03,500\r\n  山海 <b>原样</b> &amp;  \r\n{\\an8}100% [a]; $HOME\r\n\r\n00:00:02.000-->00:00:04.001\r\nsecond\r\n';
  const cues = parseSrt(text);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { text: '  山海 <b>原样</b> &amp;  \n{\\an8}100% [a]; $HOME', start: 1.23, duration: 2.27 });
  assert.equal(cues[1].start, 2);
  assert.ok(Math.abs(cues[1].duration - 2.001) < 1e-10);
  assert.deepEqual(parseSrt(' \n\t\n'), []);
});

test('SRT rejects malformed later blocks with exact cue and source line instead of losing them', () => {
  const valid = '1\n00:00:00,000 --> 00:00:01,000\nvalid\n\n';
  for (const [suffix, line, reason] of [
    ['2\n00:00:02,000 => 00:00:03,000\nbad', 6, /明确/],
    ['2\n00:60:02,000 --> 00:00:03,000\nbad', 6, /开始时间/],
    ['2\n00:00:02,000 --> 00:00:01,000\nbad', 6, /晚于/],
    ['2\n00:00:02,000 --> 00:00:02,000\nbad', 6, /晚于/],
    ['2\n-00:00:02,000 --> 00:00:03,000\nbad', 6, /开始时间/],
    ['2\n00:00:02,00 --> 00:00:03,000\nbad', 6, /开始时间/],
    ['2\n00:00:02,000 --> 00:00:03,000 align:start\nbad', 6, /结束时间/],
    ['2\n00:00:02,000 --> 00:00:03,000', 7, /不能为空/],
    ['2', 6, /缺少时间线/],
    ['unrecognized paragraph', 5, /明确/],
  ]) {
    assert.throws(() => parseSrt(valid + suffix), error => {
      assert.ok(error instanceof SrtError);
      assert.equal(error.cue, 2);
      assert.equal(error.line, line);
      assert.match(error.message, reason);
      return true;
    });
  }
});

test('SRT enforces current product boundaries before returning any partial result', () => {
  const cue = (text, timing = '00:00:00,000 --> 00:00:00,001') => `${timing}\n${text}`;
  assert.equal(parseSrt(cue('a'.repeat(2000)))[0].text.length, 2000);
  assert.throws(() => parseSrt(cue('a'.repeat(2001))), /2000/);
  assert.equal(parseSrt(cue('last', '00:14:59,999 --> 00:15:00,000'))[0].start, 899.999);
  assert.throws(() => parseSrt(cue('late', '00:14:59,999 --> 00:15:00,001')), /900 秒/);
  assert.equal(parseSrt(Array.from({ length: 120 }, () => cue('a')).join('\n\n')).length, 120);
  assert.throws(() => parseSrt(Array.from({ length: 121 }, () => cue('a')).join('\n\n')), error => error.cue === 121 && /120 条/.test(error.message));
  assert.throws(() => parseSrt(Array.from({ length: 16 }, () => cue('a'.repeat(2000))).join('\n\n')), error => error.cue === 16 && /30000/.test(error.message));
  assert.throws(() => parseSrt('a'.repeat(1024 * 1024 + 1)), /1048576/);
  assert.throws(() => parseSrt(cue('null\0text')), /空字符/);
  assert.throws(() => parseSrt(cue('a'), { maxCues: 0 }), /0 条/);
  assert.throws(() => parseSrt(cue('a'), { maxDuration: NaN }), TypeError);
  assert.throws(() => parseSrt(cue('a'), { maxTextLength: -1 }), TypeError);
  assert.throws(() => parseSrt(new Uint8Array()), TypeError);
});

test('SRT serialization sorts stably, preserves literal multiline text, and roundtrips millisecond boundaries', () => {
  const cues = [
    { text: '后\n<font>100% & \\</font>', start: 1.9996, duration: 2.0004 },
    { text: '  同起点一  ', start: 0, duration: .04 },
    { text: '同起点二', start: 0, duration: .05 },
    { text: '尾', start: 899.999, duration: .001 },
  ];
  const before = structuredClone(cues);
  const output = serializeSrt(cues);
  assert.equal(output, '1\n00:00:00,000 --> 00:00:00,040\n  同起点一  \n\n2\n00:00:00,000 --> 00:00:00,050\n同起点二\n\n3\n00:00:02,000 --> 00:00:04,000\n后\n<font>100% & \\</font>\n\n4\n00:14:59,999 --> 00:15:00,000\n尾\n');
  const imported = parseSrt(output);
  assert.deepEqual(imported.map(cue => cue.text), [cues[1].text, cues[2].text, cues[0].text, cues[3].text]);
  assert.deepEqual(cues, before, 'Export must not reorder or mutate the caller project.');
  assert.equal(serializeSrt(imported), output);
  assert.equal(serializeSrt([]), '');
});

test('SRT serialization refuses lossy or invalid cues instead of producing unreadable documents', () => {
  const valid = { text: 'literal', start: 0, duration: 1 };
  for (const change of [
    { start: -1 }, { start: NaN }, { duration: Infinity }, { duration: 0 },
    { duration: -.1 }, { start: 900, duration: .01 },
    { text: '' }, { text: 'a\0b' }, { text: 'a\n\nb' }, { text: 'a\n \nb' },
    { text: '\na' }, { text: 'a\n' }, { text: 'a'.repeat(2001) },
  ]) assert.throws(() => serializeSrt([{ ...valid, ...change }]), SrtError);
  assert.throws(() => serializeSrt([{ ...valid, duration: .0001 }]), /舍入后为 0/);
  assert.throws(() => serializeSrt([null]), SrtError);
  assert.throws(() => serializeSrt('no'), TypeError);
  assert.throws(() => serializeSrt(Array.from({ length: 121 }, () => valid)), /120 条/);
  assert.throws(() => serializeSrt(Array.from({ length: 16 }, () => ({ ...valid, text: 'a'.repeat(2000) }))), /30000/);
});
