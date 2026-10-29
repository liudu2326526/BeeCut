import { clipLayer } from '../shared/model.mjs';

// Retiming can extend one picture into its following neighbours. Only push that
// same-lane chain, preserving every unaffected position and full time precision.
// Moves and drops use the separate strict placement owner instead.
export function pushFollowingVideoClips(project, editedClipId) {
  const edited = project.clips.find(clip => clip.id === editedClipId);
  if (!edited || edited.track !== 'video') return;
  const lane = project.clips.filter(clip => clip.track === 'video' && clipLayer(clip) === clipLayer(edited))
    .sort((a, b) => a.start - b.start);
  let end = edited.start + edited.duration;
  for (const clip of lane.slice(lane.findIndex(clip => clip.id === editedClipId) + 1)) {
    if (clip.start < end) clip.start = end;
    end = clip.start + clip.duration;
  }
}
