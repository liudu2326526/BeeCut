import { VIDEO_LAYER_COUNT, AUDIO_LANE_COUNT, clipLayer } from './model.mjs';

export const TIMELINE_END_LIMIT = 900;
export const COLLISION_EPSILON = .001;
const precise = value => Math.round(value * 1e6) / 1e6;

function subjectFor(project, request) {
  if (request.clipId) {
    const clip = project.clips.find(item => item.id === request.clipId);
    return clip ? { id: clip.id, duration: clip.duration, track: clip.track, layer: clipLayer(clip), original: clip } : null;
  }
  const media = project.media.find(item => item.id === request.mediaId);
  if (!media) return null;
  return { duration: media.type === 'image' ? 5 : media.duration, track: media.type === 'audio' ? 'audio' : 'video', layer: 0 };
}

// A preview and its final commit use this same placement owner. It never
// reorders neighbours, changes source timing, inserts gaps, or mutates a project.
export function resolveTimelinePlacement(project, request, { snap = false, zoom = 44, time = 0 } = {}) {
  const subject = subjectFor(project, request);
  const invalid = (code, message, extra = {}) => ({ ok: false, code, message, placement: null, duration: subject?.duration ?? null, snap: null, ...extra });
  if (!subject) return invalid('ITEM_MISSING', '素材或片段已不存在，请重新拖动');
  if (!Number.isFinite(subject.duration) || subject.duration <= 0) return invalid('DURATION_INVALID', '素材时长无效，无法放入时间线');
  const track = request.track ?? subject.track, layer = request.layer ?? subject.layer;
  if (track !== subject.track) return invalid('TRACK_MISMATCH', subject.track === 'audio' ? '请将配乐放到音频轨道' : '请将视频或图片放到画面轨道');
  if (!['video', 'audio'].includes(track) || !Number.isInteger(layer) || layer < 0 || layer >= (track === 'audio' ? AUDIO_LANE_COUNT : VIDEO_LAYER_COUNT))
    return invalid('LAYER_INVALID', '请选择有效的目标轨道');
  if (!Number.isFinite(request.start) || request.start < 0) return invalid('POSITION_INVALID', '目标时间必须大于或等于 0');
  // Gesture callers quantize unsnapped pointer time to frames. Preserve an
  // already resolved edge exactly when App revalidates it at commit time.
  const rawStart = precise(request.start);
  const neighbours = project.clips.filter(clip => clip.id !== subject.id && clip.track === 'video' && clipLayer(clip) === layer);
  const collisions = start => track === 'video' ? neighbours.filter(clip => start < clip.start + clip.duration - COLLISION_EPSILON && start + subject.duration > clip.start + COLLISION_EPSILON) : [];
  const fits = start => start >= 0 && start + subject.duration <= TIMELINE_END_LIMIT + COLLISION_EPSILON && !collisions(start).length;
  let start = rawStart, snapped = null;
  if (snap && zoom > 0 && Number.isFinite(zoom)) {
    const anchors = [0, time, ...project.clips.filter(clip => clip.id !== subject.id).flatMap(clip => [clip.start, clip.start + clip.duration]),
      ...project.subtitles.flatMap(item => [item.start, item.start + item.duration])].filter(Number.isFinite);
    const candidates = anchors.flatMap(point => ['start', 'end'].map(edge => ({ time: point, edge, start: precise(point - (edge === 'end' ? subject.duration : 0)) })))
      .map(candidate => ({ ...candidate, distance: Math.abs(candidate.start - request.start) }))
      .filter(candidate => candidate.distance <= 7 / zoom && fits(candidate.start))
      .sort((a, b) => a.distance - b.distance || (a.edge === b.edge ? a.time - b.time : a.edge === 'start' ? -1 : 1));
    if (candidates.length) { const chosen = candidates[0]; start = chosen.start; snapped = { time: chosen.time, edge: chosen.edge }; }
  }
  const placement = { start, track, layer };
  if (start + subject.duration > TIMELINE_END_LIMIT + COLLISION_EPSILON)
    return invalid('TIMELINE_LIMIT', '工程最长支持 15 分钟，请放到更早的位置', { placement, snap: snapped });
  const conflicts = collisions(start);
  if (conflicts.length) return invalid('COLLISION', '同一画面轨道不能重叠，请移到空位或其他画面轨道', { placement, conflictIds: conflicts.map(clip => clip.id), snap: snapped });
  return { ok: true, placement, duration: subject.duration, snap: snapped,
    unchanged: !!subject.original && Math.abs(start - subject.original.start) < .000001 && track === subject.original.track && layer === clipLayer(subject.original) };
}
