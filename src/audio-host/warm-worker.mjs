import { createAudioDSP, AUDIO_DSP_WARMUP_FRAMES } from '../../shared/audio-dsp.mjs';
import { createPCMProvider } from './pcm-provider.mjs';
self.onmessage = async ({ data }) => {
  try {
    const { plan, assets, lease, frame, epoch, revision } = data;
    const start = Math.max(0, frame - AUDIO_DSP_WARMUP_FRAMES), dsp = createAudioDSP(plan, { frame: start });
    const read = createPCMProvider(plan, assets, lease, { origin: self.location.origin });
    while (dsp.frame < frame) { const count = Math.min(16384, frame - dsp.frame); dsp.process(await read(dsp.frame, count), count); }
    self.postMessage({ epoch, revision, state: dsp.snapshot() });
  } catch (error) { self.postMessage({ error: error.message, failures: error.failures, epoch: data.epoch, revision: data.revision }); }
};
