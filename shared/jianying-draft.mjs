// Readable legacy JSON only. Field evidence and the tested compatibility boundary
// live in artifacts/v11-20261022/schema/FORMAT.md. This module never opens files.
export const JIANYING_DRAFT_PROFILE = 'jianying-json-360000';
export const JIANYING_DRAFT_LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, reportBytes: 8 * 1024 * 1024, nodes: 100000, depth: 48, tracks: 64, materials: 200, clips: 64, subtitles: 120, characters: 30000 });
export class JianyingDraftError extends Error {
  constructor(code, message, details) { super(message); this.name = 'JianyingDraftError'; this.code = code; this.details = details; }
}
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const ptr = key => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const empty = value => value === null || value === '' || (Array.isArray(value) && !value.length) || (plain(value) && !Object.keys(value).length);
const at = (o, path) => path.split('/').slice(1).reduce((v, k) => v?.[k.replaceAll('~1', '/').replaceAll('~0', '~')], o);

function boundedDocument(input) {
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).length > JIANYING_DRAFT_LIMITS.bytes) throw new JianyingDraftError('DOCUMENT_TOO_LARGE', '草稿 JSON 超过 2 MiB 的解析上限');
    try { input = JSON.parse(input.replace(/^\uFEFF/, '')); }
    catch { throw new JianyingDraftError('UNREADABLE_DRAFT', '草稿不是可读取的明文 JSON；当前不支持不透明、加密或损坏草稿，不会尝试解密'); }
  }
  let count = 0, characters = 0;
  const seen = new Set();
  function visit(value, depth) {
    if (++count > JIANYING_DRAFT_LIMITS.nodes || depth > JIANYING_DRAFT_LIMITS.depth) throw new JianyingDraftError('DOCUMENT_COMPLEXITY', '草稿结构超出安全解析范围（节点或嵌套深度）');
    if (typeof value === 'string') characters += new TextEncoder().encode(value).length;
    if (characters > JIANYING_DRAFT_LIMITS.bytes) throw new JianyingDraftError('DOCUMENT_TOO_LARGE', '草稿字符串总量超出安全解析范围');
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
    if (!Array.isArray(value) && !plain(value)) throw new JianyingDraftError('INVALID_JSON_VALUE', '草稿包含非 JSON 数据');
    if (seen.has(value)) throw new JianyingDraftError('CYCLIC_DOCUMENT', '草稿包含循环或共享对象引用，必须提供独立 JSON 数据');
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length) throw new JianyingDraftError('INVALID_JSON_VALUE', '草稿包含非 JSON 属性');
    for (const [key, d] of Object.entries(descriptors)) {
      if (Array.isArray(value) && key === 'length') continue;
      if (['__proto__', 'prototype', 'constructor'].includes(key) || !('value' in d)) throw new JianyingDraftError('UNSAFE_JSON_KEY', '草稿包含不支持的对象属性');
      characters += new TextEncoder().encode(key).length; visit(d.value, depth + 1);
    }
  }
  visit(input, 0);
  if (!plain(input)) throw new JianyingDraftError('INVALID_DOCUMENT', '草稿根节点必须是 JSON 对象');
  return input;
}

/** Pure inspection. Every source leaf is mapped, recorded as metadata, or listed
 * as an unimported field. Paths remain inert data for the service to resolve. */
