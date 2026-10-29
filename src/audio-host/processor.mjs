import { createAudioDSP } from '../../shared/audio-dsp.mjs';
import { AUDIO_STREAM_MAX_BLOCKS } from './stream-config.mjs';

class WeijianMixer extends AudioWorkletProcessor {
  constructor() {
    super(); this.dsp = null; this.ready = false; this.epoch = -1; this.revision = -1; this.playing = false; this.advancing = false; this.muted = false;
    this.blocks = new Map(); this.clockCounter = 0; this.capture = null; this.captureSequence = 0;
    this.port.onmessage = ({ data: c }) => {
      try {
        if (c.type === 'install') {
          if (c.epoch < this.epoch || (c.epoch === this.epoch && c.revision < this.revision)) return;
          if (this.capture && this.dsp && c.state.frame !== this.dsp.frame) this.finishCapture();
          this.epoch = c.epoch; this.revision = c.revision; this.blocks.clear(); this.advancing = false; if (c.initialBlock) this.blocks.set(c.initialBlock.frame, c.initialBlock); this.planEnd = c.plan.outputFrames;
          this.dsp = createAudioDSP(c.plan, { state: c.state }); this.ready = true;
          this.playing = c.playing; this.muted = c.muted;
          this.report('ready'); this.port.postMessage({ type: 'need', epoch: this.epoch, frame: this.dsp.frame });
        } else if (c.type === 'halt') {
          this.playing = false; this.advancing = false; this.ready = false; if (this.capture) this.finishCapture();
        } else if (c.type === 'block') {
          if (c.epoch === this.epoch && c.frame >= this.dsp.frame) {
            if (!this.blocks.has(c.frame) && this.blocks.size >= AUDIO_STREAM_MAX_BLOCKS) throw new Error('音频流窗口超出容量，已停止音频；请重试。');
            this.blocks.set(c.frame, c);
          }
        } else if (c.type === 'plan') {
          if (c.epoch !== this.epoch || c.revision < this.revision) return;
          this.dsp?.updatePlan(c.plan); this.planEnd = c.plan.outputFrames; this.revision = c.revision; this.report('ack');
        } else if (c.type === 'transport') {
          if (c.epoch !== this.epoch) return;
          this.playing = c.playing; this.muted = c.muted; if (!this.playing) this.advancing = false; this.report(this.playing ? this.advancing ? 'playing' : 'ready' : 'paused');
        } else if (c.type === 'capture-start') {
          if (!this.ready || !this.dsp || c.epoch !== this.epoch || c.revision !== this.revision) { this.port.postMessage({ type: 'status', phase: 'capture-error', message: '音频尚未就绪，请等待定位完成后再录制。', captureId: c.captureId, epoch: c.epoch, revision: c.revision }); return; }
          this.capture = { id: c.captureId, first: this.dsp?.frame ?? 0, frames: 0, buffer: new Float32Array(4096), used: 0 }; this.captureSequence = 0; this.report('capturing');
        } else if (c.type === 'capture-stop') this.finishCapture();
      } catch (error) { this.port.postMessage({ type: 'status', phase: 'error', message: error.message, epoch: this.epoch }); }
    };
  }
  report(phase) { this.port.postMessage({ type: 'status', phase, advancing: this.advancing, epoch: this.epoch, revision: this.revision, frame: this.dsp?.frame ?? 0, contextTime: currentTime, captureId: this.capture?.id, captureFrames: this.capture?.frames }); }
  flushCapture() {
    const c = this.capture; if (!c?.used) return;
    const samples = c.buffer.slice(0, c.used);
    this.port.postMessage({ type: 'capture', captureId: c.id, sequence: this.captureSequence++, first: c.first + c.frames - c.used / 2, samples }, [samples.buffer]); c.used = 0;
  }
  finishCapture() { if (!this.capture) return; this.flushCapture(); const frames = this.capture.frames, first = this.capture.first, captureId = this.capture.id; this.capture = null; this.port.postMessage({ type: 'status', phase: 'capture-completed', captureId, frames, first }); }
  process(_in, outputs) {
    const channels = outputs[0], n = channels[0].length;
    if (!this.dsp || !this.playing) return true;
    if (this.dsp.frame >= this.planEnd) { this.playing = false; this.advancing = false; this.finishCapture(); this.report('ended'); return true; }
    const frame = this.dsp.frame;
    let block;
    for (const entry of this.blocks.values()) if (entry.frame <= frame && entry.frame + entry.frames >= frame + n) { block = entry; break; }
    if (!block) { this.advancing = false; if (++this.clockCounter % 16 === 1) { this.report('buffering'); this.port.postMessage({ type: 'need', epoch: this.epoch, frame }); } return true; }
    const inputs = {};
    for (const [id, samples] of Object.entries(block.inputs)) inputs[id] = samples.subarray((frame - block.frame) * 2, (frame - block.frame + n) * 2);
    try {
      const count = Math.min(n, this.planEnd - frame);
      const bounded = {}; for (const [id, samples] of Object.entries(inputs)) bounded[id] = samples.subarray(0, count * 2);
      const wasAdvancing = this.advancing;
      const mix = this.dsp.process(bounded, count); this.advancing = true;
      for (let i = 0; i < n; i++) { channels[0][i] = this.muted ? 0 : (mix[i * 2] || 0); channels[1][i] = this.muted ? 0 : (mix[i * 2 + 1] || 0); }
      if (this.capture) {
        const c = this.capture, captured = Math.min(count, 1440000 - c.frames);
        c.buffer.set(mix.subarray(0, captured * 2), c.used); c.used += captured * 2; c.frames += captured;
        if (c.used >= c.buffer.length || c.frames >= 1440000) this.flushCapture();
        if (c.frames >= 1440000) this.finishCapture();
      }
      if (frame + n >= block.frame + block.frames) { this.blocks.delete(block.frame); this.port.postMessage({ type: 'need', epoch: this.epoch, frame: frame + n }); }
      if (this.dsp.frame >= this.planEnd) { this.playing = false; this.advancing = false; this.finishCapture(); this.report('ended'); }
      else if (!wasAdvancing || ++this.clockCounter % 16 === 0) this.report('playing');
    } catch (error) { this.playing = false; this.advancing = false; this.port.postMessage({ type: 'status', phase: 'error', message: error.message, epoch: this.epoch }); }
    return true;
  }
}
registerProcessor('weijian-mixer', WeijianMixer);
