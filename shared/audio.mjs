import { keyProgressAt, keyProgressPolynomial, EASING_TYPES } from './easing.mjs';
// Linear gain remains the stored value; dB is an editing/display conversion.
export const MAX_AUDIO_GAIN = 2;
export const AUDIO_LANE_COUNT = 4;
export const MAX_AUDIO_GAIN_KEYS = 128;
export const AUDIO_EFFECT_LIMITS = Object.freeze({
  frequency: Object.freeze({ min: 20, max: 20000 }),
  delay: Object.freeze({ min: .01, max: 1 }),
  decay: Object.freeze({ min: 0, max: .8 }),
});
export const MAX_AUDIO_DB = 20 * Math.log10(MAX_AUDIO_GAIN);
export const MIN_AUDIO_DB = -60;
export const AUDIO_FADE_CURVES = Object.freeze([
  { type: 'linear', label: '线性', ffmpeg: 'tri' },
  { type: 'easeIn', label: '缓入', ffmpeg: 'qua' },
  { type: 'easeOut', label: '缓出', ffmpeg: 'ipar' },
  { type: 'equalPower', label: '正弦', ffmpeg: 'qsin' },
]);
const fadeCurve = type => {
  const curve = AUDIO_FADE_CURVES.find(curve => curve.type === type);
  if (!curve) throw new RangeError('音频淡化形状无效');
  return curve;
};
export function audioFadeFilterName(type = 'linear') { return fadeCurve(type).ffmpeg; }
export function audioFadeProgress(type = 'linear', progress) {
  fadeCurve(type);
  const u = Math.max(0, Math.min(1, progress));
  if (type === 'easeIn') return u * u;
  if (type === 'easeOut') return 1 - (1 - u) * (1 - u);
  if (type === 'equalPower') return Math.sin(Math.PI * u / 2);
  return u;
}
export function gainToDb(gain) { return gain === 0 ? -Infinity : 20 * Math.log10(gain); }
export function dbToGain(db) { return db === -Infinity ? 0 : 10 ** (db / 20); }
export function projectAudioLanes(project) {
  return Array.from({ length: AUDIO_LANE_COUNT }, (_, index) => ({ muted: project?.audioLanes?.[index]?.muted ?? false, solo: project?.audioLanes?.[index]?.solo ?? false }));
}
export function audioLaneSettings(project, index) {
  if (!Number.isInteger(index) || index < 0 || index >= AUDIO_LANE_COUNT) throw new RangeError('音频轨道无效');
  return projectAudioLanes(project)[index];
}
function audioGateReason(clip, project) {
  const audio = clipAudioSettings(clip), lanes = projectAudioLanes(project);
  if (audio.muted) return 'clip-muted';
  if (audio.audioDetached) return 'detached';
  const lane = clip.track === 'audio' ? lanes[clip.layer ?? 0] : null;
  if (lane?.muted) return 'lane-muted';
  if (lanes.some(lane => lane.solo) && !lane?.solo) return 'solo-excluded';
  return null;
}
export function clipAudioAudibility(clip, media, project) {
  const reason = !media?.hasAudio ? 'no-audio' : audioGateReason(clip, project);
  return { enabled: reason === null, reason, lane: clip.track === 'audio' ? clip.layer ?? 0 : null };
}
export function clipAudioPanGains(clip) {
  const pan = clip.pan ?? 0;
  return { left: pan > 0 ? 1 - pan : 1, right: pan < 0 ? 1 + pan : 1 };
}
// Global sample timestamps n/rate belong to [clip.start, clip.end). Assigning
// both ends on the same grid makes adjacent split clips disjoint and complete.
export function clipAudioSampleRange(clip, rate = 48000) {
  if (!Number.isFinite(clip.start) || !Number.isFinite(clip.duration) || !Number.isInteger(rate) || rate <= 0) throw new RangeError('音频采样范围无效');
  const atOrAfter = time => { const value = time * rate; return Math.ceil(value - 4 * Number.EPSILON * Math.max(1, Math.abs(value))); };
  const first = atOrAfter(clip.start), end = atOrAfter(clip.start + clip.duration);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(end) || end < first) throw new RangeError('音频采样范围无效');
  return { first, end, count: end - first, offset: Math.max(0, first / rate - clip.start) };
}
export function clipAudioEffects(clip) {
  const effects = clip.audioEffects ?? {};
  const selected = (type, key, fallback) => effects[type]?.[key] === undefined ? fallback : effects[type][key];
  return {
    highpass: { enabled: selected('highpass', 'enabled', false), frequency: selected('highpass', 'frequency', 80) },
    lowpass: { enabled: selected('lowpass', 'enabled', false), frequency: selected('lowpass', 'frequency', 12000) },
    echo: { enabled: selected('echo', 'enabled', false), delay: selected('echo', 'delay', .2), decay: selected('echo', 'decay', .3) },
  };
}
export function audioGainKeyframes(clip) { return clip.audioGainKeys ?? []; }
export const audioGainKeyProgressAt = keyProgressAt;
export function audioGainMultiplierAt(clip, time) {
  const keys = audioGainKeyframes(clip), local = time - clip.start;
  if (!keys.length) return 1;
  if (local <= keys[0].time) return keys[0].gain;
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i], b = keys[i + 1];
    if (local <= b.time) return a.gain + (b.gain - a.gain) * keyProgressAt(a, (local - a.time) / (b.time - a.time));
  }
  return keys.at(-1).gain;
}
export function upsertAudioGainKey(clip, time, gain = audioGainMultiplierAt(clip, time), easing = 'linear') {
  if (!Number.isFinite(time) || !Number.isFinite(gain) || gain < 0 || gain > MAX_AUDIO_GAIN || !EASING_TYPES.includes(easing)) throw new RangeError('音量关键帧时间、增益或缓动无效');
  const local = Math.max(0, Math.min(clip.duration, time - clip.start)), keys = audioGainKeyframes(clip);
  const existing = keys.find(key => Math.abs(key.time - local) < .000001);
  if (!existing && keys.length >= MAX_AUDIO_GAIN_KEYS) throw new RangeError(`工程音量关键帧总数不能超过 ${MAX_AUDIO_GAIN_KEYS}`);
  const key = { id: existing?.id ?? crypto.randomUUID(), time: local, gain, easing, phase: [0, 1] };
  return { ...clip, audioGainKeys: [...keys.filter(item => item.id !== existing?.id), key].sort((a, b) => a.time - b.time) };
}
export function removeAudioGainKey(clip, id) { return { ...clip, audioGainKeys: audioGainKeyframes(clip).filter(key => key.id !== id) }; }
export function setAudioGainKeyEasing(clip, id, easing) {
  if (!EASING_TYPES.includes(easing)) throw new RangeError('音量关键帧缓动无效');
  return { ...clip, audioGainKeys: audioGainKeyframes(clip).map(key => key.id === id ? { ...key, easing, phase: [0, 1] } : key) };
}
export function audioGainKeyNavigation(clip, time) {
  const local = time - clip.start, keys = audioGainKeyframes(clip);
  return { previous: keys.findLast(key => key.time < local - .000001), next: keys.find(key => key.time > local + .000001), current: keys.find(key => Math.abs(key.time - local) < .000001) };
}
export function sliceAudioGainKeys(clip, left, right) {
  const keys = audioGainKeyframes(clip);
  if (!keys.length) return [];
  const retained = keys.filter(key => key.time >= left && key.time <= right).map(key => key.time);
  if (left > keys[0].time && left < keys.at(-1).time) retained.push(left);
  if (right > keys[0].time && right < keys.at(-1).time) retained.push(right);
  if (!retained.length) retained.push(left);
  const points = [...new Set(retained)].sort((a, b) => a - b);
  return points.map((t, index) => {
    const original = keys.find(key => key.time === t), aIndex = keys.findIndex((key, i) => i + 1 < keys.length && t >= key.time && t < keys[i + 1].time);
    const result = { id: original?.id ?? crypto.randomUUID(), time: t - left, gain: audioGainMultiplierAt(clip, clip.start + t), easing: original?.easing ?? 'linear', phase: original?.phase ?? [0, 1] };
    if (index + 1 < points.length && aIndex >= 0) {
      const a = keys[aIndex], b = keys[aIndex + 1], phase = a.phase ?? [0, 1];
      result.easing = a.easing; result.phase = [t, points[index + 1]].map(value => phase[0] + (phase[1] - phase[0]) * (value - a.time) / (b.time - a.time));
    }
    return result;
  });
}
// Piecewise cubic gain in normalized interval time. The renderer can select an
// interval with a balanced tree: O(log keys), not O(keys) per audio sample.
export function audioGainPlan(clip) {
  const keys = audioGainKeyframes(clip);
  if (!keys.length) return [{ start: 0, end: clip.duration, coefficients: [1, 0, 0, 0] }];
  const result = [];
  if (keys[0].time > 0) result.push({ start: 0, end: keys[0].time, coefficients: [keys[0].gain, 0, 0, 0] });
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i], b = keys[i + 1], delta = b.gain - a.gain;
    const p = keyProgressPolynomial(a);
    result.push({ start: a.time, end: b.time, coefficients: [a.gain, p[1] * delta, p[2] * delta, p[3] * delta] });
  }
  if (keys.at(-1).time < clip.duration) result.push({ start: keys.at(-1).time, end: clip.duration, coefficients: [keys.at(-1).gain, 0, 0, 0] });
  return result.length ? result : [{ start: 0, end: clip.duration, coefficients: [keys[0].gain, 0, 0, 0] }];
}
export function clipFades(clip) {
  const fadeIn = Math.max(0, Math.min(clip.duration, clip.fadeIn ?? 0));
  const fadeOut = Math.max(0, Math.min(clip.duration - fadeIn, clip.fadeOut ?? 0));
  return { fadeIn, fadeOut };
}
export function clipAudioSettings(clip) {
  return { volume: clip.volume ?? 1, muted: clip.muted ?? false,
    audioDetached: clip.track === 'video' && (clip.audioDetached ?? false),
    ...clipFades(clip), fadeInCurve: clip.fadeInCurve ?? 'linear', fadeOutCurve: clip.fadeOutCurve ?? 'linear' };
}
export function clipAudioEnabled(clip, media, project) { return clipAudioAudibility(clip, media, project).enabled; }
// Absolute timeline seconds. Fade shapes operate on gain, independently of
// the source clock/speed and of the picture's animation or opacity.
export function audioGainAt(clip, time, project) {
  const elapsed = time - clip.start, audio = clipAudioSettings(clip);
  if (elapsed < 0 || elapsed >= clip.duration || audioGateReason(clip, project)) return 0;
  const gainIn = audio.fadeIn > 0 ? audioFadeProgress(audio.fadeInCurve, elapsed / audio.fadeIn) : 1;
  const gainOut = audio.fadeOut > 0 ? audioFadeProgress(audio.fadeOutCurve, (clip.duration - elapsed) / audio.fadeOut) : 1;
  return audio.volume * audioGainMultiplierAt(clip, time) * Math.min(gainIn, gainOut);
}

