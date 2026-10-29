import { MAX_SPEED_CURVE_POINTS, MAX_SPEED_CURVE_SOURCE_SLOPE, curveRate, curvePlan, curveTimelineAt, curveSourceAt, curveSourcesAt, sliceSpeedCurve, curveRenderKnots, sampleSpeedCurve, speedCurveMaxSourceSlope, assertSpeedCurveSupported, curveAudioPlan } from './speed-curve.mjs';
export { MAX_SPEED_CURVE_POINTS, MAX_SPEED_CURVE_SOURCE_SLOPE, speedCurveMaxSourceSlope, assertSpeedCurveSupported, curveRenderKnots, curveAudioPlan };
import { TRANSITION_TYPES, animationEffectAt, animationAlphaProgress, transitionEffectAt } from './effects.mjs';
import { clipFades, sliceAudioGainKeys, audioGainKeyframes, projectAudioLanes } from './audio.mjs';
import { easingAt, keyProgressAt } from './easing.mjs';
export { easingAt } from './easing.mjs';
export { AUDIO_FADE_CURVES, MAX_AUDIO_GAIN, MAX_AUDIO_DB, MIN_AUDIO_DB, AUDIO_LANE_COUNT, MAX_AUDIO_GAIN_KEYS, AUDIO_EFFECT_LIMITS, audioFadeFilterName, audioFadeProgress, clipAudioSettings, clipAudioEnabled, clipAudioAudibility, projectAudioLanes, audioLaneSettings, clipAudioPanGains, clipAudioSampleRange, clipAudioEffects, audioGainKeyframes, audioGainMultiplierAt, audioGainKeyProgressAt, upsertAudioGainKey, removeAudioGainKey, setAudioGainKeyEasing, audioGainKeyNavigation, audioGainAt, gainToDb, dbToGain, detachClipAudio, clipFades } from './audio.mjs';
export const PROJECT_VERSION = 1;
export const VIDEO_LAYER_COUNT = 4;
// Measured with 128 animated five-property keys at 720p. This also bounds
// filter-expression expansion across all clips, rather than only JSON bytes.
export const MAX_TRANSFORM_KEYS = 128;
export const MAX_DECODE_INPUTS = 64;
export function clipLayer(clip) {
  return clip.layer ?? 0;
}
export function clipTransform(clip) {
  const value = clip.transform ?? {};
  return {
    scale: value.scale ?? 1,
    x: value.x ?? 0,
    y: value.y ?? 0,
    rotation: value.rotation ?? 0,
    opacity: value.opacity ?? 1,
    flipX: value.flipX ?? false,
    flipY: value.flipY ?? false,
  };
}
const poseFields = ['scale', 'x', 'y', 'rotation', 'opacity'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function transformKeyframes(clip) { return clip.transformKeys ?? []; }
export const transformKeyProgressAt = keyProgressAt;
export function transformAt(clip, time) {
  const base = clipTransform(clip), keys = transformKeyframes(clip);
  if (!keys.length) return base;
  const local = time - clip.start;
  if (local <= keys[0].time) return { ...base, ...keys[0].values };
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i], b = keys[i + 1];
    if (local <= b.time) {
      const u = transformKeyProgressAt(a, (local - a.time) / (b.time - a.time));
      return { ...base, ...Object.fromEntries(poseFields.map(name => [name, a.values[name] + (b.values[name] - a.values[name]) * u])) };
    }
  }
  return { ...base, ...keys.at(-1).values };
}
export function upsertTransformKey(clip, time, values = {}, easing = 'linear') {
  const local = clamp(time - clip.start, 0, clip.duration);
  const keys = transformKeyframes(clip);
  const existing = keys.find(key => Math.abs(key.time - local) < .000001);
  const pose = { ...transformAt(clip, clip.start + local), ...values };
  const key = { id: existing?.id ?? crypto.randomUUID(), time: local,
    values: Object.fromEntries(poseFields.map(name => [name, pose[name]])), easing, phase: [0, 1] };
  return { ...clip, transformKeys: [...keys.filter(item => item.id !== existing?.id), key].sort((a, b) => a.time - b.time) };
}
export function removeTransformKey(clip, id, time = clip.start) {
  const keys = transformKeyframes(clip).filter(key => key.id !== id);
  return { ...clip, ...(!keys.length ? { transform: transformAt(clip, time) } : {}), transformKeys: keys };
}
export function setTransformKeyEasing(clip, id, easing) {
  return { ...clip, transformKeys: transformKeyframes(clip).map(key => key.id === id ? { ...key, easing, phase: [0, 1] } : key) };
}
export function transformKeyNavigation(clip, time) {
  const local = time - clip.start, keys = transformKeyframes(clip);
  return { previous: keys.findLast(key => key.time < local - .000001),
    next: keys.find(key => key.time > local + .000001), current: keys.find(key => Math.abs(key.time - local) < .000001) };
}
export function clipSpeedCurve(clip) { return clip.speedCurve ?? null; }
export function decodeInputCount(clip) { return clipSpeedCurve(clip) ? 1 : Math.max(1, clip.speedSegments?.length ?? 0); }
export function projectDecodeInputCount(project) { return project.clips.reduce((n, clip) => n + decodeInputCount(clip), 0); }
export function speedCurveSamples(clip, count = 101) {
  const timing = clipTiming(clip), curve = clipSpeedCurve(clip);
  const length = Math.max(2, Math.min(1001, Math.floor(count)));
  if (curve) return sampleSpeedCurve(curve, length).map(point => ({ position: point.position, sourceTime: clip.sourceStart + point.sourceOffset, time: clip.start + point.time, rate: point.rate }));
  return Array.from({ length }, (_, i) => {
    const position = i / (length - 1), sourceTime = timing.sourceStart + position * timing.sourceDuration;
    return { position, sourceTime, time: timelineTimeAtSource(clip, sourceTime), rate: curve ? curveRate(curve, position) : sourceRateAt(clip, timelineTimeAtSource(clip, sourceTime)) };
  });
}
export function speedCurvePointBounds(clip, id) {
  const curve = clipSpeedCurve(clip), index = curve?.points.findIndex(point => point.id === id) ?? -1;
  if (index < 0) return null;
  const fixed = index === 0 || index === curve.points.length - 1;
  return { fixed, min: fixed ? curve.points[index].position : curve.points[index - 1].position + .000001,
    max: fixed ? curve.points[index].position : curve.points[index + 1].position - .000001, minSpeed: .25, maxSpeed: 4 };
}
export function createSpeedCurve(clip, preset = 'smooth', media) {
  const presets = { smooth: [[0, 1], [1, 1]], rampUp: [[0, .5], [1, 2]], rampDown: [[0, 2], [1, .5]],
    montage: [[0, 1], [.25, 3], [.5, .5], [.75, 3], [1, 1]] };
  const values = presets[preset];
  if (!values) throw new RangeError('速度曲线预设无效');
  return changeClipTiming(clip, { speedCurve: { sourceDuration: clipTiming(clip).sourceDuration,
    points: values.map(([position, speed]) => ({ id: crypto.randomUUID(), position, speed, phase: [0, 1] })) } }, media);
}
export function updateSpeedCurvePoint(clip, id, patch, media) {
  const curve = clipSpeedCurve(clip), bounds = speedCurvePointBounds(clip, id);
  if (!curve || !bounds) return clip;
  const points = curve.points.map(point => point.id === id ? { ...point,
    position: clamp(patch.position ?? point.position, bounds.min, bounds.max), speed: clamp(patch.speed ?? point.speed, .25, 4), phase: [0, 1] } : point);
  // Editing either endpoint of a clipped subcurve intentionally defines a new
  // full smooth interval, rather than exposing the retained internal phase.
  const index = points.findIndex(point => point.id === id);
  if (index > 0) points[index - 1] = { ...points[index - 1], phase: [0, 1] };
  return changeClipTiming(clip, { speedCurve: { ...curve, points } }, media);
}
export function addSpeedCurvePoint(clip, position, speed, media) {
  const curve = clipSpeedCurve(clip);
  if (!curve) return createSpeedCurve(clip, 'smooth', media);
  const p = clamp(position, .000001, .999999);
  if (curve.points.some(point => Math.abs(point.position - p) < .000001)) return clip;
  const points = [...curve.points, { id: crypto.randomUUID(), position: p, speed: clamp(speed ?? curveRate(curve, p), .25, 4), phase: [0, 1] }].sort((a, b) => a.position - b.position);
  return changeClipTiming(clip, { speedCurve: { ...curve, points } }, media);
}
export function removeSpeedCurvePoint(clip, id, media) {
  const curve = clipSpeedCurve(clip), bounds = speedCurvePointBounds(clip, id);
  if (!curve || !bounds || bounds.fixed) return clip;
  const points = curve.points.filter(point => point.id !== id);
  const index = curve.points.findIndex(point => point.id === id);
  points[index - 1] = { ...points[index - 1], phase: [0, 1] };
  return changeClipTiming(clip, { speedCurve: { ...curve, points } }, media);
}
// Source spans own timing. Segment starts are derived clip-local timeline times.
export function clipTiming(clip) {
  const curve = clipSpeedCurve(clip);
  if (curve) {
    const duration = curvePlan(curve).duration;
    return { mode: 'curve', sourceStart: clip.sourceStart, sourceDuration: curve.sourceDuration,
      sourceEnd: clip.sourceStart + curve.sourceDuration, duration,
      segments: [{ sourceStart: clip.sourceStart, sourceDuration: curve.sourceDuration, speed: 1, start: 0, duration }] };
  }
  const raw = clip.speedSegments?.length ? clip.speedSegments : [{ sourceDuration: clip.duration * (clip.speed ?? 1), speed: clip.speed ?? 1 }];
  let source = clip.sourceStart, start = 0;
  const segments = raw.map(part => {
    const duration = part.sourceDuration / part.speed;
    const segment = { sourceStart: source, sourceDuration: part.sourceDuration, speed: part.speed, start, duration };
    source += part.sourceDuration; start += duration;
    return segment;
  });
  return { mode: clip.speedSegments?.length ? 'segments' : 'constant', sourceStart: clip.sourceStart, sourceDuration: source - clip.sourceStart, sourceEnd: source, duration: start, segments };
}
export function sourceTimeAt(clip, time) {
  const timing = clipTiming(clip), local = clamp(time - clip.start, 0, timing.duration);
  if (clipSpeedCurve(clip)) return clip.sourceStart + curveSourceAt(clip.speedCurve, local) * timing.sourceDuration;
  const segment = timing.segments.find(part => local < part.start + part.duration) ?? timing.segments.at(-1);
  return segment.sourceStart + clamp(local - segment.start, 0, segment.duration) * segment.speed;
}
export function sourceTimesAt(clip, timelineTimes) {
  if (!clipSpeedCurve(clip)) return timelineTimes.map(time => sourceTimeAt(clip, time));
  return curveSourcesAt(clip.speedCurve, timelineTimes.map(time => time - clip.start))
    .map(position => clip.sourceStart + position * clip.speedCurve.sourceDuration);
}
export function timelineTimeAtSource(clip, sourceTime) {
  const timing = clipTiming(clip), source = clamp(sourceTime, timing.sourceStart, timing.sourceEnd);
  if (clipSpeedCurve(clip)) return clip.start + curveTimelineAt(clip.speedCurve, (source - clip.sourceStart) / timing.sourceDuration);
  const segment = timing.segments.find(part => source < part.sourceStart + part.sourceDuration) ?? timing.segments.at(-1);
  return clip.start + segment.start + (source - segment.sourceStart) / segment.speed;
}
export function sourceRateAt(clip, time) {
  const timing = clipTiming(clip), local = clamp(time - clip.start, 0, timing.duration);
  if (clipSpeedCurve(clip)) return curveRate(clip.speedCurve, curveSourceAt(clip.speedCurve, local));
  return (timing.segments.find(part => local < part.start + part.duration) ?? timing.segments.at(-1)).speed;
}
export function clipTrimBounds(clip, media) {
  if (media?.type === 'image') return { minStart: 0, maxEnd: clip.start + 900 };
  const timing = clipTiming(clip);
  return { minStart: Math.max(0, clip.start - clip.sourceStart / sourceRateAt(clip, clip.start)),
    maxEnd: clip.start + clip.duration + Math.max(0, (media?.duration ?? timing.sourceEnd) - timing.sourceEnd) / sourceRateAt(clip, clip.start + clip.duration) };
}
function sliceKeys(clip, left, right) {
  const keys = transformKeyframes(clip);
  if (!keys.length) return [];
  const points = keys.filter(key => key.time >= left && key.time <= right).map(key => key.time);
  if (left > keys[0].time && left < keys.at(-1).time) points.push(left);
  if (right > keys[0].time && right < keys.at(-1).time) points.push(right);
  if (!points.length) points.push(clamp(left, keys[0].time, keys.at(-1).time));
  const ordered = [...new Set(points)].sort((a, b) => a - b);
  return ordered.map((t, index) => {
    const original = keys.find(key => key.time === t);
    const pose = transformAt(clip, clip.start + t);
    const result = { id: original?.id ?? crypto.randomUUID(), time: clamp(t - left, 0, right - left),
      values: Object.fromEntries(poseFields.map(name => [name, pose[name]])), easing: original?.easing ?? 'linear', phase: original?.phase ?? [0, 1] };
    const end = ordered[index + 1];
    const aIndex = keys.findIndex((key, i) => i + 1 < keys.length && t >= key.time && t < keys[i + 1].time);
    if (end !== undefined && aIndex >= 0) {
      const a = keys[aIndex], b = keys[aIndex + 1], phase = a.phase ?? [0, 1];
      result.easing = a.easing;
      result.phase = [t, end].map(value => phase[0] + (phase[1] - phase[0]) * (value - a.time) / (b.time - a.time));
    }
    return result;
  });
}
function clampEnvelopes(clip) {
  const fades = clipFades(clip), animation = clipAnimation(clip);
  animation.in = clamp(animation.in, 0, clip.duration);
  animation.out = clamp(animation.out, 0, clip.duration - animation.in);
  return { ...clip, ...fades, animation };
}
export function trimClip(clip, { start = clip.start, end = clip.start + clip.duration }, media) {
  const bounds = clipTrimBounds(clip, media);
  start = clamp(start, bounds.minStart, clip.start + clip.duration - .04);
  end = clamp(end, start + .04, Math.min(bounds.maxEnd, start + 900));
  const left = start - clip.start, right = end - clip.start;
  const timing = clipTiming(clip), spans = [];
  if (clipSpeedCurve(clip)) {
    const curve = clip.speedCurve;
    const sourcePosition = local => local < 0 ? local * curveRate(curve, 0) / curve.sourceDuration
      : local > timing.duration ? 1 + (local - timing.duration) * curveRate(curve, 1) / curve.sourceDuration
      : curveSourceAt(curve, local);
    const a = sourcePosition(left), b = sourcePosition(right), animation = clipAnimation(clip);
    const speedCurve = sliceSpeedCurve(curve, a, b);
    const duration = curvePlan(speedCurve).duration;
    if (duration < .04 - 1e-9) throw new RangeError('保留的素材曲线区间短于0.04秒，请降低速度或扩大源区间');
    return clampEnvelopes({ ...clip, start, sourceStart: Math.max(0, clip.sourceStart + a * curve.sourceDuration),
      duration: Math.max(.04, duration), speed: 1, speedSegments: [], speedCurve,
      transformKeys: sliceKeys(clip, left, right), audioGainKeys: sliceAudioGainKeys(clip, left, right), fadeIn: left > 0 ? 0 : clip.fadeIn, fadeOut: right < clip.duration ? 0 : clip.fadeOut,
      animation: { ...animation, in: left > 0 ? 0 : animation.in, out: right < clip.duration ? 0 : animation.out } });
  }
  const all = [...(left < 0 ? [{ sourceStart: clip.sourceStart + left * timing.segments[0].speed, start: left, duration: -left, speed: timing.segments[0].speed }] : []), ...timing.segments,
    ...(right > clip.duration ? [{ sourceStart: timing.sourceEnd, start: clip.duration, duration: right - clip.duration, speed: timing.segments.at(-1).speed }] : [])];
  let sourceStart;
  for (const part of all) {
    const a = Math.max(left, part.start), b = Math.min(right, part.start + part.duration);
    if (b <= a) continue;
    if (sourceStart === undefined) sourceStart = part.sourceStart + (a - part.start) * part.speed;
    const sourceDuration = (b - a) * part.speed;
    const previous = spans.at(-1);
    if (previous?.speed === part.speed) previous.sourceDuration += sourceDuration;
    else spans.push({ sourceDuration, speed: part.speed });
  }
  const animation = clipAnimation(clip);
  return clampEnvelopes({ ...clip, start, duration: Math.max(.04, end - start), sourceStart: media?.type === 'image' ? 0 : Math.max(0, sourceStart),
    ...(clip.speedSegments?.length ? { speed: 1, speedSegments: spans } : {}), transformKeys: sliceKeys(clip, left, right), audioGainKeys: sliceAudioGainKeys(clip, left, right),
    fadeIn: left > 0 ? 0 : clip.fadeIn, fadeOut: right < clip.duration ? 0 : clip.fadeOut,
    animation: { ...animation, in: left > 0 ? 0 : animation.in, out: right < clip.duration ? 0 : animation.out } });
}
export function changeClipTiming(clip, patch, media) {
  let result = { ...clip };
  const timing = clipTiming(clip);
  if (patch.speed !== undefined || patch.speedSegments !== undefined || patch.speedCurve !== undefined) {
    result.speedCurve = undefined;
    if (patch.speedCurve && media?.type !== 'image') {
      result.speedCurve = { sourceDuration: patch.speedCurve.sourceDuration ?? timing.sourceDuration,
        points: patch.speedCurve.points.map(point => ({ id: point.id, position: point.position, speed: point.speed, phase: point.phase ?? [0, 1] })) };
      assertSpeedCurveSupported(result.speedCurve);
      result.speed = 1; result.speedSegments = []; result.duration = curvePlan(result.speedCurve).duration;
      if (result.duration < .04 - 1e-9) throw new RangeError('平滑变速总时长不能短于0.04秒，请降低速度或扩大源区间');
    } else if (patch.speedSegments?.length && media?.type !== 'image') {
      result.speedSegments = patch.speedSegments.map(part => ({ sourceDuration: part.sourceDuration, speed: clamp(part.speed, .25, 4) }));
      result.speed = 1;
    } else {
      result.speedSegments = [];
      // Preserve the selected source span while respecting the minimum clip
      // duration; a very short selection cannot be accelerated beyond this.
      result.speed = clamp(patch.speed ?? clip.speed ?? 1, .25, Math.min(4, timing.sourceDuration / .04));
      result.duration = Math.max(.04, timing.sourceDuration / result.speed);
    }
    if (result.speedSegments.length) {
      result.duration = clipTiming(result).duration;
      if (result.duration < .04 - .000000001) throw new RangeError('分段变速总时长不能短于 0.04 秒，请降低速度或扩大源区间');
      result.duration = Math.max(.04, result.duration);
    }
    result.transformKeys = transformKeyframes(clip).map(key => ({ ...key, time: key.time * result.duration / clip.duration }));
    result.audioGainKeys = audioGainKeyframes(clip).map(key => ({ ...key, time: key.time * result.duration / clip.duration }));
  }
  if (patch.start !== undefined) result.start = Math.max(0, patch.start);
  if (patch.sourceStart !== undefined) result.sourceStart = media?.type === 'image' ? 0 : clamp(patch.sourceStart, 0, Math.max(0, (media?.duration ?? 900) - .04 * sourceRateAt(result, result.start)));
  result = clampEnvelopes(result);
  if (patch.duration !== undefined) result = trimClip(result, { end: result.start + patch.duration }, media);
  if (media?.type !== 'image' && clipTiming(result).sourceEnd > (media?.duration ?? Infinity)) {
    const availableEnd = timelineTimeAtSource(result, media.duration);
    if (clipSpeedCurve(result) && availableEnd - result.start < .04 - 1e-9) throw new RangeError('素材剩余区间按该曲线不足0.04秒，请提前素材入点或降低速度');
    result = trimClip(result, { end: availableEnd }, media);
  }
  return result;
}
export function clipAdjustments(clip) {
  const value = clip.adjustments ?? {};
  return {
    brightness: value.brightness ?? 1,
    contrast: value.contrast ?? 1,
    saturation: value.saturation ?? 1,
  };
}
export function clipAnimation(clip) {
  const value = clip.animation ?? {};
  return { in: value.in === undefined ? 0 : value.in, out: value.out === undefined ? 0 : value.out,
    inType: value.inType ?? 'fade', outType: value.outType ?? 'fade', easing: value.easing ?? 'linear' };
}
// Visual fades multiply the picture's alpha. Audio envelopes have their own
// fields, so changing an entry/exit animation never changes the soundtrack.
export function animationAlphaAt(clip, time) {
  const elapsed = time - clip.start;
  if (elapsed < 0 || elapsed >= clip.duration) return 0;
  const animation = clipAnimation(clip);
  return Math.max(0, Math.min(
    animation.in > 0 ? animationAlphaProgress(animation.inType, easingAt(animation.easing, elapsed / animation.in)) : 1,
    animation.out > 0 ? animationAlphaProgress(animation.outType, easingAt(animation.easing, (clip.duration - elapsed) / animation.out)) : 1,
    1,
  ));
}
export function pictureTransformAt(clip, time, project) {
  const pose = transformAt(clip, time), animation = clipAnimation(clip);
  const local = clamp(time - clip.start, 0, clip.duration);
  for (const [type, duration, elapsed] of [[animation.inType, animation.in, local],
    [animation.outType, animation.out, clip.duration - local]]) {
    if (!duration) continue;
    const motion = animationEffectAt(type, easingAt(animation.easing, elapsed / duration), project);
    pose.x += motion.x; pose.y += motion.y; pose.rotation += motion.rotation;
    pose.scale *= motion.scale;
  }
  return pose;
}
export function clipMask(clip) {
  const value = clip.mask ?? {};
  const selected = (key, fallback) => value[key] === undefined ? fallback : value[key];
  return {
    type: selected('type', 'none'), x: selected('x', 0), y: selected('y', 0),
    width: selected('width', 1), height: selected('height', 1),
    rotation: selected('rotation', 0), feather: selected('feather', 0),
    invert: selected('invert', false),
  };
}
// Mask geometry lives on the fitted project canvas before the clip transform.
// Feather is a Gaussian blur with sigma=feather/3 in project pixels; inversion
// happens after the blur. Renderers share geometry, not CSS or filter strings.
export function maskGeometry(clip, project) {
  const mask = clipMask(clip);
  return {
    type: mask.type,
    cx: project.width * (.5 + mask.x), cy: project.height * (.5 + mask.y),
    width: project.width * mask.width, height: project.height * mask.height,
    rotation: mask.rotation, feather: mask.feather, sigma: mask.feather / 3,
    padding: Math.ceil(mask.feather),
    invert: mask.invert,
  };
}
export function clipTransitionOut(clip) {
  const value = clip.transitionOut;
  if (value === undefined) return { type: 'none', duration: 0 };
  return {
    type: value.type === undefined ? 'none' : value.type,
    duration: value.duration === undefined ? 0 : value.duration,
    ...(value.nextClipId === undefined ? {} : { nextClipId: value.nextClipId }),
  };
}
function nextVideoClips(project) {
  const ordered = project.clips.filter(item => item.track === 'video').sort((a, b) => clipLayer(a) - clipLayer(b) || a.start - b.start || a.id.localeCompare(b.id));
  const next = new Map();
  for (let index = 0; index + 1 < ordered.length; index++) {
    if (clipLayer(ordered[index]) === clipLayer(ordered[index + 1])) next.set(ordered[index].id, ordered[index + 1]);
  }
  return next;
}
export function nextVideoClip(project, clipOrId) {
  const clip = typeof clipOrId === 'string' ? project.clips.find(item => item.id === clipOrId) : clipOrId;
  if (!clip || clip.track !== 'video') return undefined;
  return nextVideoClips(project).get(clip.id);
}
export function maxTransitionDuration(project, clipOrId) {
  const clip = typeof clipOrId === 'string' ? project.clips.find(item => item.id === clipOrId) : clipOrId;
  const next = nextVideoClip(project, clip);
  if (!clip || !next || Math.abs(clip.start + clip.duration - next.start) > .001) return 0;
  const transitions = inspectTransitions(project).transitions;
  const incoming = transitions.find(item => item.toId === clip.id);
  const outgoing = transitions.find(item => item.fromId === next.id);
  return Math.max(0, Math.min(5, 2 * clip.duration - (incoming?.duration ?? 0), 2 * next.duration - (outgoing?.duration ?? 0)));
}
// The outgoing clip owns a transition and names its intended next clip. The
// centered window preserves clip timing and audio. Missing picture handles are
// held at their first/last frame; this is an independent local-editor contract.
export function inspectTransitions(project) {
  const transitions = [], invalid = [];
  const nextClips = nextVideoClips(project);
  for (const clip of project.clips) {
    const transition = clipTransitionOut(clip);
    if (transition.type === 'none') {
      if (transition.duration !== 0 || transition.nextClipId !== undefined) invalid.push({ clipId: clip.id, reason: '关闭的转场不能保留时长或目标片段' });
      continue;
    }
    const next = nextClips.get(clip.id);
    if (!TRANSITION_TYPES.includes(transition.type) || typeof transition.duration !== 'number' || !Number.isFinite(transition.duration) || transition.duration < .04 || transition.duration > 5) {
      invalid.push({ clipId: clip.id, reason: '转场时长必须在 0.04–5 秒之间' });
    } else if (clip.track !== 'video' || !next || next.id !== transition.nextClipId || Math.abs(clip.start + clip.duration - next.start) > .001) {
      invalid.push({ clipId: clip.id, reason: '转场目标必须为同画面轨道紧邻的原下一片段' });
    } else if (transition.duration / 2 > Math.min(clip.duration, next.duration) + .000001) {
      invalid.push({ clipId: clip.id, reason: '转场的半段时长不能超过两侧片段时长' });
    } else {
      transitions.push({ type: transition.type, fromId: clip.id, toId: next.id, layer: clipLayer(clip), cut: next.start,
        start: next.start - transition.duration / 2, end: next.start + transition.duration / 2, duration: transition.duration });
    }
  }
  const conflicts = new Set();
  for (const transition of transitions) {
    const following = transitions.find(item => item.fromId === transition.toId);
    if (following && transition.end > following.start + .000001) {
      conflicts.add(transition.fromId); conflicts.add(following.fromId);
    }
  }
  for (const clipId of conflicts) invalid.push({ clipId, reason: '同一片段两端的转场窗口不能重叠' });
  return { transitions: transitions.filter(item => !conflicts.has(item.fromId)), invalid };
}
export function transitionForClip(project, clipOrId) {
  const id = typeof clipOrId === 'string' ? clipOrId : clipOrId?.id;
  return inspectTransitions(project).transitions.find(item => item.fromId === id);
}
export function reconcileTransitions(project) {
  const removed = new Set(inspectTransitions(project).invalid.map(item => item.clipId));
  return {
    project: removed.size ? { ...project, clips: project.clips.map(clip => removed.has(clip.id) ? { ...clip, transitionOut: { type: 'none', duration: 0 } } : clip) } : project,
    removedCount: removed.size,
  };
}
// A held edge belongs to the project picture clock, never the selected output
// rate. Its last sample is the final project-grid instant inside the clip.
export function clipPictureFrameRange(clip, fps) {
  const startFrame = Math.ceil(clip.start * fps - 1e-8);
  const endFrame = Math.ceil((clip.start + clip.duration) * fps - 1e-8);
  return { startFrame, endFrame, frames: Math.max(0, endFrame - startFrame), offset: startFrame / fps - clip.start };
}
export function clipPictureEdges(clip, fps) {
  const range = clipPictureFrameRange(clip, fps);
  return range.frames ? { first: range.startFrame / fps, last: (range.endFrame - 1) / fps } : { first: clip.start, last: clip.start };
}
export function visualLayersAt(project, time) {
  const transitions = inspectTransitions(project).transitions;
  const clampSample = (clip, t) => {
    const edge = clipPictureEdges(clip, project.fps);
    return t < clip.start ? edge.first : t >= clip.start + clip.duration ? edge.last : t;
  };
  const layers = [];
  for (let layer = 0; layer < VIDEO_LAYER_COUNT; layer++) {
    const transition = transitions.find(item => item.layer === layer && time >= item.start && time < item.end);
    if (transition) {
      const progress = (time - transition.start) / transition.duration;
      const from = project.clips.find(item => item.id === transition.fromId);
      const to = project.clips.find(item => item.id === transition.toId);
      const geometry = transitionEffectAt(transition.type, progress);
      const samples = [{ clip: from, sampleTime: clampSample(from, time), ...geometry.outgoing }, { clip: to, sampleTime: clampSample(to, time), ...geometry.incoming }];
      layers.push({ layer, samples, blackOpacity: geometry.blackOpacity, whiteOpacity: geometry.whiteOpacity || 0 });
    } else {
      const clip = project.clips.find(item => item.track === 'video' && clipLayer(item) === layer && time >= item.start && time < item.start + item.duration);
      if (clip) layers.push({ layer, samples: [{ clip, sampleTime: time, weight: 1 }] });
    }
  }
  return layers;
}
// Same sRGB coefficients as CSS saturate(). Brightness and contrast run first,
// with each stage clamped to the channel range before the next stage.
export function saturationMatrix(saturation) {
  return [
    .213 + .787 * saturation, .715 - .715 * saturation, .072 - .072 * saturation,
    .213 - .213 * saturation, .715 + .285 * saturation, .072 - .072 * saturation,
    .213 - .213 * saturation, .715 - .715 * saturation, .072 + .928 * saturation,
  ];
}
export function newProject(name = "未命名项目") {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    version: PROJECT_VERSION,
    name,
    width: 1920,
    height: 1080,
    fps: 30,
    media: [],
    clips: [],
    subtitles: [],
    audioLanes: projectAudioLanes(),
    createdAt: now,
    updatedAt: now,
  };
}
export function projectDuration(project) {
  return Math.max(
    0,
    ...project.clips.map((c) => c.start + c.duration),
    ...project.subtitles.map((s) => s.start + s.duration),
  );
}
export function timelineLabel(seconds, fps = 30) {
  const frame = Math.max(0, Math.round(seconds * fps));
  return [
    Math.floor(frame / (fps * 3600)),
    Math.floor(frame / (fps * 60)) % 60,
    Math.floor(frame / fps) % 60,
    frame % fps,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
export function splitClip(clip, time, media) {
  if (time <= clip.start + 0.04 || time >= clip.start + clip.duration - 0.04)
    return null;
  const first = trimClip(clip, { end: time }, media);
  const second = trimClip(clip, { start: time }, media);
  first.transitionOut = { type: 'none', duration: 0 };
  second.id = crypto.randomUUID();
  return [first, second];
}
export function mediaFor(project, clip) {
  return project.media.find((m) => m.id === clip.mediaId);
}
