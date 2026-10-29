// IPC owns transport messages; arbitrary URLs, paths, JS and unbounded data never cross this bridge.
export const AUDIO_CAPTURE_FRAMES = 48000 * 30;
export const AUDIO_MESSAGE_BYTES = 2 * 1024 * 1024;
const integer = (v, max = 48000 * 901) => Number.isSafeInteger(v) && v >= 0 && v <= max;
const own = (v) => v && typeof v === 'object' && !Array.isArray(v);
function assertPlan(plan) {
  const finite = (v, limit = 1e9) => Number.isFinite(v) && Math.abs(v) <= limit;
  const array = (a, length) => Array.isArray(a) && a.length === length && a.every(v => finite(v));
  if (!own(plan) || plan.version !== 'weijian-shared-dsp-1' || plan.sampleRate !== 48000 || plan.channels !== 2 || !Array.isArray(plan.clips) || plan.clips.length > 64 || !integer(plan.outputFrames)) throw new Error('音频处理计划无效');
  if (new Set(plan.clips.map(c => c?.id)).size !== plan.clips.length) throw new Error('音频片段身份重复');
  for (const c of plan.clips) {
    if (!own(c) || typeof c.id !== 'string' || c.id.length > 200 || !integer(c.first) || !integer(c.end) || c.end < c.first || !integer(c.count) || c.count !== c.end - c.first || !finite(c.offset, 1) || !finite(c.duration, 901) || c.duration < 0 || typeof c.enabled !== 'boolean' || !finite(c.base, 2) || c.base < 0 || !own(c.pan) || ![c.pan.left,c.pan.right].every(v => finite(v,1) && v >= 0) || ![c.hp,c.lp].every(a => a === null || array(a,5)) || !integer(c.echoFrames,48000) || typeof c.effectSignature !== 'string' || c.effectSignature.length > 1000) throw new Error('音频片段处理计划无效');
    if (!own(c.effects) || !own(c.effects.echo) || !finite(c.effects.echo.decay,.8) || c.effects.echo.decay < 0 || !Array.isArray(c.gainSegments) || c.gainSegments.length < 1 || c.gainSegments.length > 130 || c.gainSegments.some(g => !own(g) || !finite(g.start, 901) || !finite(g.end, 901) || !array(g.coefficients,4)) || !finite(c.fadeIn,901) || !finite(c.fadeOut,901) || !['linear','easeIn','easeOut','equalPower'].includes(c.fadeInCurve) || !['linear','easeIn','easeOut','equalPower'].includes(c.fadeOutCurve)) throw new Error('音频增益处理计划无效');
  }
}
export function parseAudioCommand(value) {
  if (!own(value) || typeof value.type !== 'string' || JSON.stringify(value).length > AUDIO_MESSAGE_BYTES) throw new Error('音频命令格式或容量无效');
  const { type } = value;
  if (['retry', 'close', 'halt', 'capture-start', 'capture-stop'].includes(type)) return { type };
  if (!['install', 'plan', 'transport'].includes(type) || !integer(value.epoch, 1e9) || !integer(value.revision, 1e9) || !integer(value.frame)) throw new Error('音频时钟命令无效');
  const result = { type, epoch: value.epoch, revision: value.revision, frame: value.frame, playing: value.playing === true, muted: value.muted === true };
  if (type !== 'transport') {
    const plan = value.plan;
    assertPlan(plan);
    result.plan = plan;
  }
  if (type === 'install') {
    if (typeof value.lease !== 'string' || !/^[a-f0-9-]{1,100}$/i.test(value.lease) || !Array.isArray(value.assets) || value.assets.length > 64) throw new Error('音频素材租约无效');
    result.lease = value.lease;
    result.assets = value.assets.map(a => {
      if (!own(a) || typeof a.clipId !== 'string' || a.clipId.length > 200 || !/^[a-f0-9]{64}$/.test(a.key) || a.url !== `/api/audio-clock-assets/${a.key}` || !integer(a.frames) || a.sampleRate !== 48000 || a.channels !== 2 || a.format !== 'f32le') throw new Error('音频素材地址无效');
      return { clipId: a.clipId, key: a.key, url: a.url, frames: a.frames, sampleRate: 48000, channels: 2, format: 'f32le' };
    });
    if (new Set(result.assets.map(a => a.clipId)).size !== result.assets.length || result.plan.clips.some(c => !result.assets.some(a => a.clipId === c.id && a.frames === c.count))) throw new Error('音频素材与片段样本范围不匹配');
  }
  return result;
}
export function floatWav(chunks, frames) {
  if (!integer(frames, AUDIO_CAPTURE_FRAMES)) throw new Error('录制超出 30 秒');
  const bytes = frames * 8, result = new Uint8Array(44 + bytes), view = new DataView(result.buffer);
  const text = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + bytes, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 3, true); view.setUint16(22, 2, true); view.setUint32(24, 48000, true); view.setUint32(28, 384000, true); view.setUint16(32, 8, true); view.setUint16(34, 32, true); text(36, 'data'); view.setUint32(40, bytes, true);
  let offset = 44; for (const chunk of chunks) { result.set(new Uint8Array(chunk), offset); offset += chunk.byteLength; }
  if (offset !== result.length) throw new Error('录制样本不完整');
  return result;
}
