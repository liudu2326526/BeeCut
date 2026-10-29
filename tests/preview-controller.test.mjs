import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewController } from '../src/preview-controller.mjs';

class Media extends EventTarget {
  constructor() {
    super(); this.readyState = 0; this.networkState = 0; this.duration = NaN;
    this.paused = true; this.seeking = false; this.error = null; this.position = 0;
    this.loads = 0; this.seeks = []; this.plays = []; this.listeners = 0;
  }
  addEventListener(...args) { this.listeners++; super.addEventListener(...args); }
  removeEventListener(...args) { this.listeners--; super.removeEventListener(...args); }
  get currentTime() { return this.position; }
  set currentTime(value) {
    if (this.seekError) throw new Error('unseekable');
    this.position = value; this.seeking = true; this.seeks.push(value);
  }
  load() { this.loads++; this.readyState = 0; this.duration = NaN; this.position = 0; this.seeking = false; this.error = null; }
  pause() { this.paused = true; }
  play() {
    const pending = {};
    pending.promise = new Promise((resolve, reject) => { pending.resolve = resolve; pending.reject = reject; });
    this.plays.push(pending); return pending.promise;
  }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  metadata() { this.duration = 4; this.readyState = 1; this.emit('loadedmetadata'); }
  decoded() { this.readyState = 4; this.emit('loadeddata'); }
  sought() { this.seeking = false; this.readyState = 4; this.emit('seeked'); }
  emit(name) { this.dispatchEvent(new Event(name)); }
}
const state = (extra = {}) => ({ source: '/first.mp4', target: 1.5, rate: 1, playing: false, volume: .5, muted: true, ...extra });
const drain = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const element = new Media(), events = [], timers = new Map(); let timerId = 0;
  const controller = createPreviewController(element, { onStatus: value => events.push(value),
    setTimer: action => { timers.set(++timerId, action); return timerId; }, clearTimer: id => timers.delete(id) });
  return { element, controller, events, timers };
}

test('load and seek gate playback; a late metadata event consumes the latest target', async () => {
  const { element, controller } = fixture();
  controller.update(state({ playing: true, target: .2 }));
  controller.update(state({ playing: true, target: 2.7 }));
  assert.equal(element.plays.length, 0);
  element.metadata();
  assert.deepEqual(element.seeks, [2.7]);
  assert.equal(element.plays.length, 0, 'metadata alone is not a decoded frame');
  element.decoded();
  assert.equal(element.plays.length, 0, 'seek completion still gates play');
  element.sought();
  assert.equal(element.plays.length, 1);
  element.paused = false; element.plays[0].resolve(); await drain();
  assert.equal(controller.snapshot().phase, 'playing');
  controller.destroy();
});

test('a source-only change reapplies the paused position rather than showing its black first frame', () => {
  const { element, controller } = fixture();
  controller.update(state()); element.metadata(); element.sought();
  assert.equal(element.currentTime, 1.5);
  controller.update(state({ source: '/second.mp4' }));
  assert.equal(element.loads, 2); assert.equal(element.currentTime, 0);
  element.metadata(); element.sought();
  assert.equal(element.currentTime, 1.5); assert.equal(controller.snapshot().phase, 'ready');
  controller.destroy();
});

test('expired play resolution/rejection cannot change a newer source or pause intent', async () => {
  const { element, controller } = fixture();
  controller.update(state({ target: 0, playing: true })); element.metadata(); element.sought();
  const old = element.plays[0];
  controller.update(state({ source: '/second.mp4', target: 0, playing: false }));
  old.reject(Object.assign(new Error('load changed'), { name: 'AbortError' })); await drain();
  assert.equal(controller.snapshot().phase, 'loading');
  assert.equal(controller.snapshot().code, null);
  element.metadata(); element.sought();
  controller.update(state({ source: '/second.mp4', target: 0, playing: true }));
  const next = element.plays.at(-1);
  controller.update(state({ source: '/second.mp4', target: 0, playing: false }));
  next.resolve(); await drain();
  assert.equal(controller.snapshot().phase, 'ready'); assert.equal(element.paused, true);
  controller.destroy();
});

