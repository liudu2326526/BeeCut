// Processor observations own elapsed playback. A new transport request must
// never retroactively turn a paused interval into rendered audio time.
export function createObservedAudioClock(now = () => performance.now()) {
  let frame = 0, at = now(), running = false;
  return {
    reset(nextFrame) { frame = nextFrame; at = now(); running = false; },
    observe(status) {
      if (!['ready', 'ack', 'playing', 'paused', 'buffering', 'ended'].includes(status.phase) || !Number.isSafeInteger(status.frame) || status.frame < 0) return;
      frame = status.frame; at = now();
      if (typeof status.advancing === 'boolean') running = status.advancing;
      else if (status.phase === 'playing') running = true;
      else if (status.phase !== 'ack') running = false;
    },
    stop() { frame = this.current(); at = now(); running = false; },
    current() { return frame + (running ? Math.round(Math.max(0, now() - at) * 48) : 0); },
  };
}
