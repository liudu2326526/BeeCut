import { parseSrt } from '../shared/srt.mjs';

// SRT itself permits millisecond cues. The editor's persisted project contract
// requires at least 40 ms, so reject the entire import before creating UI items.
export function subtitlesFromSrt(input, existing, makeId = () => crypto.randomUUID()) {
  const cues = parseSrt(input, {
    maxCues: Math.max(0, 120 - existing.length),
    maxDuration: 900,
    maxTotalTextLength: Math.max(0, 30000 - existing.reduce((sum, cue) => sum + cue.text.length, 0)),
  });
  if (!cues.length) throw new Error('SRT 文件中没有字幕条目');
  const normalized = cues.map((cue, index) => {
    // The source timestamps have millisecond precision; this avoids rejecting
    // a valid 40 ms cue because binary subtraction yielded 0.039999999999.
    const milliseconds = Math.round(cue.duration * 1000);
    if (milliseconds < 40)
      throw new Error(`SRT 第 ${index + 1} 条：时长为 ${milliseconds} 毫秒，工程字幕至少需要 40 毫秒；整份文件未导入`);
    return { ...cue, duration: milliseconds / 1000 };
  });
  return normalized.map(cue => ({
    ...cue,
    id: makeId(),
    fontSize: 56,
    color: '#ffffff',
    position: 'bottom',
    outlineWidth: 56 / 24,
    outlineColor: '#000000',
  }));
}