test('rapid scrubbing and a transition hold settle on the newest boundary frame', () => {
  const { element, controller } = fixture();
  controller.update(state({ target: 2.966667 })); element.metadata();
  controller.update(state({ target: 3.1 })); controller.update(state({ target: 2.966667 }));
  element.sought();
  assert.equal(element.currentTime, 2.966667);
  assert.equal(element.plays.length, 0);
  controller.update(state({ target: 4 })); element.sought();
  assert.equal(element.currentTime, 3.999, 'source end clamps before the unrenderable endpoint');
  controller.destroy();
});

test('decode failure is explicit and never retried automatically; manual reload retains position', () => {
  const { element, controller, events, timers } = fixture();
  controller.update(state());
  element.error = { code: 3 }; element.emit('error');
  assert.equal(controller.snapshot().code, 'MEDIA_DECODE_ERROR');
  for (let n = 0; n < 10; n++) controller.update(state({ target: 2.2 }));
  assert.equal(element.loads, 1); assert.equal(timers.size, 0);
  controller.retry(); assert.equal(element.loads, 2);
  element.metadata(); element.sought();
  assert.equal(element.currentTime, 2.2); assert.equal(controller.snapshot().phase, 'ready');
  assert.ok(events.some(event => event.code === 'MEDIA_DECODE_ERROR'));
  controller.destroy();
});

test('play rejection, seek exception and a missing readiness event fail visibly with bounded work', async () => {
  const a = fixture(); a.controller.update(state({ target: 0, playing: true })); a.element.metadata(); a.element.sought();
  a.element.plays[0].reject(Object.assign(new Error('gesture needed'), { name: 'NotAllowedError' })); await drain();
  assert.equal(a.controller.snapshot().code, 'PLAY_NOT_ALLOWED'); a.controller.destroy();
  const b = fixture(); b.controller.update(state()); b.element.seekError = true; b.element.metadata();
  assert.equal(b.controller.snapshot().code, 'SEEK_FAILED'); b.controller.destroy();
  const c = fixture(); c.controller.update(state());
  for (let n = 0; n < 20; n++) c.controller.update(state({ target: n / 10 }));
  assert.equal(c.timers.size, 1, 'render updates do not restart an unbounded loading deadline');
  [...c.timers.values()][0]();
  assert.equal(c.controller.snapshot().code, 'PREVIEW_TIMEOUT'); assert.equal(c.element.loads, 1);
  c.controller.destroy();
});

test('speed and pitch are owned by current sampling; destroy releases listeners and decoder', () => {
  const { element, controller, timers } = fixture();
  controller.update(state({ target: 1, rate: .5 })); element.metadata(); element.sought();
  controller.update(state({ target: 1.2, rate: 2 })); element.sought();
  assert.equal(element.playbackRate, 2); assert.equal(element.preservesPitch, true);
  assert.equal(element.currentTime, 1.2);
  assert.ok(element.listeners > 0);
  controller.destroy();
  assert.equal(element.listeners, 0); assert.equal(timers.size, 0); assert.equal(element.src, '');
  const loads = element.loads; controller.retry(); controller.update(state());
  assert.equal(element.loads, loads);
});

test('visibility restoration rechecks readiness without loading again; a buffered stall is not fatal', async () => {
  const previousDocument = globalThis.document;
  const document = new EventTarget(); document.visibilityState = 'hidden'; globalThis.document = document;
  const { element, controller } = fixture();
  try {
    controller.update(state({ target: 0, playing: true }));
    // Some platforms deliver the resume callback before their media event.
    element.duration = 4; element.readyState = 4;
    document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange'));
    element.sought();
    assert.equal(element.plays.length, 1);
    element.paused = false; element.plays[0].resolve(); await drain();
    element.emit('stalled');
    assert.equal(controller.snapshot().phase, 'playing');
    assert.equal(element.loads, 1, 'visibility never loops reloads');
  } finally { controller.destroy(); globalThis.document = previousDocument; }
});

