import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectJianyingDraft, convertJianyingDraft, JianyingDraftError, JIANYING_DRAFT_PROFILE, JIANYING_DRAFT_LIMITS } from '../shared/jianying-draft.mjs';
import { validateProject } from '../server/validate.mjs';

const range = (start, duration) => ({ start, duration });
function fixture() {
  return { version: 360000, name: '自制素材明文结构夹具', canvas_config: { width: 1920, height: 1080, ratio: 'original' }, fps: 30, platform: { app_version: '5.9.0', os: 'windows', app_source: 'lv' }, materials: {
    videos: [{ id: 'video-source', type: 'video', path: 'media/marker.mp4', duration: 12000000, width: 1920, height: 1080 }, { id: 'photo-source', type: 'photo', path: 'media/still.png', duration: 10800000000, width: 1920, height: 1080 }],
    audios: [{ id: 'audio-source', type: 'extract_music', path: 'media/tones.wav', duration: 12000000 }],
    texts: [{ id: 'text-source', type: 'text', content: JSON.stringify({ text: '你好，剪映草稿\n继续在微剪编辑', styles: [{ size: 8, fill: { alpha: 1 } }] }) }],
    speeds: [{ id: 'speed-source', type: 'speed', speed: 2, curve_speed: null }],
    audio_fades: [{ id: 'fade-source', type: 'audio_fade', fade_type: 0, fade_in_duration: 200000, fade_out_duration: 400000 }],
  }, tracks: [
    { id: 'video-track', type: 'video', attribute: 0, segments: [{ id: 'v1', material_id: 'video-source', target_timerange: range(1234567, 2000000), source_timerange: range(2000000, 4000000), speed: 2, volume: 1.6, extra_material_refs: ['speed-source', 'fade-source'], render_index: 0, is_tone_modify: false, clip: { scale: { x: .5, y: .5 }, transform: { x: .25, y: -.5 }, rotation: 45, alpha: .7, flip: { horizontal: true, vertical: false } } }] },
    { id: 'picture-overlay', type: 'video', segments: [{ id: 'p1', material_id: 'photo-source', target_timerange: range(0, 5000000), source_timerange: null, speed: 1, volume: 0, render_index: 1 }] },
    { id: 'audio-track', type: 'audio', attribute: 1, segments: [{ id: 'a1', material_id: 'audio-source', target_timerange: range(456789, 3000000), source_timerange: range(123456, 3000000), speed: 1, volume: .75, render_index: 2 }] },
    { id: 'text-track', type: 'text', segments: [{ id: 't1', material_id: 'text-source', target_timerange: range(1000000, 2000000), render_index: 3 }] },
  ] };
}
function media() {
  return new Map([
    ['video-source', { id: 'local-video', name: 'marker.mp4', type: 'video', duration: 12, width: 1920, height: 1080, fps: 30, hasAudio: true, url: '/media/local-video' }],
    ['photo-source', { id: 'local-image', name: 'still.png', type: 'image', duration: 0, width: 1920, height: 1080, fps: 0, hasAudio: false, url: '/media/local-image' }],
    ['audio-source', { id: 'local-audio', name: 'tones.wav', type: 'audio', duration: 12, width: 0, height: 0, fps: 0, hasAudio: true, url: '/media/local-audio' }],
  ]);
}
const inspect = document => inspectJianyingDraft(document);
const error = (out, code) => out.issues.some(i => i.severity === 'error' && i.code === code);
const convert = (out, bySource = media()) => convertJianyingDraft(out, { id: 'new-independent-project', mediaBySourceId: bySource, createdAt: '2026-10-22T00:00:00.000Z' });