// The detached clip references the same immutable media, preserving the source
// mapping exactly. No visual-only fields/keys are copied to the audio lane.
export function detachClipAudio(project, clipId, audioId = crypto.randomUUID(), lane = 0) {
  audioLaneSettings(project, lane);
  const source = project.clips.find(clip => clip.id === clipId);
  const media = source && project.media.find(media => media.id === source.mediaId);
  if (!source || source.track !== 'video' || !media?.hasAudio)
    throw new RangeError('请选择包含原声的视频片段');
  if (source.audioDetached) throw new RangeError('该片段的音频已分离');
  if (project.clips.some(clip => clip.id === audioId)) throw new RangeError('分离音频的片段 ID 已存在');
  const audio = clipAudioSettings(source);
  const sound = { id: audioId, mediaId: source.mediaId, track: 'audio', layer: lane,
    start: source.start, sourceStart: source.sourceStart, duration: source.duration, speed: source.speed ?? 1,
    volume: audio.volume, muted: audio.muted, fadeIn: audio.fadeIn, fadeOut: audio.fadeOut,
    fadeInCurve: audio.fadeInCurve, fadeOutCurve: audio.fadeOutCurve,
    ...(source.pan === undefined ? {} : { pan: source.pan }),
    ...(source.audioEffects === undefined ? {} : { audioEffects: structuredClone(source.audioEffects) }),
    ...(source.audioGainKeys === undefined ? {} : { audioGainKeys: structuredClone(source.audioGainKeys) }),
    ...(source.speedSegments?.length ? { speedSegments: structuredClone(source.speedSegments) } : {}),
    ...(source.speedCurve ? { speedCurve: structuredClone(source.speedCurve) } : {}) };
  return { ...project, clips: [...project.clips.map(clip => clip.id === clipId ? { ...clip, audioDetached: true } : clip), sound] };
}
