import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTimelinePlacement } from '../shared/timeline-placement.mjs';
import { contentTime, edgeScrollVelocity, finishTimelineGesture } from '../src/timeline-gesture.mjs';
const project = () => ({ fps: 30, media: [{ id: 'video', type: 'video', duration: 2 }, { id: 'image', type: 'image' }, { id: 'music', type: 'audio', duration: 4 }], subtitles: [], clips: [
  { id: 'moving', mediaId: 'video', track: 'video', layer: 0, start: 0, duration: 2 },
  { id: 'occupied', mediaId: 'video', track: 'video', layer: 0, start: 4, duration: 2 },
  { id: 'upper', mediaId: 'video', track: 'video', layer: 3, start: 1, duration: 2 },
] });
test('strict collision leaves all existing clips intact and four layers are independent', () => {
  const p = project(), before = structuredClone(p);
  const reject = resolveTimelinePlacement(p, { clipId: 'moving', start: 3, track: 'video', layer: 0 });
  assert.equal(reject.code, 'COLLISION'); assert.deepEqual(reject.conflictIds, ['occupied']);
  const moved = resolveTimelinePlacement(p, { clipId: 'moving', start: 3, track: 'video', layer: 2 });
  assert.equal(moved.ok, true); assert.equal(moved.placement.layer, 2); assert.deepEqual(p, before);
  assert.equal(resolveTimelinePlacement(p, { clipId: 'moving', start: 0 }).unchanged, true);
  assert.equal(resolveTimelinePlacement(p, { clipId: 'moving', start: 0, layer: 4 }).code, 'LAYER_INVALID');
});
test('both edges snap to valid anchors; a rejected nearest anchor cannot hide a legal placement', () => {
  const p = project();
  const end = resolveTimelinePlacement(p, { clipId: 'moving', start: 2.04 }, { snap: true, zoom: 50, time: 2.04 });
  assert.equal(end.ok, true); assert.equal(end.placement.start, 2); assert.equal(end.snap.edge, 'end'); assert.equal(end.snap.time, 4);
  const start = resolveTimelinePlacement(p, { clipId: 'moving', start: 6.07 }, { snap: true, zoom: 50 });
  assert.equal(start.placement.start, 6); assert.equal(start.snap.edge, 'start');
  const off = resolveTimelinePlacement(p, { clipId: 'moving', start: 6.07 }, { snap: false, zoom: 50 });
  assert.equal(off.placement.start, 6.07); assert.equal(off.snap, null);
});
test('drop defaults, track rejection, mixable audio and end limit have explicit outcomes', () => {
  const p = project();
  assert.equal(resolveTimelinePlacement(p, { mediaId: 'image', start: 0, layer: 1 }).duration, 5);
  assert.equal(resolveTimelinePlacement(p, { mediaId: 'music', start: 0, track: 'video', layer: 0 }).code, 'TRACK_MISMATCH');
  p.clips.push({ id: 'audio', track: 'audio', start: 0, duration: 4 });
  assert.equal(resolveTimelinePlacement(p, { mediaId: 'music', start: 1, track: 'audio', layer: 0 }).ok, true);
  assert.equal(resolveTimelinePlacement(p, { mediaId: 'video', start: 899, layer: 1 }).code, 'TIMELINE_LIMIT');
  assert.equal(resolveTimelinePlacement(p, { mediaId: 'video', start: NaN }).code, 'POSITION_INVALID');
  assert.equal(resolveTimelinePlacement(p, { mediaId: 'missing', start: 0 }).code, 'ITEM_MISSING');
});
test('content coordinates include horizontal scroll and edge scroll has bounded signed speed', () => {
  assert.equal(contentTime(300, 100, 50), 4);
  assert.equal(contentTime(300, -100, 50), 8);
  assert.equal(edgeScrollVelocity(500, 100, 900), 0);
  assert.equal(edgeScrollVelocity(0, 100, 900), -720);
  assert.equal(edgeScrollVelocity(950, 100, 900), 720);
  assert.equal(edgeScrollVelocity(118, 100, 900), -360);
});
test('only a completed valid gesture produces one commit intent; cancellation and no-op do not', () => {
  const current = { id: 'moving', kind: 'clip', mode: 'move', moved: true, original: project().clips[0],
    resolution: { ok: true, unchanged: false, placement: { start: 3, track: 'video', layer: 2 } } };
  assert.equal(finishTimelineGesture(current).type, 'move');
  assert.equal(finishTimelineGesture(current, true).type, 'cancelled', 'pointercancel/lost capture/Escape must never commit');
  assert.equal(finishTimelineGesture({ ...current, resolution: { ok: false, message: 'collision' } }).type, 'rejected');
  assert.equal(finishTimelineGesture({ ...current, resolution: { ok: true, unchanged: true } }).type, 'none');
  assert.equal(finishTimelineGesture({ ...current, mode: 'right', patch: { duration: 2 } }).type, 'none');
  assert.deepEqual(finishTimelineGesture({ ...current, mode: 'right', patch: { duration: 1 } }), { type: 'trim', id: 'moving', bounds: { start: 0, end: 1 } });
});
test('fractional source duration preserves the resolved end edge when committed without another snap', () => {
  const p = project();p.clips[0].duration = 2.017;
  const result = resolveTimelinePlacement(p, { clipId: 'moving', start: 2 }, { snap: true, zoom: 50 });
  assert.equal(result.ok, true); assert.equal(result.placement.start, 1.983);
  assert.deepEqual(resolveTimelinePlacement(p, { clipId: 'moving', ...result.placement }).placement, result.placement);
});
test('library pointer placement commits only after movement and a valid terminal event', () => {
  const current = { kind: 'media', id: 'image', moved: true,
    resolution: resolveTimelinePlacement(project(), { mediaId: 'image', start: 1.5, layer: 2 }) };
  assert.deepEqual(finishTimelineGesture(current), { type: 'media', id: 'image', placement: { start: 1.5, track: 'video', layer: 2 } });
  assert.equal(finishTimelineGesture({ ...current, moved: false }).type, 'none', 'quick click is handled once by source button');
  assert.equal(finishTimelineGesture(current, true).type, 'cancelled');
  assert.equal(finishTimelineGesture({ ...current, resolution: { ok: false, message: 'no lane' } }).type, 'rejected');
});
