import { useEffect, useMemo, useRef, useState } from 'react';
import { subscribeWaveform, retryWaveform } from './waveform-data.mjs';
import { waveformColumns, waveformPath, waveformReference } from './waveform-view.mjs';
import './waveform.css';

function useVisibleRange(ref, clip, layoutKey) {
  const [range, setRange] = useState({ offset: 0, width: 0, totalWidth: 0 });
  useEffect(() => {
    const element = ref.current, scroll = element?.closest('.tl-scroll');
    if (!element || !scroll) return;
    let frame;
    const measure = () => {
      const box = element.getBoundingClientRect(), viewport = scroll.getBoundingClientRect();
      const offset = Math.max(0, viewport.left - box.left), right = Math.min(box.width, viewport.right - box.left);
      const onScreen = box.bottom > viewport.top && box.top < viewport.bottom;
      const next = { offset, width: onScreen ? Math.max(0, right - offset) : 0, totalWidth: box.width };
      setRange(previous => Object.keys(next).every(k => Math.abs(next[k] - previous[k]) < .25) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule); observer.observe(element); observer.observe(scroll);
    scroll.addEventListener('scroll', schedule, { passive: true }); window.addEventListener('resize', schedule);
    measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); scroll.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); };
  }, [ref, clip.start, clip.duration, clip.layer, clip.track, layoutKey]);
  return range;
}

export function ClipWaveform({ clip, media, layoutKey }) {
  const ref = useRef(null), range = useVisibleRange(ref, clip, layoutKey);
  const [data, setData] = useState({ status: 'queued' });
  const enabled = !!media?.hasAudio && media.type !== 'image' && range.width > 0;
  useEffect(() => {
    if (!enabled) return;
    return subscribeWaveform(media, setData);
  }, [media?.id, media?.url, enabled]);
  const columns = useMemo(() => data.status === 'ready' ? waveformColumns(clip, data, range) : [], [clip, data, range]);
  const reference = useMemo(() => data.status === 'ready' ? waveformReference(data) : 1, [data]);
  const shape = useMemo(() => waveformPath(columns, reference), [columns, reference]);
  if (!media || media.type === 'image') return null;
  const status = !media.hasAudio ? 'no-audio' : data.status;
  const label = status === 'no-audio' ? '无音轨' : status === 'ready' ? data.silent ? '静音音轨' : '源音频相对波形' : status === 'failed' ? '波形失败' : '生成波形…';
  return <span ref={ref} className={`clip-waveform clip-waveform-${status}${clip.track === 'audio' ? ' is-audio' : ''}`}
    data-waveform-state={status} data-waveform-key={data.cacheKey || ''} data-waveform-columns={columns.length}
    title={status === 'failed' ? data.error : `${label} · 真实PCM峰值，按整份素材最大峰值固定归一；按源入点和变速映射，不代表音量与音频效果`}>
    {status === 'ready' && columns.length > 0 && <svg role="img" aria-label={label} preserveAspectRatio="none"
      viewBox={`0 0 ${columns.length} 100`} style={{ left: range.offset, width: range.width }}>
      <line x1="0" x2={columns.length} y1="50" y2="50" /><path d={shape} /></svg>}
    {status === 'failed' ? <button type="button" className="clip-waveform-retry" aria-label="重新生成音频波形"
      onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); retryWaveform(media); }}>波形失败 · 重试</button>
      : status !== 'ready' || data.silent ? <span className="clip-waveform-label">{label}</span> : null}
  </span>;
}