test('an ended source holds its final frame instead of play implicitly rewinding to a black first frame', async () => {
  const { element, controller } = fixture();
  controller.update(state({ target: 3.9, playing: true })); element.metadata(); element.sought();
  element.paused = false; element.plays[0].resolve(); await drain();
  element.position = 4; element.ended = true; element.paused = true; element.emit('ended');
  assert.equal(element.plays.length, 1, 'must not call play() on an ended source near its tail');
  assert.equal(controller.snapshot().phase, 'ready');
  controller.update(state({ target: 2, playing: false }));
  assert.equal(element.currentTime, 2, 'explicit backward seek still takes effect');
  controller.destroy();
});


test('paused metadata-only source requests its initial zero frame exactly once per source epoch', () => {
  const { element, controller } = fixture();
  controller.update(state({ target: 0 })); element.metadata();
  assert.deepEqual(element.seeks, [0], 'same currentTime is still an explicit initial decode request');
  assert.equal(controller.snapshot().phase, 'seeking');
  element.sought(); assert.equal(controller.snapshot().phase, 'ready');
  for (let n = 0; n < 10; n++) controller.update(state({ target: 0 }));
  assert.deepEqual(element.seeks, [0], 'must not repeatedly seek or reload a ready zero frame');
  controller.retry(); element.metadata(); element.sought();
  assert.deepEqual(element.seeks, [0, 0]); assert.equal(element.loads, 2);
  controller.destroy();
});

test('readiness arriving after its deadline clears the stale timeout without reload or automatic playback', () => {
  const { element, controller, timers } = fixture();
  controller.update(state({ target: 0, playing: true })); element.metadata();
  [...timers.values()][0]();
  assert.equal(controller.snapshot().code, 'PREVIEW_TIMEOUT');
  assert.equal(element.loads, 1);
  // The same physical source eventually finishes its initial seek/decode.
  element.sought();
  const snapshot = controller.snapshot();
  assert.equal(snapshot.phase, 'ready'); assert.equal(snapshot.code, null);
  assert.equal(snapshot.lastFailure.code, 'PREVIEW_TIMEOUT');
  assert.equal(element.loads, 1); assert.equal(element.plays.length, 0);
  assert.equal(element.paused, true); assert.equal(snapshot.playingRequested, false);
  assert.ok(snapshot.eventTail.some(event => event.event === 'late-readiness-after-timeout'));
  controller.destroy();
});

test('diagnostic snapshots have bounded event tails and live range/decoder/visibility facts', () => {
  const { element, controller } = fixture();
  element.buffered = { length: 1, start: () => 0, end: () => 4 };
  element.seekable = { length: 1, start: () => 0, end: () => 4 };
  element.videoWidth = 640; element.videoHeight = 360; element.webkitDecodedFrameCount = 7;
  controller.update(state({ target: 0 })); element.metadata(); element.sought();
  for (let i = 0; i < 80; i++) element.emit('stalled');
  const snapshot = controller.snapshot();
  assert.equal(snapshot.eventTail.length, 32);
  assert.deepEqual(snapshot.buffered, { count: 1, ranges: [[0, 4]] });
  assert.equal(snapshot.videoWidth, 640); assert.equal(snapshot.decodedFrames, 7);
  assert.equal(snapshot.sourceMatches, null, 'unavailable document identity remains unknown');
  assert.ok(!JSON.stringify(snapshot).includes('/first.mp4'), 'diagnostic event tail retains no source URL or library path');
  controller.destroy();
});

test('native preview volume preserves 0–100 percent exactly and exposes a capped boost request', () => {
  const { element, controller } = fixture();
  controller.update(state({ volume: .25, muted: false })); element.metadata(); element.sought();
  assert.equal(element.volume, .25); assert.equal(element.muted, false);
  controller.update(state({ volume: 1, muted: false })); assert.equal(element.volume, 1);
  controller.update(state({ volume: 1.5, muted: false }));
  assert.equal(element.volume, 1); assert.equal(controller.snapshot().requestedVolume, 1.5);
  controller.update(state({ volume: .25, muted: true }));
  assert.equal(element.volume, .25); assert.equal(element.muted, true);
  controller.destroy();
});
