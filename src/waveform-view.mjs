import { sourceTimesAt } from '../shared/model.mjs';

export const MAX_WAVEFORM_COLUMNS = 2048;

// The media producer owns peak bins; the model owns source time. Sampling both
// edges preserves short transients when many source bins map to one screen px.
export function waveformColumns(clip, waveform, { width, totalWidth = width, offset = 0 } = {}) {
  if (!waveform?.peaks?.length || !(width > 0) || !(totalWidth > 0)) return [];
  const count = Math.min(MAX_WAVEFORM_COLUMNS, Math.ceil(width));
  const columns = new Array(count);
  const binsPerSecond = waveform.sampleRate / waveform.binSamples;
  const boundaries = sourceTimesAt(clip, Array.from({ length: count + 1 }, (_, i) =>
    clip.start + clip.duration * Math.max(0, Math.min(1, (offset + width * i / count) / totalWidth))));
  for (let i = 0; i < count; i++) {
    const from = boundaries[i], to = boundaries[i + 1];
    const a = Math.max(0, Math.min(waveform.peaks.length - 1, Math.floor(from * binsPerSecond)));
    const b = Math.max(a, Math.min(waveform.peaks.length - 1, Math.ceil(to * binsPerSecond - 1e-8) - 1));
    let peak = 0;
    for (let bin = a; bin <= b; bin++) peak = Math.max(peak, waveform.peaks[bin]);
    columns[i] = peak / waveform.magnitude;
  }
  return columns;
}

// One source-wide reference keeps low-level recordings legible without changing
// amplitude when scrolling/zooming or pretending this is an output gain meter.
export function waveformReference(waveform) {
  const maximum = waveform.peaks.reduce((peak, value) => Math.max(peak, value), 0);
  return maximum > 0 ? maximum / waveform.magnitude : 1;
}

export function waveformPath(columns, reference = 1) {
  return columns.map((peak, index) => {
    const height = Math.min(1, Math.max(0, peak / reference)) * 48;
    return `M${index + .5} ${50 - height}V${50 + height}`;
  }).join('');
}
