import { audioGainPlan, clipAudioEnabled, clipAudioEffects, clipAudioPanGains,
  clipAudioSampleRange, clipAudioSettings, audioFadeProgress } from './audio.mjs';

export const AUDIO_DSP_VERSION = 'weijian-shared-dsp-1';
export const AUDIO_DSP_RATE = 48000;
export const AUDIO_DSP_CHANNELS = 2;
export const AUDIO_DSP_WARMUP_FRAMES = 2 * AUDIO_DSP_RATE;
export const AUDIO_DSP_LIMITER = Object.freeze({ delayFrames: 239, threshold: .95, releaseSeconds: .05 });
const release = 1 - Math.exp(-1 / (AUDIO_DSP_LIMITER.releaseSeconds * AUDIO_DSP_RATE));

// The output's picture duration and PCM count are normalized together. The
// renderer and realtime plan consume this owner, including noninteger fps.
export function audioProjectClock(project, fps = project.fps) {
  const duration = Math.max(0, ...project.clips.map(c => c.start + c.duration),
    ...project.subtitles.map(s => s.start + s.duration));
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(duration)) throw new RangeError('音频工程时钟无效');
  const pictureFrames = Math.max(1, Math.ceil(duration * fps - .00001));
  const outputDuration = pictureFrames / fps;
  return { pictureFrames, outputDuration, outputFrames: Math.round(outputDuration * AUDIO_DSP_RATE) };
}

function biquad(type, frequency) {
  const w = 2 * Math.PI * frequency / AUDIO_DSP_RATE, c = Math.cos(w), a = Math.sin(w) / Math.SQRT2;
  const b = type === 'highpass' ? [(1+c)/2, -(1+c), (1+c)/2] : [(1-c)/2, 1-c, (1-c)/2];
  return [b[0]/(1+a), b[1]/(1+a), b[2]/(1+a), -2*c/(1+a), (1-a)/(1+a)];
}

export function compileAudioPlan(project, { fps = project.fps } = {}) {
  const media = new Map(project.media.map(m => [m.id, m]));
  const clips = project.clips.filter(c => media.get(c.mediaId)?.hasAudio).map(clip => {
    const range = clipAudioSampleRange(clip), settings = clipAudioSettings(clip), effects = clipAudioEffects(clip);
    const hp = effects.highpass.enabled ? biquad('highpass', effects.highpass.frequency) : null;
    const lp = effects.lowpass.enabled ? biquad('lowpass', effects.lowpass.frequency) : null;
    const echoFrames = effects.echo.enabled ? Math.round(effects.echo.delay * AUDIO_DSP_RATE) : 0;
    return { id: clip.id, ...range, duration: clip.duration, enabled: clipAudioEnabled(clip, media.get(clip.mediaId), project),
      base: settings.volume, pan: clipAudioPanGains(clip), effects, hp, lp, echoFrames,
      effectSignature: JSON.stringify([hp, lp, echoFrames, effects.echo.decay]),
      gainSegments: audioGainPlan(clip), fadeIn: settings.fadeIn, fadeOut: settings.fadeOut,
      fadeInCurve: settings.fadeInCurve, fadeOutCurve: settings.fadeOutCurve };
  });
  return { version: AUDIO_DSP_VERSION, sampleRate: AUDIO_DSP_RATE, channels: 2,
    ...audioProjectClock(project, fps), clips };
}

const newClipState = clip => ({ hp: new Float64Array(4), lp: new Float64Array(4),
  echo: new Float32Array(clip.echoFrames * 2), echoCursor: 0, gainIndex: 0 });
const newLimiter = () => ({ ring: new Float32Array(480), values: new Float64Array(512),
  positions: new Float64Array(512), head: 0, tail: 0, samples: 0, gain: 1/.95 });
const cloneClipState = s => ({ hp: s.hp.slice(), lp: s.lp.slice(), echo: s.echo.slice(),
  echoCursor: s.echoCursor, gainIndex: s.gainIndex });