test('P0 readable profile maps microseconds, constant speed, independent media ids, layers, mute, transform, fades and editable text', () => {
  const input = fixture(), before = structuredClone(input), out = inspect(input);
  assert.equal(out.canImport, true, JSON.stringify(out.issues));
  assert.equal(out.profile, JIANYING_DRAFT_PROFILE);
  assert.deepEqual(out.sourceVersion, { draft: 360000, app: '5.9.0', newVersion: null });
  assert.deepEqual(input, before, 'inspection must not mutate caller draft');
  assert.equal(out.materials.length, 3);
  const p = convert(out), bySource = media();
  assert.equal(p.id, 'new-independent-project');
  assert.deepEqual(p.clips.map(c => [c.track, c.layer]), [['video', 0], ['video', 1], ['audio', 0]]);
  const v = p.clips[0];
  assert.equal(v.start, 1.234567); assert.equal(v.sourceStart, 2); assert.equal(v.duration, 2); assert.equal(v.speed, 2); assert.equal(v.volume, 1.6);
  assert.deepEqual(v.transform, { scale: .5, x: 240, y: 270, rotation: 45, opacity: .7, flipX: true, flipY: false });
  assert.equal(v.fadeIn, .2); assert.equal(v.fadeOut, .4);
  assert(out.issues.some(i => i.code === 'FADE_LAW_APPROXIMATED'));
  assert(out.mapping.some(m => m.sourcePath.endsWith('/fade_in_duration') && m.loss.includes('尚未做原生对照')));
  assert.equal(p.audioLanes[0].muted, true);
  assert.equal(p.clips[1].sourceStart, 0); assert.equal(p.clips[1].duration, 5);
  assert.equal(p.subtitles[0].text, '你好，剪映草稿\n继续在微剪编辑');
  assert.equal(p.subtitles[0].position, 'bottom');
  assert(out.issues.some(i => i.code === 'TEXT_STYLE_REPLACED' && i.severity === 'warning'));
  assert(out.mapping.some(m => m.sourceValue === 1234567 && m.targetValue === 1.234567 && m.rule.includes('不按帧取整')));
  assert(out.mapping.some(m => m.sourcePath.endsWith('/content') && m.loss));
  assert(p.clips.every(c => !('sourcePath' in c) && !('sourceMaterialId' in c)));
  const store = { media: new Map([...bySource.values()].map(m => [m.id, m])) };
  const valid = validateProject(p, store, { touch: false });
  assert.equal(valid.clips[0].duration, 2);
  assert.equal(valid.media.length, 3);
});

test('all input source leaves receive field mapping or a retained containing record', () => {
  const input = fixture(); input.tracks[0].segments[0].unknown_plugin = { kind: 'pretend', amount: 7 };
  const out = inspect(input);
  function walk(value, path) {
    if (value && typeof value === 'object' && Object.keys(value).length) for (const [k, v] of Object.entries(value)) walk(v, `${path}/${k}`);
    else assert(out.mapping.some(m => m.sourcePath === path || path.startsWith(m.sourcePath + '/')), `unrecorded leaf ${path}`);
  }
  walk(input, '');
  assert(out.issues.some(i => i.sourcePath.endsWith('/unknown_plugin/amount') && i.code === 'UNSUPPORTED_FIELD'));
  assert.equal(out.mapping.find(m => m.sourcePath.endsWith('/unknown_plugin/amount')).sourceValue, 7);
});

test('opaque, damaged JSON, unknown draft versions and unsafe structures fail with reasons without fallback or target execution', () => {
  for (const source of ['F1C1R5/9HfFVtH6Uil09BaeeF', '{broken', '[]']) assert.equal(inspect(source).canImport, false);
  assert(error(inspect('F1C1R5/9HfFVtH6Uil09BaeeF'), 'UNREADABLE_DRAFT'));
  assert(error(inspect({ ...fixture(), version: 999999 }), 'UNSUPPORTED_VERSION'));
  assert(error(inspect(JSON.parse('{"__proto__":{"polluted":true}}')), 'UNSAFE_JSON_KEY'));
  const cyclic = fixture(); cyclic.self = cyclic; assert(error(inspect(cyclic), 'CYCLIC_DOCUMENT'));
  let getterCalled = false; const getter = fixture(); Object.defineProperty(getter, 'trap', { enumerable: true, get() { getterCalled = true; return 1; } });
  assert(error(inspect(getter), 'UNSAFE_JSON_KEY')); assert.equal(getterCalled, false);
  assert.equal({}.polluted, undefined);
  const tooDeep = fixture(); let child = tooDeep;
  for (let i = 0; i < 50; i++) child = child.child = {};
  assert(error(inspect(tooDeep), 'DOCUMENT_COMPLEXITY'));
});

test('capacity and original timing errors reject rather than clamp, flatten or trim', () => {
  const variants = [
    ['VALUE_OUT_OF_RANGE', x => x.fps = 120], ['INVALID_CANVAS', x => x.canvas_config.width = 1919],
    ['VALUE_OUT_OF_RANGE', x => x.tracks[0].segments[0].volume = 4], ['VALUE_OUT_OF_RANGE', x => x.tracks[0].segments[0].speed = .1],
    ['INCONSISTENT_TIME_RANGE', x => x.tracks[0].segments[0].source_timerange.duration = 3999900],
    ['VALUE_OUT_OF_RANGE', x => x.tracks[0].segments[0].source_timerange.start = 1.5],
    ['TIMELINE_CAPACITY', x => x.tracks[0].segments[0].target_timerange.start = 899000000],
    ['NON_UNIFORM_SCALE', x => x.tracks[0].segments[0].clip.scale.y = 2],
    ['SOURCE_RANGE_OUTSIDE_MEDIA', x => x.materials.videos[0].duration = 3000000],
    ['MISSING_MATERIAL_REFERENCE', x => x.tracks[0].segments[0].material_id = 'gone'],
  ];
  for (const [code, change] of variants) { const input = fixture(); change(input); const out = inspect(input); assert(error(out, code), `${code}: ${JSON.stringify(out.issues)}`); assert.equal(out.canImport, false); }
  const excess = fixture();
  for (let i = 0; i < 3; i++) { const t = structuredClone(excess.tracks[1]); t.id = `extra-${i}`; t.segments[0].id = `extra-segment-${i}`; delete t.segments[0].render_index; excess.tracks.push(t); }
  assert(error(inspect(excess), 'TRACK_CAPACITY'));
  const overlap = fixture(); const copy = structuredClone(overlap.tracks[0].segments[0]); copy.id = 'overlap'; overlap.tracks[0].segments.push(copy);
  assert(error(inspect(overlap), 'OVERLAPPING_VIDEO_TRACK'));
});

