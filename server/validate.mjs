import { HttpError, publicMedia } from './store.mjs';
import { ANIMATION_TYPES } from '../shared/effects.mjs';
import { AUDIO_FADE_CURVES, MAX_AUDIO_GAIN, AUDIO_LANE_COUNT, MAX_AUDIO_GAIN_KEYS, AUDIO_EFFECT_LIMITS, clipAudioEffects } from '../shared/audio.mjs';
import { EASING_TYPES } from '../shared/easing.mjs';
import { VIDEO_LAYER_COUNT, clipLayer, clipTransform, clipAdjustments, clipAnimation, clipMask, clipTransitionOut, inspectTransitions, clipTiming, MAX_TRANSFORM_KEYS, MAX_DECODE_INPUTS, MAX_SPEED_CURVE_POINTS, decodeInputCount, assertSpeedCurveSupported } from '../shared/model.mjs';

const fail = message => { throw new HttpError(400, message); };
export function safeId(value, label = 'ID') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) fail(`${label} 格式无效`);
  return value;
}
function number(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${label} 必须在 ${min}–${max} 之间`);
  return value;
}
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) fail(`${label} 无效或过长`);
  return value;
}
function array(value, max, label) {
  if (!Array.isArray(value) || value.length > max) fail(`${label} 数量超出限制（最多 ${max}）`);
  return value;
}
function object(value, label) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 信息无效`);
  return value;
}
function boolean(value, label) {
  if (typeof value !== 'boolean') fail(`${label} 必须为布尔值`);
  return value;
}
export function durationOf(project) {
  return Math.max(0, ...project.clips.map(clip => clip.start + clip.duration), ...project.subtitles.map(subtitle => subtitle.start + subtitle.duration));
}
function unique(items, label) {
  if (new Set(items.map(item => item.id)).size !== items.length) fail(`${label} ID 重复`);
}