export function inspectJianyingDraft(input, { name } = {}) {
  const out = { profile: null, sourceVersion: { draft: null, app: null, newVersion: null }, name: name || '导入的剪映草稿', width: 1920, height: 1080, fps: 30, materials: [], clips: [], subtitles: [], audioLanes: Array.from({ length: 4 }, () => ({ muted: false, solo: false })), issues: [], mapping: [], canImport: false };
  const used = new Set(); let doc, reportBytes = 0;
  function retain(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
    if (reportBytes + bytes > JIANYING_DRAFT_LIMITS.reportBytes) throw new JianyingDraftError('REPORT_CAPACITY', '草稿字段报告超过 8 MiB 上限，不能生成完整导入记录');
    reportBytes += bytes;
    return value;
  }
  function issue(severity, code, message, sourcePath = '', details) {
    if (out.issues.length >= 4000) throw new JianyingDraftError('REPORT_CAPACITY', '草稿包含过多不支持字段，超过 4000 条报告上限');
    out.issues.push(retain({ severity, code, message, sourcePath, ...(details === undefined ? {} : { details }) }));
  }
  function map(path, targetPath, value, rule = '直接保留', loss) {
    used.add(path);
    out.mapping.push(retain({ sourcePath: path, sourceValue: at(doc, path), targetPath, targetValue: value, rule, ...(loss ? { loss } : {}) }));
    return value;
  }
  function consume(path, rule = '结构标识或来源元数据，仅保留在导入报告', loss) {
    map(path, null, null, rule, loss);
    function children(value, p) { if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { used.add(`${p}/${ptr(k)}`); children(v, `${p}/${ptr(k)}`); } }
    children(at(doc, path), path);
  }
  const number = (value, min, max, path, label, integer = false) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) {
      issue('error', 'VALUE_OUT_OF_RANGE', `${label} 无效或超出微剪可表示范围 ${min}–${max}`, path); return null;
    }
    return value;
  };
  function us(value, path, label, min = 0, max = 900000000) { const n = number(value, min, max, path, label, true); return n === null ? null : n / 1000000; }
  function list(value, max, path, label, optional = false) {
    if (value === undefined && optional) return [];
    if (!Array.isArray(value) || value.length > max) { issue('error', 'COLLECTION_CAPACITY', `${label} 必须为数组且数量不超过 ${max}`, path); return []; }
    return value;
  }
  const idSeen = new Set();
  function sourceId(value, path) {
    if (typeof value !== 'string' || !value || value.length > 200 || value.includes('\0')) { issue('error', 'INVALID_SOURCE_ID', '来源标识必须为非空字符串，长度不超过 200', path); return null; }
    if (idSeen.has(value)) { issue('error', 'DUPLICATE_SOURCE_ID', '来源素材标识重复，不能确定引用身份', path); return null; }
    idSeen.add(value); consume(path); return value;
  }
  function unsupported(path, message, code = 'UNSUPPORTED_FIELD', severity = 'warning') {
    consume(path, '不导入；来源值保留在报告', message); issue(severity, code, message, path);
  }
  try {
    doc = boundedDocument(input);
    const appVersion = doc.last_modified_platform?.app_version ?? doc.platform?.app_version ?? null;
    const newVersion = doc.new_version ?? null;
    out.sourceVersion = { draft: typeof doc.version === 'number' && Number.isFinite(doc.version) ? doc.version : null,
      app: typeof appVersion === 'string' && appVersion.length <= 100 ? appVersion : null,
      newVersion: typeof newVersion === 'string' && newVersion.length <= 100 ? newVersion : null };
    if (appVersion !== null && (typeof appVersion !== 'string' || appVersion.length > 100)) issue('error', 'INVALID_VERSION_METADATA', '应用版本标签无效或过长', '/platform/app_version');
    if (newVersion !== null && (typeof newVersion !== 'string' || newVersion.length > 100)) issue('error', 'INVALID_VERSION_METADATA', '结构版本标签无效或过长', '/new_version');
    if (doc.version !== 360000) { issue('error', 'UNSUPPORTED_VERSION', '当前仅支持已测试的 version=360000 明文草稿结构；该版本或结构尚未验证', '/version'); return out; }
    out.profile = JIANYING_DRAFT_PROFILE;
    consume('/version');
    if (out.sourceVersion.app !== null && out.sourceVersion.app !== '5.9.0') issue('warning', 'APPLICATION_VERSION_UNVERIFIED', '该应用版本未做原生草稿互通验证；仅按 version=360000 的已测试明文结构转换', '/last_modified_platform/app_version');
    for (const key of ['id', 'new_version', 'platform', 'last_modified_platform', 'create_time', 'update_time', 'name']) if (own(doc, key)) consume(`/${key}`);
    if (typeof (name ?? doc.name) === 'string' && (name ?? doc.name).trim() && (name ?? doc.name).length <= 160 && !(name ?? doc.name).includes('\0')) out.name = name ?? doc.name;
    else if (name !== undefined || (doc.name !== undefined && doc.name !== '')) issue('error', 'INVALID_PROJECT_NAME', '工程名称必须是 1–160 字符', '/name');
    if (!plain(doc.canvas_config)) issue('error', 'INVALID_CANVAS', '缺少画布配置', '/canvas_config');
    else {
      for (const [key, min, max] of [['width', 128, 3840], ['height', 128, 2160]]) {
        const n = number(doc.canvas_config[key], min, max, `/canvas_config/${key}`, '画布尺寸', true);
        if (n !== null && n % 2) issue('error', 'INVALID_CANVAS', '画布尺寸必须是偶数整数，不自动缩放', `/canvas_config/${key}`);
        if (n !== null) out[key] = map(`/canvas_config/${key}`, `/${key}`, n);
      }
      if (own(doc.canvas_config, 'ratio')) consume('/canvas_config/ratio', '使用明确的像素宽高；比例标签仅保留在报告');
    }
    const fps = number(doc.fps, 1, 60, '/fps', '帧率'); if (fps !== null) out.fps = map('/fps', '/fps', fps);
    if (doc.duration !== undefined) { us(doc.duration, '/duration', '工程时长'); consume('/duration', '工程时长由片段实际终点推导，来源声明保留在报告'); }
    if (!plain(doc.materials)) issue('error', 'INVALID_MATERIALS', '缺少素材索引', '/materials');
    const materials = plain(doc.materials) ? doc.materials : {}, materialById = new Map(), extraById = new Map();
    let materialCount = 0;
    for (const [category, raw] of Object.entries(materials)) {
      const items = list(raw, 1000, `/materials/${ptr(category)}`, '素材分类');
      for (const [index, material] of items.entries()) {
        const p = `/materials/${ptr(category)}/${index}`;
        if (!plain(material)) { issue('error', 'INVALID_MATERIAL', '素材必须为对象', p); continue; }
        const id = sourceId(material.id, `${p}/id`); if (id === null) continue;
        if (['videos', 'audios', 'images', 'texts'].includes(category)) {
          if (++materialCount > 200) { issue('error', 'MATERIAL_CAPACITY', '素材总数超过 200，不能静默截断', p); continue; }
          const kind = category === 'audios' ? 'audio' : category === 'texts' ? 'text' : material.type === 'photo' || material.type === 'image' || category === 'images' ? 'image' : material.type === 'video' ? 'video' : null;
          if (!kind || (category === 'audios' && !['extract_music', 'music', 'audio', 'record'].includes(material.type)) || (category === 'texts' && !['text', 'subtitle'].includes(material.type))) { issue('error', 'UNSUPPORTED_MATERIAL_TYPE', '该素材类型尚未支持，不能替换为相似类型', `${p}/type`); continue; }
          consume(`${p}/type`);
          const descriptor = { id, kind, type: kind, sourcePath: p, raw: material };
          materialById.set(id, descriptor);
          if (kind !== 'text') {
            if (typeof material.path !== 'string' || !material.path || material.path.length > 4096 || material.path.includes('\0')) { issue('error', 'INVALID_MATERIAL_PATH', '本地素材路径为空或无效', `${p}/path`); continue; }
            if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(material.path) && !/^[A-Za-z]:[\\/]/.test(material.path)) { issue('error', 'REMOTE_MATERIAL', '不自动访问 URL、云端或其他协议素材；请提供本地副本', `${p}/path`); continue; }
            descriptor.path = map(`${p}/path`, `/materials/${out.materials.length}/path`, material.path, '保留来源路径；必须由本地服务授权解析、复制并重新探测');
            descriptor.name = typeof (material.material_name ?? material.name) === 'string' ? material.material_name ?? material.name : material.path.split(/[\\/]/).at(-1);
            for (const key of ['material_name', 'name']) if (own(material, key)) consume(`${p}/${key}`);
            if (material.duration !== undefined) descriptor.duration = map(`${p}/duration`, `/materials/${out.materials.length}/duration`, us(material.duration, `${p}/duration`, '源素材时长', 0, Number.MAX_SAFE_INTEGER), '整数微秒 ÷ 1,000,000；实际素材时长仍需重新探测');
            for (const key of ['width', 'height']) if (material[key] !== undefined) descriptor[key] = map(`${p}/${key}`, `/materials/${out.materials.length}/${key}`, number(material[key], 1, 32768, `${p}/${key}`, '源素材尺寸', true), '来源声明；实际尺寸仍需重新探测');
            if (material.crop !== undefined) {
              const full = { upper_left_x: 0, upper_left_y: 0, upper_right_x: 1, upper_right_y: 0, lower_left_x: 0, lower_left_y: 1, lower_right_x: 1, lower_right_y: 1 };
              if (plain(material.crop) && Object.keys(material.crop).length === 8 && Object.entries(full).every(([k, v]) => material.crop[k] === v)) consume(`${p}/crop`, '完整源画面，无额外视觉裁切');
              else unsupported(`${p}/crop`, '源素材的视觉裁切尚未映射，将保留完整源画面', 'UNSUPPORTED_VISUAL_CROP');
            }
            const { raw: unused, ...publicDescriptor } = descriptor; out.materials.push(publicDescriptor);
          }
        } else extraById.set(id, { category, raw: material, sourcePath: p });
      }
    }
    const tracks = list(doc.tracks, JIANYING_DRAFT_LIMITS.tracks, '/tracks', '轨道');
    const lanes = { video: 0, audio: 0 }; let subtitleChars = 0; const segmentIds = new Set();
    // The legacy generator exports bottom-to-top tracks, and increasing segment
    // render_index. A contradictory ordering is rejected rather than guessed.
    let lastRenderIndex = -Infinity;
    for (const [trackIndex, track] of tracks.entries()) {
      const tp = `/tracks/${trackIndex}`;
      if (!plain(track)) { issue('error', 'INVALID_TRACK', '轨道必须为对象', tp); continue; }
      const segments = list(track.segments, 200, `${tp}/segments`, '轨道片段');
      for (const k of ['id', 'name', 'is_default_name']) if (own(track, k)) consume(`${tp}/${k}`);
      if (own(track, 'flag')) { if (track.flag !== 0) unsupported(`${tp}/flag`, '非默认轨道标记尚未映射', 'UNSUPPORTED_TRACK_FLAG'); else consume(`${tp}/flag`); }
      if (!['video', 'audio', 'text'].includes(track.type)) { unsupported(tp, '不支持的轨道类型；不会将其压平或丢弃后宣称完整兼容', 'UNSUPPORTED_TRACK', segments.length ? 'error' : 'warning'); continue; }
      consume(`${tp}/type`);
      const attribute = track.attribute ?? 0;
      if (!Number.isSafeInteger(attribute) || ![0, 1].includes(attribute)) issue('error', 'UNSUPPORTED_TRACK_ATTRIBUTE', '不支持的轨道属性标记', `${tp}/attribute`);
      if (own(track, 'attribute')) consume(`${tp}/attribute`, 'bit0 为轨道静音；视频映射到片段 muted，音频映射到 audioLanes');
      const lane = track.type === 'text' ? null : segments.length ? lanes[track.type]++ : null;
      if (lane !== null && lane >= 4) issue('error', 'TRACK_CAPACITY', `${track.type === 'video' ? '画面' : '音频'}轨道超过微剪当前 4 层上限；不静默压平`, tp);
      if (track.type === 'audio' && lane < 4 && lane !== null) out.audioLanes[lane].muted = attribute === 1;
      if (track.type === 'text' && attribute === 1 && segments.length) issue('error', 'UNSUPPORTED_TEXT_TRACK_ATTRIBUTE', '隐藏/静音的文字轨道不能映射为可见字幕', `${tp}/attribute`);
      const videoIntervals = [];
      for (const [segmentIndex, segment] of segments.entries()) {
        const p = `${tp}/segments/${segmentIndex}`;
        if (!plain(segment)) { issue('error', 'INVALID_SEGMENT', '片段必须为对象', p); continue; }
        if (typeof segment.id !== 'string' || !segment.id || segmentIds.has(segment.id)) { issue('error', 'DUPLICATE_SEGMENT_ID', '片段来源标识为空或重复', `${p}/id`); continue; }
        segmentIds.add(segment.id); consume(`${p}/id`);
        const neutral = { enable_adjust: true, enable_color_correct_adjust: false, enable_color_curves: true, enable_color_match_adjust: false, enable_color_wheels: true, enable_lut: true, enable_smart_color_adjust: false, last_nonzero_volume: 1, track_attribute: 0 };
        for (const [key, value] of Object.entries(neutral)) if (own(segment, key) && segment[key] === value) consume(`${p}/${key}`, '已识别的中性能力开关或编辑器状态；具体效果以附加素材报告为准');
        const material = materialById.get(segment.material_id);
        if (!material) { issue('error', 'MISSING_MATERIAL_REFERENCE', '片段引用的素材不在草稿索引中', `${p}/material_id`); continue; }
        consume(`${p}/material_id`);
        if ((track.type === 'video' && !['video', 'image'].includes(material.kind)) || (track.type === 'audio' && material.kind !== 'audio') || (track.type === 'text' && material.kind !== 'text')) { issue('error', 'MATERIAL_TRACK_MISMATCH', '素材类型与来源轨道不一致', `${p}/material_id`); continue; }
        if (!plain(segment.target_timerange)) { issue('error', 'INVALID_TIME_RANGE', '缺少片段时间线区间', `${p}/target_timerange`); continue; }
        const index = track.type === 'text' ? out.subtitles.length : out.clips.length, target = `/${track.type === 'text' ? 'subtitles' : 'clips'}/${index}`;
        const start = map(`${p}/target_timerange/start`, `${target}/start`, us(segment.target_timerange.start, `${p}/target_timerange/start`, '时间线入点'), '整数微秒 ÷ 1,000,000；不按帧取整');
        const duration = map(`${p}/target_timerange/duration`, `${target}/duration`, us(segment.target_timerange.duration, `${p}/target_timerange/duration`, '片段时长', 40000), '整数微秒 ÷ 1,000,000；不按帧取整');
        if (start === null || duration === null) continue;
        if (start + duration > 900 + 1e-9) issue('error', 'TIMELINE_CAPACITY', '工程最长支持 900 秒；不截短片段', p);
        for (const k of ['common_keyframes', 'keyframe_refs']) if (own(segment, k)) { if (Array.isArray(segment[k]) && !segment[k].length) consume(`${p}/${k}`); else unsupported(`${p}/${k}`, '关键帧暂不导入；将使用基础静态属性', 'UNSUPPORTED_KEYFRAMES'); }
        if (own(segment, 'reverse') && typeof segment.reverse !== 'boolean') issue('error', 'INVALID_BOOLEAN_FIELD', 'reverse 必须为布尔值', `${p}/reverse`);
        if (segment.reverse === true) unsupported(`${p}/reverse`, '反向播放尚未支持；不能保证时间映射', 'UNSUPPORTED_REVERSE', 'error');
        else if (own(segment, 'reverse')) consume(`${p}/reverse`);
        if (own(segment, 'visible') && typeof segment.visible !== 'boolean') issue('error', 'INVALID_BOOLEAN_FIELD', 'visible 必须为布尔值', `${p}/visible`);
        if (segment.visible === false) unsupported(`${p}/visible`, '隐藏画面/文字片段尚不支持导入', 'UNSUPPORTED_VISIBILITY', 'error');
        else if (own(segment, 'visible')) consume(`${p}/visible`);
        if (segment.track_render_index !== undefined && segment.track_render_index !== 0) unsupported(`${p}/track_render_index`, '动态或跨轨渲染层级尚不支持', 'UNSUPPORTED_RENDER_ORDER', 'error');
        else if (own(segment, 'track_render_index')) consume(`${p}/track_render_index`);
        if (segment.render_index !== undefined) {
          if (!Number.isSafeInteger(segment.render_index)) issue('error', 'INVALID_RENDER_ORDER', '渲染层级必须为整数', `${p}/render_index`);
          else if (segment.render_index < lastRenderIndex) issue('error', 'UNSUPPORTED_RENDER_ORDER', 'render_index 与来源轨道顺序矛盾，不能推断层级', `${p}/render_index`);
          else lastRenderIndex = segment.render_index;
          consume(`${p}/render_index`, '来源轨道按数组顺序从底层向上，render_index 必须不递减');
        }
        let speed = segment.speed ?? 1, fadeIn = 0, fadeOut = 0;
        if (own(segment, 'speed')) number(segment.speed, .25, 4, `${p}/speed`, '恒定速度');
        const refs = list(segment.extra_material_refs, 200, `${p}/extra_material_refs`, '附加素材引用', true); const refCategories = new Set();
        for (const [ri, ref] of refs.entries()) {
          const rp = `${p}/extra_material_refs/${ri}`, extra = extraById.get(ref);
          if (!extra) { unsupported(rp, '附加素材引用无法解析，将不导入该效果', 'UNKNOWN_EXTRA_MATERIAL'); continue; }
          if (refCategories.has(extra.category)) { unsupported(rp, '同类附加效果重复引用，不能确定应用次序', 'DUPLICATE_EXTRA_MATERIAL', 'error'); continue; }
          refCategories.add(extra.category); consume(rp);
          if (extra.category === 'speeds') {
            const q = extra.sourcePath;
            if (!empty(extra.raw.curve_speed)) unsupported(`${q}/curve_speed`, '曲线/分段变速暂不支持导入，时间线不能按恒定速度解释', 'UNSUPPORTED_SPEED_CURVE', 'error');
            else if (own(extra.raw, 'curve_speed')) consume(`${q}/curve_speed`);
            if (segment.speed !== undefined && extra.raw.speed !== segment.speed) issue('error', 'CONFLICTING_SPEED', '片段速度与附加速度素材不一致', `${q}/speed`);
            speed = extra.raw.speed;
            consume(`${q}/speed`, '恒定速度与 segment.speed 必须一致');
            if (own(extra.raw, 'type')) consume(`${q}/type`);
          } else if (extra.category === 'audio_fades') {
            const q = extra.sourcePath;
            if (extra.raw.fade_type !== 0) unsupported(`${q}/fade_type`, '仅支持 fade_type=0 的线性音量淡化', 'UNSUPPORTED_FADE', 'error');
            else consume(`${q}/fade_type`);
            const fadeLoss = '保留淡化时长，使用微剪线性幅度曲线；剪映原始淡化算法尚未做原生对照';
            fadeIn = map(`${q}/fade_in_duration`, `${target}/fadeIn`, us(extra.raw.fade_in_duration, `${q}/fade_in_duration`, '音频淡入'), '整数微秒转换为秒；映射为微剪线性淡入', fadeLoss);
            fadeOut = map(`${q}/fade_out_duration`, `${target}/fadeOut`, us(extra.raw.fade_out_duration, `${q}/fade_out_duration`, '音频淡出'), '整数微秒转换为秒；映射为微剪线性淡出', fadeLoss);
            if (fadeIn > 0 || fadeOut > 0) issue('warning', 'FADE_LAW_APPROXIMATED', fadeLoss, q);
            if (fadeIn + fadeOut > duration + 1e-9) issue('error', 'INVALID_FADE_RANGE', '音频淡入淡出之和超过片段时长', q);
            if (own(extra.raw, 'type')) consume(`${q}/type`);
          } else unsupported(extra.sourcePath, `附加 ${extra.category} 效果暂不导入`, 'UNSUPPORTED_EFFECT');
        }
        if (track.type === 'text') {
          let content = material.raw.content;
          if (typeof content !== 'string' || content.length > 262144) { issue('error', 'INVALID_TEXT_CONTENT', '字幕 content 必须为不超过 256 KiB 的 JSON 字符串', `${material.sourcePath}/content`); continue; }
          try { content = JSON.parse(content); } catch { issue('error', 'INVALID_TEXT_CONTENT', '字幕 content 不是合法 JSON', `${material.sourcePath}/content`); continue; }
          if (!plain(content) || typeof content.text !== 'string' || !content.text.trim() || content.text.length > 2000 || content.text.includes('\0')) { issue('error', 'INVALID_SUBTITLE', '字幕文字为空、超长或无效', `${material.sourcePath}/content`); continue; }
          subtitleChars += content.text.length;
          if (out.subtitles.length >= 120 || subtitleChars > 30000) { issue('error', 'SUBTITLE_CAPACITY', '字幕超过 120 条或总计 30000 字符，不截断', p); continue; }
          map(`${material.sourcePath}/content`, `${target}/text`, content.text, '解析 content.text 为可编辑纯文本；不执行文字内容', '字号、字体、样式、位置、透明度及动画统一替换为微剪底部白字默认样式');
          issue('warning', 'TEXT_STYLE_REPLACED', '字幕保留可编辑纯文本和时间；字体、样式及自由位置替换为微剪默认底部字幕', `${material.sourcePath}/content`);
          if (own(segment, 'clip')) consume(`${p}/clip`, '字幕使用固定底部位置；来源变换仅存入报告', '未保留字幕自由位置或缩放');
          if (own(segment, 'uniform_scale')) consume(`${p}/uniform_scale`, '字幕使用默认样式');
          out.subtitles.push({ id: `jy-text-${trackIndex}-${segmentIndex}`, sourcePath: p, sourceMaterialId: material.id, text: content.text, start, duration, fontSize: 48, color: '#FFFFFF', position: 'bottom', outlineWidth: 2, outlineColor: '#000000' });
          continue;
        }
        if (out.clips.length >= 64) { issue('error', 'CLIP_CAPACITY', '片段总数超过 64，不截断', p); continue; }
        const parsedSpeed = number(speed, .25, 4, `${p}/speed`, '恒定速度');
        if (own(segment, 'speed')) map(`${p}/speed`, `${target}/speed`, parsedSpeed, '恒定速度倍率，限制取自微剪模型；超出时拒绝，不裁剪');
        let sourceStart = 0;
        if (material.kind === 'image') {
          if (segment.source_timerange !== undefined && segment.source_timerange !== null && (!plain(segment.source_timerange) || segment.source_timerange.start !== 0)) issue('error', 'INVALID_IMAGE_SOURCE_RANGE', '图片素材入点必须为 0', `${p}/source_timerange`);
          if (own(segment, 'source_timerange')) consume(`${p}/source_timerange`, '静态图片的源入点固定为 0；显示时长取时间线区间');
          if (parsedSpeed !== 1) issue('error', 'UNSUPPORTED_IMAGE_SPEED', '静态图片不导入变速属性', `${p}/speed`);
        } else if (!plain(segment.source_timerange)) issue('error', 'INVALID_TIME_RANGE', '音视频必须提供明确源入点及源时长', `${p}/source_timerange`);
        else {
          sourceStart = map(`${p}/source_timerange/start`, `${target}/sourceStart`, us(segment.source_timerange.start, `${p}/source_timerange/start`, '源入点', 0, Number.MAX_SAFE_INTEGER), '整数微秒 ÷ 1,000,000；不按帧取整');
          const sourceDuration = us(segment.source_timerange.duration, `${p}/source_timerange/duration`, '源时长', 1, Number.MAX_SAFE_INTEGER);
          map(`${p}/source_timerange/duration`, `${target}/duration*speed`, sourceDuration, '源时长应等于时间线时长 × 恒定速度，允许来源微秒舍入误差 2 µs');
          if (sourceDuration !== null && parsedSpeed !== null && Math.abs(sourceDuration - duration * parsedSpeed) > .000002001) issue('error', 'INCONSISTENT_TIME_RANGE', '源区间、目标区间与恒定速度不一致', p);
          if (sourceStart !== null && sourceDuration !== null && typeof material.duration === 'number' && sourceStart + sourceDuration > material.duration + .000002001) issue('error', 'SOURCE_RANGE_OUTSIDE_MEDIA', '源出点超过草稿声明素材时长', `${p}/source_timerange`);
        }
        const volume = number(segment.volume ?? 1, 0, 2, `${p}/volume`, '基础音量');
        if (own(segment, 'volume')) map(`${p}/volume`, `${target}/volume`, volume, '线性倍率直接保留；超过微剪 2 倍上限时拒绝');
        if (own(segment, 'is_tone_modify')) {
          if (typeof segment.is_tone_modify !== 'boolean') issue('error', 'INVALID_BOOLEAN_FIELD', 'is_tone_modify 必须为布尔值', `${p}/is_tone_modify`);
          else if (segment.is_tone_modify !== false && parsedSpeed !== 1) unsupported(`${p}/is_tone_modify`, '微剪恒定变速保持音高，不能复现变调播放', 'UNSUPPORTED_PITCH_MODE', 'error');
          else consume(`${p}/is_tone_modify`, '微剪变速保持音高；1 倍速度时该项不影响声音');
        }
        let transform = { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1, flipX: false, flipY: false };
        if (segment.clip !== undefined && segment.clip !== null) {
          const visual = segment.clip;
          if (!plain(visual)) issue('error', 'INVALID_TRANSFORM', 'clip 变换必须为对象', `${p}/clip`);
          else if (track.type === 'video') {
            for (const key of ['scale', 'transform', 'flip']) if (own(visual, key) && !plain(visual[key])) issue('error', 'INVALID_TRANSFORM', `clip.${key} 必须为对象`, `${p}/clip/${key}`);
            const sx = visual.scale?.x ?? 1, sy = visual.scale?.y ?? 1;
            if (sx !== sy) unsupported(`${p}/clip/scale`, '微剪仅支持等比缩放，无法保持非等比画面比例', 'NON_UNIFORM_SCALE', 'error');
            else { transform.scale = number(sx, .1, 4, `${p}/clip/scale/x`, '等比缩放'); if (own(visual, 'scale')) consume(`${p}/clip/scale`, 'scale.x=scale.y 时直接映射等比缩放'); }
            const x = number(visual.transform?.x ?? 0, -4, 4, `${p}/clip/transform/x`, '水平归一化位置'), y = number(visual.transform?.y ?? 0, -4, 4, `${p}/clip/transform/y`, '垂直归一化位置');
            transform.x = x === null ? null : x * out.width / 2; transform.y = y === null ? null : -y * out.height / 2;
            if (visual.transform && own(visual.transform, 'x')) map(`${p}/clip/transform/x`, `${target}/transform/x`, transform.x, '剪映半画布宽度单位 × width/2 → 像素');
            if (visual.transform && own(visual.transform, 'y')) map(`${p}/clip/transform/y`, `${target}/transform/y`, transform.y, '剪映向上为正；× -height/2 → 微剪向下为正的像素');
            for (const [source, targetKey, min, max] of [['rotation', 'rotation', -360, 360], ['alpha', 'opacity', 0, 1]]) {
              transform[targetKey] = number(visual[source] ?? (source === 'alpha' ? 1 : 0), min, max, `${p}/clip/${source}`, '画面变换');
              if (own(visual, source)) map(`${p}/clip/${source}`, `${target}/transform/${targetKey}`, transform[targetKey], source === 'rotation' ? '顺时针角度直接保留' : '不透明度直接保留');
            }
            for (const [source, targetKey] of [['horizontal', 'flipX'], ['vertical', 'flipY']]) {
              const value = visual.flip?.[source] ?? false;
              if (typeof value !== 'boolean') issue('error', 'INVALID_TRANSFORM', '翻转属性必须为布尔值', `${p}/clip/flip/${source}`);
              transform[targetKey] = value;
              if (visual.flip && own(visual.flip, source)) map(`${p}/clip/flip/${source}`, `${target}/transform/${targetKey}`, value);
            }
          } else consume(`${p}/clip`, '音频素材无画面变换；来源保留在报告');
        }
        if (own(segment, 'uniform_scale')) {
          if (!plain(segment.uniform_scale) || (own(segment.uniform_scale, 'on') && typeof segment.uniform_scale.on !== 'boolean')) issue('error', 'INVALID_TRANSFORM', 'uniform_scale 必须为有效对象，其 on 字段必须为布尔值', `${p}/uniform_scale`);
          else if (segment.uniform_scale?.value !== undefined && segment.uniform_scale.value !== 1) unsupported(`${p}/uniform_scale`, '非默认 uniform_scale.value 尚未支持', 'UNSUPPORTED_UNIFORM_SCALE', 'error');
          else consume(`${p}/uniform_scale`, '等比状态由 clip.scale 映射；状态控件值保留在报告');
        }
        const clip = { id: `jy-clip-${trackIndex}-${segmentIndex}`, sourcePath: p, sourceMaterialId: material.id, track: track.type, layer: lane, start, duration, sourceStart, speed: parsedSpeed, volume, muted: track.type === 'video' && attribute === 1, transform, fadeIn, fadeOut, fadeInCurve: 'linear', fadeOutCurve: 'linear' };
        if (track.type === 'video') videoIntervals.push(clip);
        out.clips.push(clip);
      }
      videoIntervals.sort((a, b) => a.start - b.start);
      for (let i = 1; i < videoIntervals.length; i++) if (videoIntervals[i].start < videoIntervals[i - 1].start + videoIntervals[i - 1].duration - .000001) issue('error', 'OVERLAPPING_VIDEO_TRACK', '同一来源画面轨道包含重叠片段，不能改变层级消除重叠', tp);
    }
    // Fields with no editor meaning are still retained in the source manifest.
    for (const key of ['color_space', 'source', 'cover', 'retouch_cover', 'static_cover_image_path', 'extra_info', 'create_time', 'update_time']) if (own(doc, key)) consume(`/${key}`);
    for (const key of ['render_index_track_mode_on', 'free_render_index_mode_on']) if (own(doc, key)) { if (doc[key] !== false) unsupported(`/${key}`, '自由或独立轨道渲染顺序尚未支持', 'UNSUPPORTED_RENDER_ORDER', 'error'); else consume(`/${key}`); }
    // Keep the complete source values of every other field, including empty
    // fields, so unsupported data cannot disappear behind a successful import.
    function unconsumed(value, path) {
      if (used.has(path)) return;
      if (value && typeof value === 'object' && Object.keys(value).length) {
        for (const [k, v] of Object.entries(value)) unconsumed(v, `${path}/${ptr(k)}`);
      } else if (path) {
        map(path, null, null, '未映射字段，来源值保留在报告', empty(value) ? undefined : '未导入该字段');
        if (!empty(value)) issue('warning', 'UNSUPPORTED_FIELD', '该来源字段没有微剪映射；其值仅保留在报告', path);
      }
    }
    unconsumed(doc, '');
    out.canImport = !out.issues.some(i => i.severity === 'error');
  } catch (error) {
    if (!(error instanceof JianyingDraftError)) throw error;
    out.issues.push({ severity: 'error', code: error.code, message: error.message, sourcePath: '' });
    out.canImport = false;
  }
  return out;
}