const cloneLimiter = s => ({ ...s, ring: s.ring.slice(), values: s.values.slice(), positions: s.positions.slice() });
function filter(x, c, state, channel) {
  if (!c) return x;
  const at = channel * 2, y = c[0] * x + state[at];
  state[at] = c[1] * x - c[3] * y + state[at+1];
  state[at+1] = c[2] * x - c[4] * y;
  return y;
}
function gainAt(clip, state, localFrame) {
  const time = clip.offset + localFrame / AUDIO_DSP_RATE, segments = clip.gainSegments;
  while (state.gainIndex + 1 < segments.length && time >= segments[state.gainIndex].end) state.gainIndex++;
  const p = segments[state.gainIndex], u = Math.max(0, Math.min(1, (time-p.start)/(p.end-p.start || 1))), c = p.coefficients;
  const gain = c[0] + u*(c[1]+u*(c[2]+u*c[3]));
  const left = clip.fadeIn ? audioFadeProgress(clip.fadeInCurve, time/clip.fadeIn) : 1;
  const right = clip.fadeOut ? audioFadeProgress(clip.fadeOutCurve, (clip.duration-time)/clip.fadeOut) : 1;
  return clip.enabled ? clip.base * gain * Math.min(left, right) : 0;
}

// A stereo-linked lookahead peak limiter. Its low-level path deliberately
// retains the old 239-frame delay and 1/.95 gain. High-level behavior is an
// explicit 1.0 contract, rather than a claim of FFmpeg's undocumented state.
function limit(limiter, left, right, output, at) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) throw new RangeError('音频混音包含非有限样本');
  const n = limiter.samples++, peak = Math.max(Math.abs(left), Math.abs(right));
  while (limiter.tail > limiter.head && limiter.values[(limiter.tail-1)%512] <= peak) limiter.tail--;
  limiter.values[limiter.tail%512] = peak; limiter.positions[limiter.tail%512] = n; limiter.tail++;
  while (limiter.tail > limiter.head && limiter.positions[limiter.head%512] <= n-240) limiter.head++;
  const target = 1 / Math.max(.95, limiter.values[limiter.head%512]);
  limiter.gain = target < limiter.gain ? target : limiter.gain + (target-limiter.gain)*release;
  const write = (n%240)*2, read = ((n+1)%240)*2;
  limiter.ring[write] = left; limiter.ring[write+1] = right;
  output[at] = Math.max(-1, Math.min(1, limiter.ring[read]*limiter.gain));
  output[at+1] = Math.max(-1, Math.min(1, limiter.ring[read+1]*limiter.gain));
}

function assertPlan(plan) {
  if (plan?.version !== AUDIO_DSP_VERSION || plan.sampleRate !== AUDIO_DSP_RATE || plan.channels !== 2 ||
      !Array.isArray(plan.clips) || plan.clips.length > 64) throw new RangeError('音频处理计划无效');
}
function assertFrame(frame) { if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError('音频处理采样位置无效'); }