test('effects and keyframes produce explicit per-source warnings; curve speed, reverse and ordering ambiguity block conversion', () => {
  const input = fixture();
  input.materials.transitions = [{ id: 'tr1', type: 'transition', name: '叠化', duration: 500000 }];
  input.tracks[0].segments[0].extra_material_refs.push('tr1', 'unknown-extra');
  input.tracks[0].segments[0].common_keyframes = [{ property_type: 'KFTypePositionX', keyframe_list: [{ time_offset: 0, values: [1] }] }];
  const out = inspect(input); assert.equal(out.canImport, true);
  for (const code of ['UNSUPPORTED_EFFECT', 'UNKNOWN_EXTRA_MATERIAL', 'UNSUPPORTED_KEYFRAMES']) assert(out.issues.some(i => i.code === code));
  assert(out.mapping.find(m => m.sourcePath === '/materials/transitions/0').loss);
  const curve = fixture(); curve.materials.speeds[0].curve_speed = { speed_points: [1, 2] }; assert(error(inspect(curve), 'UNSUPPORTED_SPEED_CURVE'));
  const reverse = fixture(); reverse.tracks[0].segments[0].reverse = true; assert(error(inspect(reverse), 'UNSUPPORTED_REVERSE'));
  const order = fixture(); order.tracks[1].segments[0].render_index = -1; assert(error(inspect(order), 'UNSUPPORTED_RENDER_ORDER'));
});

test('path strings remain inert and remote protocols are not imported', () => {
  const input = fixture(); input.materials.videos[0].path = '../../elsewhere/clip.mp4';
  const out = inspect(input); assert.equal(out.materials[0].path, '../../elsewhere/clip.mp4');
  assert.equal(out.canImport, true, 'filesystem authorization belongs to the service');
  for (const path of ['https://example.invalid/clip.mp4', 'file:///tmp/a.mp4', 'asset://cloud/7']) {
    input.materials.videos[0].path = path; assert(error(inspect(input), 'REMOTE_MATERIAL'));
  }
  input.materials.videos[0].path = 'C:\\media\\clip.mp4'; assert.equal(inspect(input).materials[0].path, 'C:\\media\\clip.mp4');
});

test('converter requires copied probed identity and exact source range without trusting draft media metadata', () => {
  const out = inspect(fixture()), source = media();
  source.delete('audio-source'); assert.throws(() => convert(out, source), e => e instanceof JianyingDraftError && e.code === 'UNRESOLVED_MATERIAL');
  const short = media(); short.get('video-source').duration = 4; assert.throws(() => convert(out, short), { code: 'SOURCE_RANGE_OUTSIDE_MEDIA' });
  const wrong = media(); wrong.get('video-source').type = 'audio'; assert.throws(() => convert(out, wrong), { code: 'UNRESOLVED_MATERIAL' });
  assert.throws(() => convert(inspect('opaque')), { code: 'DRAFT_NOT_IMPORTABLE' });
  const object = Object.fromEntries(media()); assert.equal(convert(out, object).media.length, 3);
});

test('microsecond boundaries retain timing to less than one 48kHz sample and target frame without snapping', () => {
  const input = fixture(); const s = input.tracks[0].segments[0];
  s.speed = 1.25; input.materials.speeds[0].speed = 1.25;
  s.target_timerange = range(33333, 777777); s.source_timerange = range(1234567, 972221);
  const out = inspect(input); assert.equal(out.canImport, true, JSON.stringify(out.issues)); const p = convert(out), c = p.clips[0];
  assert(Math.abs(c.start - 33333 / 1e6) < 1 / 48000);
  assert(Math.abs((c.duration * c.speed - 972221 / 1e6)) <= .000002001);
  assert(Math.abs(c.sourceStart - 1.234567) < 1e-12);
  assert.notEqual(c.start, 1 / 30);
});