export function validateProject(input, store, { touch = true } = {}) {
  if (!input || typeof input !== 'object') fail('缺少工程内容');
  if (input.version !== 1) fail('暂时只支持版本 1 的工程');
  const project = {
    id: safeId(input.id, '工程 ID'), version: 1,
    ...(input.importReportId === undefined ? {} : { importReportId: safeId(input.importReportId, '导入报告 ID') }),
    name: text(input.name, 160, '工程名称'),
    width: number(input.width, 128, 3840, '工程宽度'),
    height: number(input.height, 128, 2160, '工程高度'),
    fps: number(input.fps, 1, 60, '帧率'), media: [], clips: [], subtitles: [], audioLanes: [],
    createdAt: typeof input.createdAt === 'string' && Number.isFinite(Date.parse(input.createdAt)) ? new Date(input.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: !touch && typeof input.updatedAt === 'string' && Number.isFinite(Date.parse(input.updatedAt)) ? new Date(input.updatedAt).toISOString() : new Date().toISOString(),
  };
  const lanes = input.audioLanes === undefined ? Array.from({ length: AUDIO_LANE_COUNT }, () => ({})) : array(input.audioLanes, AUDIO_LANE_COUNT, '音频轨道');
  if (lanes.length !== AUDIO_LANE_COUNT) fail(`工程必须包含 ${AUDIO_LANE_COUNT} 条音频轨道设置`);
  project.audioLanes = lanes.map(lane => {
    if (!lane || typeof lane !== 'object' || Array.isArray(lane)) fail('音频轨道设置无效');
    return { muted: boolean(lane.muted === undefined ? false : lane.muted, '音轨静音'), solo: boolean(lane.solo === undefined ? false : lane.solo, '音轨独奏') };
  });
  if (!Number.isInteger(project.width) || project.width % 2 || !Number.isInteger(project.height) || project.height % 2) fail('工程宽高必须为偶数整数');
  for (const item of array(input.media, 200, '素材')) {
    if (!item || typeof item !== 'object') fail('素材信息无效');
    const media = store.media.get(safeId(item.id, '素材 ID'));
    if (!media) fail(`本机未找到素材 ${String(item.name || item.id).slice(0, 160)}，请重新导入`);
    // Caller fields never select a file, URL, or inferred stream type.
    if (item.url !== undefined && item.url !== media.url) fail('素材地址与本机素材记录不一致，请重新导入');
    project.media.push(publicMedia(media));
  }
  unique(project.media, '素材');
  const available = new Map(project.media.map(media => [media.id, media]));
  let decoderInputs = 0, transformKeys = 0, speedCurvePoints = 0, audioGainKeys = 0;
  for (const item of array(input.clips, 64, '片段')) {
    if (!item || typeof item !== 'object') fail('片段信息无效');
    const media = available.get(item.mediaId);
    if (!media) fail('片段引用了未导入的素材');
    if (!['video', 'audio'].includes(item.track)) fail('片段轨道无效');
    if (item.track === 'video' && media.type === 'audio') fail('音频不能放入视频轨道');
    if (item.track === 'audio' && !media.hasAudio) fail('该素材没有音轨');
    object(item.transform, '画面变换');
    object(item.adjustments, '画面调节');
    object(item.animation, '画面动画');
    object(item.mask, '画面蒙版');
    object(item.transitionOut, '画面转场');
    const transform = clipTransform(item);
    const adjustments = clipAdjustments(item);
    const animation = clipAnimation(item);
    const mask = clipMask(item);
    const transition = clipTransitionOut(item);
    const effectsInput = object(item.audioEffects, '音效');
    object(effectsInput.highpass, '高通音效'); object(effectsInput.lowpass, '低通音效'); object(effectsInput.echo, '回声音效');
    const audioEffects = clipAudioEffects(item);
    const fadeInCurve = item.fadeInCurve === undefined ? 'linear' : item.fadeInCurve, fadeOutCurve = item.fadeOutCurve === undefined ? 'linear' : item.fadeOutCurve;
    if (![fadeInCurve, fadeOutCurve].every(type => AUDIO_FADE_CURVES.some(curve => curve.type === type))) fail('音频淡化形状无效');
    if (item.track !== 'video' && item.audioDetached === true) fail('只有视频片段可标记原声已分离');
    if (!['none', 'ellipse', 'rectangle'].includes(mask.type)) fail('蒙版形状无效');
    if (!ANIMATION_TYPES.includes(animation.inType) || !ANIMATION_TYPES.includes(animation.outType)) fail('画面动画类型无效');
    if (!['linear', 'easeInOut', 'easeIn', 'easeOut'].includes(animation.easing)) fail('画面动画缓动无效');
    const clip = {
      id: safeId(item.id, '片段 ID'), mediaId: media.id, track: item.track,
      start: number(item.start, 0, 900, '片段开始时间'),
      sourceStart: number(item.sourceStart, 0, Math.max(media.duration, 900), '素材入点'),
      duration: number(item.duration, .04, 900, '片段时长'),
      speed: number(item.speed ?? 1, .25, 4, '播放速度'),
      volume: number(item.volume === undefined ? 1 : item.volume, 0, MAX_AUDIO_GAIN, '音量'),
      pan: number(item.pan === undefined ? 0 : item.pan, -1, 1, '声道平衡'),
      audioEffects: {
        highpass: { enabled: boolean(audioEffects.highpass.enabled, '高通开关'), frequency: number(audioEffects.highpass.frequency, AUDIO_EFFECT_LIMITS.frequency.min, AUDIO_EFFECT_LIMITS.frequency.max, '高通频率') },
        lowpass: { enabled: boolean(audioEffects.lowpass.enabled, '低通开关'), frequency: number(audioEffects.lowpass.frequency, AUDIO_EFFECT_LIMITS.frequency.min, AUDIO_EFFECT_LIMITS.frequency.max, '低通频率') },
        echo: { enabled: boolean(audioEffects.echo.enabled, '回声开关'), delay: number(audioEffects.echo.delay, AUDIO_EFFECT_LIMITS.delay.min, AUDIO_EFFECT_LIMITS.delay.max, '回声延迟'), decay: number(audioEffects.echo.decay, AUDIO_EFFECT_LIMITS.decay.min, AUDIO_EFFECT_LIMITS.decay.max, '回声强度') },
      },
      muted: boolean(item.muted === undefined ? false : item.muted, '片段静音'),
      audioDetached: boolean(item.audioDetached === undefined ? false : item.audioDetached, '原声已分离'),
      fadeInCurve, fadeOutCurve,
      layer: number(clipLayer(item), 0, VIDEO_LAYER_COUNT - 1, '画面轨道'),
      transform: {
        scale: number(transform.scale, .1, 4, '画面缩放'),
        x: number(transform.x, -2 * project.width, 2 * project.width, '画面水平位置'),
        y: number(transform.y, -2 * project.height, 2 * project.height, '画面垂直位置'),
        rotation: number(transform.rotation, -360, 360, '画面旋转'),
        opacity: number(transform.opacity, 0, 1, '画面不透明度'),
        flipX: boolean(transform.flipX, '水平翻转'),
        flipY: boolean(transform.flipY, '垂直翻转'),
      },
      adjustments: {
        brightness: number(adjustments.brightness, 0, 2, '亮度'),
        contrast: number(adjustments.contrast, 0, 2, '对比度'),
        saturation: number(adjustments.saturation, 0, 2, '饱和度'),
      },
      fadeIn: number(item.fadeIn ?? 0, 0, item.duration, '音频淡入'),
      fadeOut: number(item.fadeOut ?? 0, 0, item.duration, '音频淡出'),
      animation: {
        in: number(animation.in, 0, item.duration, '画面渐显'),
        out: number(animation.out, 0, item.duration, '画面渐隐'),
        inType: animation.inType, outType: animation.outType, easing: animation.easing,
      },
      mask: {
        type: mask.type,
        x: number(mask.x, -2, 2, '蒙版水平位置'),
        y: number(mask.y, -2, 2, '蒙版垂直位置'),
        width: number(mask.width, .01, 4, '蒙版宽度'),
        height: number(mask.height, .01, 4, '蒙版高度'),
        rotation: number(mask.rotation, -360, 360, '蒙版旋转'),
        feather: number(mask.feather, 0, 200, '蒙版羽化'),
        invert: boolean(mask.invert, '蒙版反转'),
      },
      transitionOut: {
        type: transition.type,
        duration: number(transition.duration, 0, 5, '转场时长'),
        ...(transition.nextClipId === undefined ? {} : { nextClipId: safeId(transition.nextClipId, '转场目标 ID') }),
      },
    };
    clip.speedSegments = [];
    for (const part of array(item.speedSegments ?? [], MAX_DECODE_INPUTS, '分段变速')) {
      object(part, '变速段');
      clip.speedSegments.push({ sourceDuration: number(part.sourceDuration, .000001, 3600, '变速段源时长'), speed: number(part.speed, .25, 4, '变速段速度') });
    }
    if (item.speedCurve !== undefined && item.speedCurve !== null) {
      object(item.speedCurve, '平滑速度曲线');
      const curve = { sourceDuration: number(item.speedCurve.sourceDuration, .000001, 3600, '曲线源时长'), points: [] };
      for (const point of array(item.speedCurve.points, MAX_SPEED_CURVE_POINTS, '速度曲线节点')) {
        object(point, '速度曲线节点');
        const phase = point.phase ?? [0, 1];
        if (!Array.isArray(phase) || phase.length !== 2) fail('速度曲线子区间无效');
        number(phase[0], 0, 1, '曲线子区间起点'); number(phase[1], 0, 1, '曲线子区间终点');
        if (phase[1] <= phase[0]) fail('速度曲线子区间必须递增');
        const parsed = { id: safeId(point.id, '速度节点 ID'), position: number(point.position, 0, 1, '源区间位置'), speed: number(point.speed, .25, 4, '曲线速度'), phase };
        if (curve.points.length && parsed.position - curve.points.at(-1).position < .000001 - 1e-12) fail('速度曲线节点位置必须递增且至少间隔百万分之一源区间');
        curve.points.push(parsed);
      }
      if (curve.points.length < 2 || curve.points[0].position !== 0 || curve.points.at(-1).position !== 1) fail('速度曲线至少包含源区间0和1两个端点');
      unique(curve.points, '速度曲线节点');
      speedCurvePoints += curve.points.length;
      if (speedCurvePoints > MAX_SPEED_CURVE_POINTS) fail(`工程速度曲线节点总数不能超过 ${MAX_SPEED_CURVE_POINTS}`);
      if (media.type === 'image') fail('图片不能应用平滑曲线变速');
      if (clip.speedSegments.length || clip.speed !== 1) fail('平滑曲线变速不能同时使用常规速度或分段变速');
      try { assertSpeedCurveSupported(curve); } catch (error) { fail(error.message); }
      clip.speedCurve = curve;
      if (Math.abs(clipTiming(clip).duration - clip.duration) > .000001) fail('平滑速度曲线积分时长与片段时长不一致');
    }
    decoderInputs += decodeInputCount(clip);
    if (decoderInputs > MAX_DECODE_INPUTS) fail('工程解码输入总数不能超过 64（分段变速每段计一个输入）');
    if (clip.speedSegments.length) {
      if (media.type === 'image') fail('图片不能应用分段变速');
      if (clip.speed !== 1) fail('分段变速片段的常规速度必须为 1');
      if (Math.abs(clipTiming(clip).duration - clip.duration) > .000001) fail('分段变速总时长与片段时长不一致');
    }
    clip.transformKeys = [];
    for (const key of array(item.transformKeys ?? [], MAX_TRANSFORM_KEYS, '变换关键帧')) {
      object(key, '变换关键帧'); object(key.values, '关键帧属性');
      if (!['linear', 'easeInOut', 'easeIn', 'easeOut'].includes(key.easing ?? 'linear')) fail('关键帧缓动无效');
      const phase = key.phase ?? [0, 1];
      if (!Array.isArray(phase) || phase.length !== 2) fail('关键帧缓动区间无效');
      number(phase[0], 0, 1, '关键帧缓动起点'); number(phase[1], 0, 1, '关键帧缓动终点');
      if (phase[1] <= phase[0]) fail('关键帧缓动区间必须递增');
      const values = key.values ?? {};
      const parsed = { id: safeId(key.id, '关键帧 ID'), time: number(key.time, 0, clip.duration, '关键帧时间'), easing: key.easing ?? 'linear', phase,
        values: { scale: number(values.scale, .1, 4, '关键帧缩放'), x: number(values.x, -2 * project.width, 2 * project.width, '关键帧水平位置'),
          y: number(values.y, -2 * project.height, 2 * project.height, '关键帧垂直位置'), rotation: number(values.rotation, -360, 360, '关键帧旋转'), opacity: number(values.opacity, 0, 1, '关键帧不透明度') } };
      if (clip.transformKeys.length && parsed.time - clip.transformKeys.at(-1).time < .000001) fail('关键帧时间必须递增且至少间隔一微秒');
      clip.transformKeys.push(parsed);
    }
    unique(clip.transformKeys, '关键帧');
    transformKeys += clip.transformKeys.length;
    if (transformKeys > MAX_TRANSFORM_KEYS) fail(`工程变换关键帧总数不能超过 ${MAX_TRANSFORM_KEYS}`);
    clip.audioGainKeys = [];
    for (const key of array(item.audioGainKeys === undefined ? [] : item.audioGainKeys, MAX_AUDIO_GAIN_KEYS, '音量关键帧')) {
      if (!key || typeof key !== 'object' || Array.isArray(key)) fail('音量关键帧无效');
      const easing = key.easing === undefined ? 'linear' : key.easing;
      if (!EASING_TYPES.includes(easing)) fail('音量关键帧缓动无效');
      const phase = key.phase === undefined ? [0, 1] : key.phase;
      if (!Array.isArray(phase) || phase.length !== 2) fail('音量关键帧缓动区间无效');
      number(phase[0], 0, 1, '音量缓动起点'); number(phase[1], 0, 1, '音量缓动终点');
      if (phase[1] <= phase[0]) fail('音量关键帧缓动区间必须递增');
      const parsed = { id: safeId(key.id, '音量关键帧 ID'), time: number(key.time, 0, clip.duration, '音量关键帧时间'), gain: number(key.gain, 0, MAX_AUDIO_GAIN, '音量关键帧倍率'), easing, phase };
      if (clip.audioGainKeys.length && parsed.time - clip.audioGainKeys.at(-1).time < .000001) fail('音量关键帧时间必须递增且至少间隔一微秒');
      clip.audioGainKeys.push(parsed);
    }
    unique(clip.audioGainKeys, '音量关键帧');
    audioGainKeys += clip.audioGainKeys.length;
    if (audioGainKeys > MAX_AUDIO_GAIN_KEYS) fail(`工程音量关键帧总数不能超过 ${MAX_AUDIO_GAIN_KEYS}`);
    if (clip.track === 'audio' && clip.transformKeys.length) fail('音频片段不能应用画面关键帧');
    if (!Number.isInteger(clip.layer)) fail('画面轨道必须为整数');
    if (clip.fadeIn + clip.fadeOut > clip.duration + .000001) fail('音频淡入与淡出时长合计不能超过片段时长');
    if (clip.animation.in + clip.animation.out > clip.duration + .000001) fail('画面渐显与渐隐时长合计不能超过片段时长');
    if (clip.track === 'audio' && (clip.mask.type !== 'none' || clip.animation.in > 0 || clip.animation.out > 0)) fail('音频片段不能应用画面动画或蒙版');
    if (media.type !== 'image' && clipTiming(clip).sourceEnd > media.duration + .12) fail(`片段超出了素材“${media.name}”的时长`);
    if (media.type === 'image' && clip.sourceStart !== 0) fail('图片素材入点必须为 0');
    project.clips.push(clip);
  }
  unique(project.clips, '片段');
  const video = project.clips.filter(clip => clip.track === 'video').sort((a, b) => a.layer - b.layer || a.start - b.start);
  for (let i = 1; i < video.length; i++) {
    if (video[i].layer === video[i - 1].layer && video[i].start < video[i - 1].start + video[i - 1].duration - .001) fail('同一画面轨道内的片段不能重叠；请移动到其他叠加轨道或裁剪片段');
  }
  const transitions = inspectTransitions(project);
  if (transitions.invalid.length) fail(transitions.invalid[0].reason);
  let characters = 0;
  for (const item of array(input.subtitles, 120, '字幕')) {
    if (!item || typeof item !== 'object') fail('字幕信息无效');
    const subtitle = {
      id: safeId(item.id, '字幕 ID'), text: text(item.text, 2000, '字幕文字'),
      start: number(item.start, 0, 900, '字幕开始时间'),
      duration: number(item.duration, .04, 900, '字幕时长'),
      fontSize: number(item.fontSize ?? 48, 8, 256, '字幕字号'),
      color: item.color ?? '#FFFFFF', position: item.position ?? 'bottom',
      outlineWidth: number(item.outlineWidth ?? Math.max(1, (item.fontSize ?? 48) / 24), 0, 32, '字幕描边宽度'),
      outlineColor: item.outlineColor ?? '#000000',
    };
    if (!/^#[0-9a-fA-F]{6}$/.test(subtitle.color)) fail('字幕颜色格式必须为 #RRGGBB');
    if (!/^#[0-9a-fA-F]{6}$/.test(subtitle.outlineColor)) fail('字幕描边颜色格式必须为 #RRGGBB');
    if (!['bottom', 'center', 'top'].includes(subtitle.position)) fail('字幕位置无效');
    characters += subtitle.text.length;
    project.subtitles.push(subtitle);
  }
  unique(project.subtitles, '字幕');
  if (characters > 30000) fail('工程字幕总字数不能超过 30000');
  if (durationOf(project) > 900) fail('第一版工程最长支持 15 分钟');
  return project;
}

export function validateSettings(input = {}, project) {
  if (!input || typeof input !== 'object') fail('导出设置无效');
  const width = number(input.width ?? project.width, 128, 3840, '导出宽度');
  const height = number(input.height ?? project.height, 128, 2160, '导出高度');
  const fps = number(input.fps ?? project.fps, 1, 60, '导出帧率');
  if (!Number.isInteger(width) || width % 2 || !Number.isInteger(height) || height % 2) fail('导出宽高必须为偶数整数');
  const quality = input.quality ?? 'standard';
  if (!['standard', 'high'].includes(quality)) fail('导出画质无效');
  if (!project.clips.length || durationOf(project) < .04) fail('时间线为空，请先添加素材');
  return { width, height, fps, quality };
}