// inputs[id] is interleaved stereo aligned to the current GLOBAL window, not
// the clip's origin. Missing input is silence; the transport owns readiness and
// must expose underruns rather than advancing an allegedly ready asset.
export function createAudioDSP(initialPlan, { frame = 0, state } = {}) {
  assertPlan(initialPlan); assertFrame(frame);
  let plan = initialPlan, position = frame, states = new Map(), limiter = newLimiter();
  const reset = at => { assertFrame(at); position = at; states = new Map(plan.clips.map(c => [c.id, newClipState(c)])); limiter = newLimiter(); };
  reset(frame);
  function restore(snapshot, selectedPlan = plan) {
    if (snapshot?.version !== AUDIO_DSP_VERSION || !Array.isArray(snapshot.clips)) throw new RangeError('音频状态版本无效');
    assertFrame(snapshot.frame);
    const incoming = new Map(snapshot.clips.map(c => [c.id, c])), nextStates = new Map();
    const finiteArray = (value, type, length) => value instanceof type && value.length === length && value.every(Number.isFinite);
    for (const c of selectedPlan.clips) {
      const s = incoming.get(c.id);
      if (!s || s.effectSignature !== c.effectSignature || !finiteArray(s.state?.hp, Float64Array, 4) || !finiteArray(s.state?.lp, Float64Array, 4) || !finiteArray(s.state?.echo, Float32Array, c.echoFrames*2) ||
          !Number.isInteger(s.state.echoCursor) || s.state.echoCursor < 0 || s.state.echoCursor >= Math.max(1,c.echoFrames) ||
          !Number.isInteger(s.state.gainIndex) || s.state.gainIndex < 0 || s.state.gainIndex >= c.gainSegments.length) throw new RangeError('音频状态与片段不匹配');
      nextStates.set(c.id, cloneClipState(s.state));
    }
    const l=snapshot.limiter;
    if (!finiteArray(l?.ring,Float32Array,480) || !finiteArray(l.values,Float64Array,512) || !finiteArray(l.positions,Float64Array,512) ||
        ![l.head,l.tail,l.samples].every(n=>Number.isSafeInteger(n)&&n>=0) || l.tail<l.head || l.tail-l.head>240 || !Number.isFinite(l.gain) || l.gain<0 || l.gain>1/.95) throw new RangeError('混音限幅状态无效');
    const nextLimiter=cloneLimiter(l);
    states = nextStates; limiter = nextLimiter; position = snapshot.frame;
  }
  if (state) restore(state);
  return {
    get frame() { return position; },
    process(inputs, frames, output = new Float32Array(frames*2)) {
      if (!Number.isInteger(frames) || frames < 0 || frames > 16384 || output.length !== frames*2) throw new RangeError('音频处理块大小无效');
      output.fill(0);
      for (const clip of plan.clips) {
        const s = states.get(clip.id), input = inputs?.[clip.id];
        if (input && (!(input instanceof Float32Array) || input.length !== frames*2)) throw new RangeError('音频输入块格式无效');
        const first = Math.max(0, clip.first-position), end = Math.min(frames, clip.end-position);
        for (let n=first; n<end; n++) {
          const gain = gainAt(clip, s, position+n-clip.first);
          for (let ch=0; ch<2; ch++) {
            const at = n*2+ch;
            let x = filter(filter(input?.[at] ?? 0, clip.hp, s.hp, ch), clip.lp, s.lp, ch);
            if (!Number.isFinite(x)) throw new RangeError('音频效果包含非有限样本');
            if (clip.echoFrames) {
              const cursor = s.echoCursor*2+ch, dry = x;
              x += s.echo[cursor]*clip.effects.echo.decay; s.echo[cursor] = dry;
            }
            output[at] += x*gain*(ch ? clip.pan.right : clip.pan.left);
          }
          if (clip.echoFrames) s.echoCursor = (s.echoCursor+1)%clip.echoFrames;
        }
      }
      for (let i=0; i<frames*2; i+=2) limit(limiter, output[i], output[i+1], output, i);
      position += frames;
      return output;
    },
    snapshot() { return { version: AUDIO_DSP_VERSION, frame: position,
      clips: plan.clips.map(c => ({ id: c.id, effectSignature: c.effectSignature, state: cloneClipState(states.get(c.id)) })),
      limiter: cloneLimiter(limiter) }; },
    updatePlan(next, { state: snapshot } = {}) {
      assertPlan(next);
      if (!snapshot && (next.clips.length !== plan.clips.length || next.clips.some((c,i) =>
        c.id !== plan.clips[i].id || c.first !== plan.clips[i].first || c.end !== plan.clips[i].end || c.effectSignature !== plan.clips[i].effectSignature)))
        throw new RangeError('音频源时钟或效果已改变，需要准备对应音频状态');
      if (snapshot) restore(snapshot, next);
      else for (const s of states.values()) s.gainIndex = 0;
      plan = next;
    },
    reset,
  };
}