test('pinned public producer template establishes a real readable empty schema; not native app interoperability', async () => {
  const path = new URL('../artifacts/v11-20261022/schema/upstream/pyJianYingDraft__assets__draft_content_template.json', import.meta.url);
  const template = JSON.parse(await readFile(path, 'utf8')), out = inspect(template);
  assert.equal(out.profile, JIANYING_DRAFT_PROFILE);
  assert.equal(out.canImport, true, JSON.stringify(out.issues));
  assert.equal(out.sourceVersion.app, '5.9.0');
  assert.equal(out.clips.length, 0); assert.equal(out.materials.length, 0);
  assert(out.mapping.some(m => m.sourcePath === '/config/video_mute' && m.sourceValue === false));
});

test('all hard resource capacities are reported rather than silently shortened', () => {
  const tooManyMedia = fixture();
  for (let i = 0; i < 198; i++) tooManyMedia.materials.videos.push({ id: `more-media-${i}`, type: 'photo', path: `media/${i}.png` });
  assert(error(inspect(tooManyMedia), 'MATERIAL_CAPACITY'));
  const tooManyClips = fixture(), s = tooManyClips.tracks[2].segments[0];
  tooManyClips.tracks[2].segments = Array.from({ length: 65 }, (_, i) => ({ ...structuredClone(s), id: `audio-segment-${i}`, render_index: 2 }));
  assert(error(inspect(tooManyClips), 'CLIP_CAPACITY'));
  const tooManyTexts = fixture(), t = tooManyTexts.tracks[3].segments[0];
  tooManyTexts.tracks[3].segments = Array.from({ length: 121 }, (_, i) => ({ ...structuredClone(t), id: `text-segment-${i}`, render_index: 3 }));
  assert(error(inspect(tooManyTexts), 'SUBTITLE_CAPACITY'));
  const huge = fixture(); huge.extra = '汉'.repeat(700000);
  assert(error(inspect(huge), 'DOCUMENT_TOO_LARGE'));
  assert(error(inspect(JSON.stringify(huge)), 'DOCUMENT_TOO_LARGE'));
  const manyUnknowns = fixture(); manyUnknowns.unknown = Object.fromEntries(Array.from({ length: 4010 }, (_, i) => [`leaf-${i}`, i]));
  const out = inspect(manyUnknowns); assert(error(out, 'REPORT_CAPACITY')); assert.equal(out.canImport, false);
});

test('malformed nested known fields do not turn into guessed defaults', () => {
  const variants = [
    ['INVALID_TRANSFORM', s => s.clip.transform = 4], ['INVALID_TRANSFORM', s => s.clip.scale = 'large'],
    ['INVALID_TRANSFORM', s => s.clip.flip = []], ['INVALID_TRANSFORM', s => s.uniform_scale = false],
    ['INVALID_BOOLEAN_FIELD', s => s.reverse = 'false'], ['INVALID_BOOLEAN_FIELD', s => s.visible = 1],
    ['INVALID_BOOLEAN_FIELD', s => s.is_tone_modify = 'no'],
  ];
  for (const [code, change] of variants) { const input = fixture(); change(input.tracks[0].segments[0]); const out = inspect(input); assert(error(out, code), JSON.stringify(out.issues)); assert.equal(out.canImport, false); }
  const unknownApp = fixture(); unknownApp.platform.app_version = '99.0.0';
  assert(inspect(unknownApp).issues.some(i => i.code === 'APPLICATION_VERSION_UNVERIFIED'));
  const badTags = fixture(); badTags.platform.app_version = { text: 'not displayable' }; badTags.new_version = ['not displayable'];
  const out = inspect(badTags); assert(error(out, 'INVALID_VERSION_METADATA')); assert.equal(out.sourceVersion.app, null); assert.equal(out.sourceVersion.newVersion, null);
  const badVersion = fixture(); badVersion.version = { arbitrary: 'not displayable' }; assert.equal(inspect(badVersion).sourceVersion.draft, null);
});

test('source-path expansion is bounded before retaining report rows', () => {
  const input = fixture(); input['long-key-'.repeat(500)] = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`leaf-${i}`, i]));
  assert(Buffer.byteLength(JSON.stringify(input)) < JIANYING_DRAFT_LIMITS.bytes);
  const out = inspect(input);
  assert.equal(out.canImport, false);
  assert(error(out, 'REPORT_CAPACITY'));
  assert(out.issues.length < 4000, 'byte capacity must be reached before issue-count capacity');
  assert(Buffer.byteLength(JSON.stringify({ issues: out.issues, mapping: out.mapping })) <= JIANYING_DRAFT_LIMITS.reportBytes + 1024);
});
