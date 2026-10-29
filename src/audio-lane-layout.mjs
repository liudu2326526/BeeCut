// Visual rows expose simultaneous clips without changing their mixing lane or clocks.
export const AUDIO_ROW_HEIGHT = 44;
export const AUDIO_CLIP_HEIGHT = 38;
export const AUDIO_ROW_PADDING = 7;

export function audioLaneLayout(clips, laneCount) {
  return Array.from({ length: laneCount }, (_, lane) => {
    const rows = new Map(), ends = [];
    const ordered = clips.filter(clip => clip.track === 'audio' && (clip.layer ?? 0) === lane)
      .map((clip, index) => ({ clip, index }))
      .sort((a, b) => a.clip.start - b.clip.start || a.index - b.index);
    for (const { clip } of ordered) {
      let row = ends.findIndex(end => end <= clip.start);
      if (row < 0) row = ends.length;
      ends[row] = clip.start + clip.duration;
      rows.set(clip.id, row);
    }
    const rowCount = Math.max(1, ends.length);
    return { lane, rows, rowCount, height: 52 + (rowCount - 1) * AUDIO_ROW_HEIGHT };
  });
}

export function audioClipTop(layout, clipId) {
  return AUDIO_ROW_PADDING + (layout?.rows.get(clipId) ?? 0) * AUDIO_ROW_HEIGHT;
}
