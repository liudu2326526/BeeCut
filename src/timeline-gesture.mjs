export function contentTime(clientX, contentLeft, zoom) {
  return (clientX - contentLeft) / zoom;
}
export function edgeScrollVelocity(position, low, high, edge = 36, maxSpeed = 720) {
  if (high <= low) return 0;
  if (position < low + edge) return -maxSpeed * Math.min(1, Math.max(0, (low + edge - position) / edge));
  if (position > high - edge) return maxSpeed * Math.min(1, Math.max(0, (position - high + edge) / edge));
  return 0;
}

export function finishTimelineGesture(current, cancel = false) {
  if (!current?.moved) return { type: 'none' };
  if (cancel) return { type: 'cancelled' };
  if (current.kind === 'media') return current.resolution?.ok
    ? { type: 'media', id: current.id, placement: current.resolution.placement }
    : { type: 'rejected', message: current.resolution?.message || '当前位置无法放置素材' };
  const { id, original, patch = {} } = current;
  if (current.kind === 'subtitle') return Object.entries(patch).some(([key, value]) => Math.abs(value - original[key]) > .000001)
    ? { type: 'subtitle', id, patch } : { type: 'none' };
  if (current.mode === 'move') {
    if (!current.resolution?.ok) return { type: 'rejected', message: current.resolution?.message || '当前位置无法放置片段' };
    return current.resolution.unchanged ? { type: 'none' } : { type: 'move', id, placement: current.resolution.placement };
  }
  const start = patch.start ?? original.start, duration = patch.duration ?? original.duration;
  return Math.abs(start - original.start) < .000001 && Math.abs(duration - original.duration) < .000001
    ? { type: 'none' } : { type: 'trim', id, bounds: { start, end: start + duration } };
}
