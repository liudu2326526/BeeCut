const records = new Map();
const MAX_RECORDS = 64, MAX_POLLS = 180;
const notify = record => { for (const callback of record.listeners) callback(record.value); };
const keyFor = media => JSON.stringify([media.id, media.url]);
function prune() {
  for (const [key, record] of records) {
    if (records.size <= MAX_RECORDS) return;
    if (!record.listeners.size) { clearTimeout(record.timer); record.controller?.abort(); records.delete(key); }
  }
}
function validReady(value) {
  return value.sampleRate === 48000 && value.magnitude === 65535 && Number.isFinite(value.duration) && value.duration > 0 &&
    Number.isInteger(value.binSamples) && value.binSamples >= 1 && Array.isArray(value.peaks) && value.peaks.length > 0 && value.peaks.length <= 20000 &&
    value.peaks.every(p => Number.isInteger(p) && p >= 0 && p <= 65535);
}
async function request(record, retry = false) {
  if (record.controller || !record.listeners.size) return;
  if (++record.polls > MAX_POLLS) {
    record.value = { status: 'failed', error: '波形仍在处理或排队，点击重试查看' }; notify(record); return;
  }
  const controller = new AbortController(); record.controller = controller;
  try {
    const response = await fetch(`/api/media/${encodeURIComponent(record.id)}/waveform${retry ? '/retry' : ''}`, { method: retry ? 'POST' : 'GET', signal: controller.signal });
    const value = await response.json();
    if (record.controller !== controller) return;
    if (!response.ok) throw new Error(value.error || '无法读取音频波形');
    if (value.mediaId !== record.id || !['queued', 'processing', 'ready', 'no-audio', 'failed'].includes(value.status) || (value.status === 'ready' && !validReady(value))) throw new Error('音频波形数据无效');
    record.value = value; notify(record);
    if (['queued', 'processing'].includes(value.status) && record.listeners.size)
      record.timer = setTimeout(() => request(record), Math.min(2000, Math.max(250, value.retryAfterMs || 500)));
  } catch (error) {
    if (record.controller === controller && error.name !== 'AbortError') { record.value = { status: 'failed', error: error.message || '无法读取音频波形' }; notify(record); }
  } finally { if (record.controller === controller) record.controller = null; }
}
export function subscribeWaveform(media, callback) {
  const key = keyFor(media);
  let record = records.get(key);
  if (!record) {
    record = { id: media.id, value: { status: 'queued' }, listeners: new Set(), polls: 0 };
    records.set(key, record);
  }
  record.listeners.add(callback); callback(record.value); prune();
  if (!['ready', 'no-audio', 'failed'].includes(record.value.status)) request(record);
  return () => { record.listeners.delete(callback); if (!record.listeners.size) {
    clearTimeout(record.timer); const controller = record.controller; record.controller = null; controller?.abort();
  } };
}
export function retryWaveform(media) {
  const record = records.get(keyFor(media));
  if (!record) return;
  clearTimeout(record.timer); record.polls = 0; record.value = { status: 'queued' }; notify(record); request(record, true);
}
