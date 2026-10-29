const DEFAULT_LIMITS = Object.freeze({
  maxCues: 120,
  maxDuration: 900,
  maxTextLength: 2000,
  maxTotalTextLength: 30000,
  maxInputLength: 1024 * 1024,
});

export class SrtError extends Error {
  constructor(message, cue = 1, line = 1) {
    super(`SRT 第 ${cue} 条（第 ${line} 行）：${message}`);
    this.name = 'SrtError';
    this.cue = cue;
    this.line = line;
  }
}

function limitsFor(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('SRT 限制选项必须是对象');
  const limits = { ...DEFAULT_LIMITS, ...options };
  for (const key of ['maxCues', 'maxTextLength', 'maxTotalTextLength', 'maxInputLength']) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0) throw new TypeError(`${key} 必须为非负安全整数`);
  }
  if (!Number.isFinite(limits.maxDuration) || limits.maxDuration <= 0) throw new TypeError('maxDuration 必须为正数');
  return limits;
}

function timestamp(value, label, cue, line) {
  const parts = /^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})$/.exec(value);
  if (!parts) throw new SrtError(`${label}时间必须为 HH:MM:SS,mmm 或 HH:MM:SS.mmm`, cue, line);
  const result = Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3]) + Number(parts[4]) / 1000;
  if (!Number.isFinite(result)) throw new SrtError(`${label}时间超出范围`, cue, line);
  return result;
}

function validateText(value, cue, line, limits) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new SrtError('字幕文字不能为空或包含空字符', cue, line);
  if (value.length > limits.maxTextLength) throw new SrtError(`字幕文字超过 ${limits.maxTextLength} 字符`, cue, line);
}

/** Parse all cues or reject the document; never discard an unrecognized block. */
export function parseSrt(input, options = {}) {
  const limits = limitsFor(options);
  if (typeof input !== 'string') throw new TypeError('SRT 内容必须是字符串');
  if (input.length > limits.maxInputLength) throw new SrtError(`文件内容超过 ${limits.maxInputLength} 字符`);
  const lines = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const cues = [];
  let totalTextLength = 0;
  for (let cursor = 0; cursor < lines.length;) {
    if (!lines[cursor].trim()) { cursor++; continue; }
    const first = cursor;
    while (cursor < lines.length && lines[cursor].trim()) cursor++;
    const cue = cues.length + 1;
    if (cue > limits.maxCues) throw new SrtError(`字幕数量超过 ${limits.maxCues} 条`, cue, first + 1);
    let timing = first;
    if (/^\d+$/.test(lines[first].trim())) timing++;
    if (timing >= cursor) throw new SrtError('缺少时间线', cue, timing + 1);
    const endpoints = lines[timing].trim().split(/\s*-->\s*/);
    if (endpoints.length !== 2) throw new SrtError('缺少明确的开始 --> 结束时间线', cue, timing + 1);
    const start = timestamp(endpoints[0], '开始', cue, timing + 1);
    const end = timestamp(endpoints[1], '结束', cue, timing + 1);
    if (end <= start) throw new SrtError('结束时间必须晚于开始时间', cue, timing + 1);
    if (end > limits.maxDuration) throw new SrtError(`结束时间超过 ${limits.maxDuration} 秒`, cue, timing + 1);
    const text = lines.slice(timing + 1, cursor).join('\n');
    validateText(text, cue, timing + 2, limits);
    totalTextLength += text.length;
    if (totalTextLength > limits.maxTotalTextLength) throw new SrtError(`字幕总字数超过 ${limits.maxTotalTextLength}`, cue, timing + 2);
    cues.push({ text, start, duration: end - start });
  }
  return cues;
}

function formatMilliseconds(milliseconds) {
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor(milliseconds / 60000) % 60;
  const seconds = Math.floor(milliseconds / 1000) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds % 1000).padStart(3, '0')}`;
}

/** Export literal cue text with millisecond timing, in stable timeline order. */
export function serializeSrt(subtitles) {
  const limits = DEFAULT_LIMITS;
  if (!Array.isArray(subtitles)) throw new TypeError('SRT 字幕必须是数组');
  if (subtitles.length > limits.maxCues) throw new SrtError(`字幕数量超过 ${limits.maxCues} 条`, limits.maxCues + 1);
  let totalTextLength = 0;
  const cues = subtitles.map((subtitle, index) => {
    const cue = index + 1;
    if (!subtitle || typeof subtitle !== 'object') throw new SrtError('字幕信息无效', cue);
    const { start, duration } = subtitle;
    if (!Number.isFinite(start) || !Number.isFinite(duration) || start < 0 || duration <= 0 || !Number.isFinite(start + duration)) throw new SrtError('开始时间必须为非负数，时长必须为正数', cue);
    if (start + duration > limits.maxDuration) throw new SrtError(`结束时间超过 ${limits.maxDuration} 秒`, cue);
    const text = typeof subtitle.text === 'string' ? subtitle.text.replace(/\r\n?/g, '\n') : subtitle.text;
    validateText(text, cue, 1, limits);
    if (text.split('\n').some(line => !line.trim())) throw new SrtError('字幕文字包含空白行，无法无损保存为 SRT 条目', cue);
    totalTextLength += text.length;
    if (totalTextLength > limits.maxTotalTextLength) throw new SrtError(`字幕总字数超过 ${limits.maxTotalTextLength}`, cue);
    const startMs = Math.round(start * 1000);
    const endMs = Math.round((start + duration) * 1000);
    if (endMs <= startMs) throw new SrtError('时长经毫秒舍入后为 0，无法保存为 SRT', cue);
    return { text, start, startMs, endMs, index };
  });
  cues.sort((a, b) => a.start - b.start || a.index - b.index);
  return cues.map((cue, index) => `${index + 1}\n${formatMilliseconds(cue.startMs)} --> ${formatMilliseconds(cue.endMs)}\n${cue.text}\n`).join('\n');
}
