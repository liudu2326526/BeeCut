import { useEffect, useRef, useState } from 'react';
import { compileAudioPlan } from '../shared/audio-dsp.mjs';

// Source-clock fields alone invalidate decoded PCM. DSP/UI edits never trigger a preparation render.
export function audioSourceIdentity(project) {
  const media = new Map(project.media.map(m => [m.id, m]));
  return JSON.stringify({ fps: project.fps, clips: project.clips.filter(c => media.get(c.mediaId)?.hasAudio).map(c => ({ id: c.id, mediaId: c.mediaId, url: media.get(c.mediaId).url, start: c.start, sourceStart: c.sourceStart, duration: c.duration, speed: c.speed, speedSegments: c.speedSegments, speedCurve: c.speedCurve })) });
}
async function request(url, options) {
  const response = await fetch(url, options); const body = await response.json();
  if (!response.ok) throw new Error(body.error || body.message || `音频服务错误 ${response.status}`);
  return body;
}
export function useRealtimeAudio({ project, time, playing, muted }) {
  const bridge = window.weijianAudio;
  const [prepareGeneration, setPrepareGeneration] = useState(0);
  const [enabled, setEnabled] = useState(false), [status, setStatus] = useState({ phase: bridge ? 'idle' : 'unsupported' });
  const [captureState, setCaptureState] = useState('idle');
  const state = useRef({ epoch: 0, revision: 0, installed: false, clock: null, source: null, job: null, assets: null, plan: null, lastTransport: null, closed: false, capture: false });
  const latest = useRef({ project, time, playing, muted }); latest.current = { project, time, playing, muted };
  const identity = audioSourceIdentity(project), plan = compileAudioPlan(project), planIdentity = JSON.stringify(plan);
  const send = command => bridge?.command(command).then(result => { if (result?.error) setStatus({ phase: 'error', message: result.error }); }).catch(error => setStatus({ phase: 'error', message: error.message }));
  const transport = (frame, jump = false, options = {}) => {
    const s = state.current, l = latest.current;
    if (!s.installed) return;
    if (jump) { s.epoch++; s.clock = null; }
    const command = { type: 'transport', epoch: s.epoch, revision: s.revision, frame, playing: options.playing ?? l.playing, muted: l.muted };
    s.lastTransport = { ...command, at: performance.now() }; send(command);
  };
  useEffect(() => {
    if (!bridge) return;
    const unsubscribe = bridge.subscribe(value => {
      const s = state.current;
      if (value.epoch !== undefined && value.epoch < s.epoch) return;
      if (value.phase === 'capturing') { setCaptureState('recording'); return; }
      if (value.phase === 'capture-completed') { setCaptureState('completed'); return; }
      if (value.phase === 'capture-error') { setCaptureState('error'); setStatus(value); return; }
      if (['playing', 'ready', 'paused', 'applied', 'buffering', 'ended'].includes(value.phase) && Number.isFinite(value.frame)) s.clock = { frame: value.frame, at: performance.now(), phase: value.phase, playing: typeof value.advancing === 'boolean' ? value.advancing : value.phase === 'applied' ? !!s.clock?.playing : value.phase === 'playing', latency: value.outputLatency || 0, epoch: value.epoch };
      if (['error', 'device-paused'].includes(value.phase)) { s.clock = null; setCaptureState(current => ['starting', 'recording'].includes(current) ? 'error' : current); }
      setStatus(previous => ({ ...previous, ...value }));
    });
    return () => { unsubscribe(); bridge.command({ type: 'close' }).catch(() => {}); };
  }, [bridge]);
  useEffect(() => {
    if (!enabled || !bridge) return;
    const s = state.current;
    let cancelled = false, pollTimer;
    const previousJob = s.job;
    send({ type: 'halt' });
    s.job = null; s.installed = false; s.clock = null; s.source = identity; s.epoch++;
    if (previousJob) request(`/api/audio-clock-prepares/${previousJob}`, { method: 'DELETE' }).catch(() => {});
    setStatus({ phase: 'preparing', message: '正在准备保调音频；画面可继续播放' });
    const timer = setTimeout(async () => {
      try {
        let job = await request('/api/audio-clock-prepares', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: latest.current.project }) });
        if (cancelled) { await request(`/api/audio-clock-prepares/${job.id}`, { method: 'DELETE' }); return; }
        s.job = job.id;
        const poll = async () => {
          try {
            if (cancelled) return;
            job = await request(`/api/audio-clock-prepares/${job.id}`);
            if (cancelled) return;
            if (job.status === 'failed' || job.status === 'cancelled') throw new Error(job.error || '音频准备未完成');
            if (job.status !== 'completed') { setStatus({ phase: 'preparing', progress: job.progress }); pollTimer = setTimeout(poll, 150); return; }
            s.assets = job.assets; s.installed = true; s.plan = compileAudioPlan(latest.current.project); s.revision++;
            const l = latest.current;
            send({ type: 'install', epoch: s.epoch, revision: s.revision, frame: Math.round(l.time * 48000), playing: l.playing, muted: l.muted, plan: s.plan, assets: s.assets, lease: job.id });
          } catch (error) { if (!cancelled) setStatus({ phase: 'error', message: error.message }); }
        };
        void poll();
      } catch (error) { if (!cancelled) setStatus({ phase: 'error', message: error.message }); }
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); clearTimeout(pollTimer); if (s.job) { const id = s.job; s.job = null; request(`/api/audio-clock-prepares/${id}`, { method: 'DELETE' }).catch(() => {}); } };
  }, [enabled, identity, bridge, prepareGeneration]);
  useEffect(() => {
    const s = state.current;
    if (!s.installed || s.source !== identity || !bridge) return;
    s.plan = plan; s.revision++;
    send({ type: 'plan', plan, epoch: s.epoch, revision: s.revision, frame: Math.round(time * 48000), playing, muted });
  }, [planIdentity]);
  useEffect(() => {
    if (playing && !enabled && bridge) { setEnabled(true); return; }
    transport(Math.round(latest.current.time * 48000));
  }, [playing, muted]);
  // Seek is an explicit transport intent. Ordinary playhead renders, pauses,
  // video readiness and delayed status delivery never create a new epoch.
  return {
    status, captureState, enabled,
    start: () => { setCaptureState(current => current === 'completed' ? current : 'idle'); if (enabled) { send({ type: 'retry' }); setPrepareGeneration(n => n + 1); } else setEnabled(true); },
    seek: (at, options) => transport(Math.round(at * 48000), true, options),
    clockTime: fallback => { const c = state.current.clock, age = c ? performance.now() - c.at : Infinity; if (!c || c.epoch !== state.current.epoch || !latest.current.playing) return fallback; const advance = c.playing ? Math.min(age, 250) / 1000 : 0; return Math.max(0, c.frame / 48000 + advance - (c.phase === 'ended' ? 0 : c.latency)); },
    capture: () => { if (!state.current.installed) return; setCaptureState('starting'); send({ type: 'capture-start' }); },
    stopCapture: () => send({ type: 'capture-stop' }),
    saveCapture: async () => bridge.saveCapture(),
  };
}