/** Build only from trusted, freshly probed local media records supplied by the
 * importing service. Source paths and arbitrary fields never enter a project. */
export function convertJianyingDraft(inspected, { id, name = inspected?.name, mediaBySourceId, createdAt = new Date().toISOString(), now = createdAt } = {}) {
  if (!inspected?.canImport || inspected.profile !== JIANYING_DRAFT_PROFILE) throw new JianyingDraftError('DRAFT_NOT_IMPORTABLE', '草稿仍有阻止导入的问题', inspected?.issues);
  if (!safeId(id)) throw new JianyingDraftError('INVALID_PROJECT_ID', '新工程 ID 格式无效');
  if (typeof name !== 'string' || !name.trim() || name.length > 160 || name.includes('\0')) throw new JianyingDraftError('INVALID_PROJECT_NAME', '新工程名称无效');
  if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(now))) throw new JianyingDraftError('INVALID_PROJECT_TIME', '工程创建时间无效');
  const lookup = key => mediaBySourceId instanceof Map ? mediaBySourceId.get(key) : mediaBySourceId && own(mediaBySourceId, key) ? mediaBySourceId[key] : undefined;
  const media = [], byId = new Map();
  for (const source of inspected.materials) {
    const item = lookup(source.id);
    if (!item || !safeId(item.id) || item.type !== source.kind || typeof item.duration !== 'number' || !Number.isFinite(item.duration) || item.duration < 0) throw new JianyingDraftError('UNRESOLVED_MATERIAL', `素材 ${source.name ?? source.id} 尚未完成复制、探测或类型不一致`, { sourceId: source.id });
    if (!byId.has(item.id)) { byId.set(item.id, item); media.push(item); }
  }
  const clips = inspected.clips.map(source => {
    const resolved = lookup(source.sourceMaterialId);
    if (!resolved || (source.track === 'audio' && !resolved.hasAudio)) throw new JianyingDraftError('UNRESOLVED_MATERIAL', '片段引用的已复制素材缺少所需媒体流', { sourceId: source.sourceMaterialId });
    if (resolved.type !== 'image' && source.sourceStart + source.duration * source.speed > resolved.duration + .000002001) throw new JianyingDraftError('SOURCE_RANGE_OUTSIDE_MEDIA', '草稿源出点超出重新探测的本地素材时长', { sourceId: source.sourceMaterialId, sourcePath: source.sourcePath });
    const { sourcePath, sourceMaterialId, ...fields } = source;
    return { ...fields, mediaId: resolved.id };
  });
  const subtitles = inspected.subtitles.map(({ sourcePath, sourceMaterialId, ...fields }) => fields);
  return { id, version: 1, name, width: inspected.width, height: inspected.height, fps: inspected.fps, media, clips, subtitles, audioLanes: inspected.audioLanes.map(lane => ({ ...lane })), createdAt: new Date(createdAt).toISOString(), updatedAt: new Date(now).toISOString() };
}
