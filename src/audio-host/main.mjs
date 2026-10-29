import processorUrl from './processor.mjs?worker&url';
import { createPCMProvider } from './pcm-provider.mjs';
import { createObservedAudioClock } from './observed-clock.mjs';
import { AUDIO_STREAM_BLOCK_FRAMES as STREAM_FRAMES, AUDIO_STREAM_LOOKAHEAD_BLOCKS as LOOKAHEAD_BLOCKS } from './stream-config.mjs';

const bridge = window.audioHost;
let context, node, warm, plan, assets, lease, read, epoch = -1, revision = -1, desired = { frame: 0, playing: false, muted: false };
let nextRead = 0, pumping = false, generation = 0, installed = false, abort, failed = false, pumpDemand = 0, lastProcessorAt = 0;
const observedClock = createObservedAudioClock();
const status = value => bridge.status(value);
setInterval(() => {
  status({ phase: 'heartbeat' });
  if (installed && desired.playing && !failed && performance.now() - lastProcessorAt > 4000) fail(new Error('音频处理进度超时；画面可继续，请重试音频。'));
}, 500);
function fail(error) {
  observedClock.stop();
  failed = true; installed = false; generation++; abort?.abort(); warm?.terminate(); warm = null;
  node?.port.postMessage({ type: 'halt' });
  status({ phase: 'error', message: error.message || String(error), failures: error.failures, epoch, revision });
}
async function initialize() {
  // This constructor can synchronously block with broken devices. Only this isolated renderer owns it.
  context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  if (context.sampleRate !== 48000) throw new Error('音频设备不支持本版 48 kHz 实时处理');
  await context.audioWorklet.addModule(processorUrl);
  node = new AudioWorkletNode(context, 'weijian-mixer', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
  node.connect(context.destination);
  node.port.onmessage = ({ data }) => {
    if (data.type === 'capture') { bridge.capture(data); return; }
    if (data.epoch !== undefined && data.epoch !== epoch) return;
    if (data.type === 'need') { void pump(data.frame); return; }
    if (data.type === 'status') {
      if (failed && !['capture-completed', 'capture-error'].includes(data.phase)) return;
      lastProcessorAt = performance.now(); observedClock.observe(data);
      const latency = Math.max(0, context.outputLatency || context.baseLatency || 0);
      status({ ...data, phase: data.phase === 'ack' ? 'applied' : data.phase, outputLatency: latency, deviceState: context.state });
    }
  };
  context.onstatechange = () => { if (context.state !== 'running') fail(new Error('音频设备已暂停；画面可继续，请重试音频。')); };
  await context.resume();
  status({ phase: 'host-ready', sampleRate: context.sampleRate });
}
async function pump(frame) {
  if (!installed) return;
  pumpDemand = Math.max(pumpDemand, frame);
  if (pumping) return; // The retained demand is consumed by this task or its finalizer.
  pumping = true; const ownGeneration = generation, ownRead = read, ownSignal = abort.signal;
  try {
    while (installed && ownGeneration === generation && nextRead < Math.min(plan.outputFrames, pumpDemand + STREAM_FRAMES * LOOKAHEAD_BLOCKS)) {
      const at = nextRead;
      const inputs = await ownRead(at, STREAM_FRAMES, ownSignal);
      if (ownGeneration !== generation || !installed) break;
      nextRead = at + STREAM_FRAMES;
      node.port.postMessage({ type: 'block', epoch, frame: at, frames: STREAM_FRAMES, inputs }, Object.values(inputs).map(a => a.buffer));
    }
  } catch (error) { if (ownGeneration === generation && error.name !== 'AbortError') fail(error); }
  finally {
    pumping = false;
    if (installed && nextRead < Math.min(plan.outputFrames, pumpDemand + STREAM_FRAMES * LOOKAHEAD_BLOCKS)) void pump(pumpDemand);
  }
}
function prepareAt(frame) {
  observedClock.stop();
  installed = false; generation++; abort?.abort(); abort = new AbortController(); warm?.terminate();
  node.port.postMessage({ type: 'halt' });
  status({ phase: 'priming', epoch, revision });
  const ownEpoch = epoch, ownRevision = revision, worker = new Worker(new URL('./warm-worker.mjs', import.meta.url), { type: 'module' });
  warm = worker;
  worker.onmessage = async ({ data }) => {
    if (warm !== worker || data.epoch !== epoch || data.revision !== revision) return;
    worker.terminate(); warm = null;
    if (data.error) { const error = new Error(data.error); error.failures = data.failures; fail(error); return; }
    const state = data.state, ownGeneration = generation, ownRead = read, ownSignal = abort.signal;
    try {
      // Install the first PCM block atomically with DSP state. A ready status
      // must never start a live processor whose first samples are still in HTTP.
      const inputs = await ownRead(state.frame, STREAM_FRAMES, ownSignal);
      if (ownGeneration !== generation || ownEpoch !== epoch || ownRevision !== revision) return;
      observedClock.reset(state.frame); nextRead = state.frame + STREAM_FRAMES; pumpDemand = state.frame; lastProcessorAt = performance.now(); installed = true;
      const initialBlock = { frame: state.frame, frames: STREAM_FRAMES, inputs };
      node.port.postMessage({ type: 'install', epoch, revision, plan, state, initialBlock, playing: desired.playing, muted: desired.muted }, Object.values(inputs).map(a => a.buffer));
      void pump(state.frame);
    } catch (error) { if (ownGeneration === generation && error.name !== 'AbortError') fail(error); }
  };
  worker.onerror = event => { if (warm === worker) fail(new Error(event.message)); };
  worker.postMessage({ plan, assets, lease, frame, epoch: ownEpoch, revision: ownRevision });
}
function handle(command) {
  if (command.type === 'halt') { observedClock.stop(); desired.playing = false; installed = false; generation++; abort?.abort(); warm?.terminate(); warm = null; node.port.postMessage({ type: 'halt' }); return; }
  if (command.type === 'capture-start' || command.type === 'capture-stop') { node.port.postMessage({ ...command, epoch, revision }); return; }
  if (command.epoch < epoch || (command.epoch === epoch && command.revision < revision)) return;
  const previousPlan = plan, newEpoch = command.epoch !== epoch, priorFrame = observedClock.current();
  epoch = command.epoch; revision = command.revision;
  desired = { frame: command.frame, playing: command.playing, muted: command.muted };
  if (command.type === 'install') {
    failed = false; plan = command.plan; assets = command.assets; lease = command.lease;
    read = createPCMProvider(plan, assets, lease); prepareAt(command.frame);
  } else if (command.type === 'plan') {
    plan = command.plan;
    const hot = installed && previousPlan.clips.length === plan.clips.length && plan.clips.every((c, i) => { const p = previousPlan.clips[i]; return c.id === p.id && c.first === p.first && c.end === p.end && c.effectSignature === p.effectSignature; });
    read = createPCMProvider(plan, assets, lease);
    if (hot && !newEpoch) node.port.postMessage({ type: 'plan', epoch, revision, plan });
    else prepareAt(!newEpoch && installed && command.playing ? Math.min(plan.outputFrames, priorFrame) : command.frame);
  } else if (command.type === 'transport' && plan) {
    if (newEpoch) prepareAt(command.frame);
    else node.port.postMessage({ type: 'transport', epoch, playing: desired.playing, muted: desired.muted });
  }
}
let queue = [];
bridge.onCommand(command => { if (!node) queue.push(command); else { try { handle(command); } catch (error) { fail(error); } } });
initialize().then(() => { for (const command of queue) handle(command); queue = []; }).catch(fail);
