// Asset frame zero is already source-clock mapped by the server. No second rate/seek interpretation here.
export function createPCMProvider(plan, assets, lease, { fetcher = fetch, origin = '' } = {}) {
  const byId = new Map(assets.map(a => [a.clipId, a]));
  return async function read(first, frames, signal) {
    const inputs = {}, failures = [], active = plan.clips.filter(c => first < c.end && first + frames > c.first);
    let cursor = 0;
    async function worker() {
      while (cursor < active.length) {
        const clip = active[cursor++], asset = byId.get(clip.id);
        try {
        if (!asset) throw new Error(`缺少片段 ${clip.id} 的准备音频`);
        const start = Math.max(first, clip.first), end = Math.min(first + frames, clip.end), local = start - clip.first;
        const output = new Float32Array(frames * 2);
        const count = Math.max(0, Math.min(end - start, asset.frames - local));
        if (count) {
          const url = `${origin}${asset.url}?first=${local}&frames=${count}&lease=${encodeURIComponent(lease)}`;
          const response = await fetcher(url, { signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout && AbortSignal.any ? AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(4000)]) : signal });
          if (!response.ok) throw new Error(`音频片段读取失败 (${response.status})：${clip.id}`);
          const bytes = await response.arrayBuffer();
          if (bytes.byteLength !== count * 8) throw new Error(`音频片段样本不完整：${clip.id}`);
          output.set(new Float32Array(bytes), (start - first) * 2);
        }
        inputs[clip.id] = output;
        } catch (error) { if (error.name === 'AbortError') throw error; failures.push({ clipId: clip.id, message: error.message }); }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, active.length) }, worker));
    if (failures.length) { const error = new Error(failures.map(f => f.message).join('；')); error.failures = failures; throw error; }
    return inputs;
  };
}
