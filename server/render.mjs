import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { animationEffectExpressions, transitionRenderFilters } from '../shared/effects.mjs';
import { clipAudioEnabled, clipAudioSettings } from '../shared/audio.mjs';
import { audioProjectClock } from '../shared/audio-dsp.mjs';
import { createAudioClockCache } from './audio-clock.mjs';
import { renderAudioMix } from './audio-mix.mjs';
import { keyProgressPolynomial } from '../shared/easing.mjs';
import { HttpError } from './store.mjs';
import { run, ffmpegPath, getAvailability, inputSafetyArgs } from './process.mjs';
import { VIDEO_LAYER_COUNT, clipLayer, clipTransform, clipAdjustments, saturationMatrix, clipAnimation, animationAlphaAt, maskGeometry, inspectTransitions, clipPictureEdges, clipTiming, transformKeyframes, pictureTransformAt, clipSpeedCurve, curveRenderKnots, clipPictureFrameRange } from '../shared/model.mjs';

const decimal = value => Number(value.toFixed(6)).toString();
const literal = value => Number(value).toString();
// Frame identities remain integers across concat/loop/padding boundaries.
// Converting frame/fps to a rounded decimal can move a PTS or an enable test
// across a frame boundary, leaving an otherwise covered timeline frame black.
const frameClock = (fps, offset = 0) => `settb=expr=1/${decimal(fps)},setpts=N${offset ? `+${offset}` : ''}`;
function fittedPictureFilters(clip, width, height) {
  const filters = [];
  const { brightness, contrast, saturation } = clipAdjustments(clip);
  filters.push('format=rgba');
  if (brightness !== 1) {
    const expression = `val*${decimal(brightness)}`;
    filters.push(`lutrgb=r='${expression}':g='${expression}':b='${expression}'`);
  }
  if (contrast !== 1) {
    const expression = `(val-127.5)*${decimal(contrast)}+127.5`;
    filters.push(`lutrgb=r='${expression}':g='${expression}':b='${expression}'`);
  }
  if (saturation !== 1) {
    const coefficients = saturationMatrix(saturation);
    const names = ['rr', 'rg', 'rb', 'gr', 'gg', 'gb', 'br', 'bg', 'bb'];
    filters.push(`colorchannelmixer=${names.map((name, index) => `${name}=${decimal(coefficients[index])}`).join(':')}`);
  }
  filters.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease`, `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0`, 'setsar=1');
  return filters;
}
function transformedPictureFilters(clip, width, height, { animate = true } = {}) {
  const filters = [];
  const transform = clipTransform(clip);
  const geometric = transform.scale !== 1 || transform.x !== 0 || transform.y !== 0 || transform.rotation !== 0 || transform.flipX || transform.flipY;
  if (geometric) {
    // A fixed-size affine warp bounds allocation even for 4x zoom at 4K. The
    // transparent border prevents perspective's outside-edge sampling from
    // stretching opaque edge pixels across the rest of the output canvas.
    const paddedWidth = width + 2, paddedHeight = height + 2;
    const cx = paddedWidth / 2, cy = paddedHeight / 2;
    const radians = transform.rotation * Math.PI / 180;
    const cosine = Math.cos(radians), sine = Math.sin(radians);
    const sx = transform.scale * (transform.flipX ? -1 : 1);
    const sy = transform.scale * (transform.flipY ? -1 : 1);
    const corners = [[0, 0], [paddedWidth, 0], [0, paddedHeight], [paddedWidth, paddedHeight]];
    const coordinates = corners.flatMap(([x, y], index) => {
      const dx = (x - cx) * sx, dy = (y - cy) * sy;
      return [`x${index}=${decimal(cx + dx * cosine - dy * sine + transform.x)}`, `y${index}=${decimal(cy + dx * sine + dy * cosine + transform.y)}`];
    });
    filters.push(`pad=${paddedWidth}:${paddedHeight}:1:1:color=black@0`, `perspective=${coordinates.join(':')}:sense=destination:interpolation=linear`, `crop=${width}:${height}:1:1`);
  }
  if (transform.opacity !== 1) filters.push(`colorchannelmixer=aa=${decimal(transform.opacity)}`);
  const animation = clipAnimation(clip);
  if (animate && animation.in > 0) filters.push(`fade=t=in:st=0:d=${decimal(animation.in)}:alpha=1`);
  if (animate && animation.out > 0) filters.push(`fade=t=out:st=${decimal(clip.duration - animation.out)}:d=${decimal(animation.out)}:alpha=1`);
  return filters;
}

// Compile the same local-time key interpolation as transformAt. Flat interval
// sums avoid a recursively nested if-chain as projects gain more keys.
const easeExpr = (type, u) => type === 'easeInOut' ? `(st(9,${u});ld(9)*ld(9)*(3-2*ld(9)))` : type === 'easeIn' ? `(st(9,${u});ld(9)*ld(9))` : type === 'easeOut' ? `(st(9,1-(${u}));1-ld(9)*ld(9))` : `(${u})`;
function poseExpression(clip, field, t) {
  const keys = transformKeyframes(clip), base = clipTransform(clip)[field];
  if (!keys.length) return literal(base);
  if (keys.every(key => key.values[field] === keys[0].values[field])) return literal(keys[0].values[field]);
  const terms = [`${literal(keys[0].values[field])}*lt(${t},${literal(keys[0].time)})`];
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i], b = keys[i + 1];
    const u = `((${t}-${literal(a.time)})/${literal(b.time - a.time)})`;
    const [, c1, c2, c3] = keyProgressPolynomial(a);
    const progress = `(st(9,${u});ld(9)*(${literal(c1)}+ld(9)*(${literal(c2)}+ld(9)*${literal(c3)})))`;
    terms.push(`(${literal(a.values[field])}+${literal(b.values[field] - a.values[field])}*${progress})*gte(${t},${literal(a.time)})*lt(${t},${literal(b.time)})`);
  }
  terms.push(`${literal(keys.at(-1).values[field])}*gte(${t},${literal(keys.at(-1).time)})`);
  return `(${terms.join('+')})`;
}
function curveClockExpression(curve) {
  const map = curveRenderKnots(curve), terms = [];
  for (let i = 0; i + 1 < map.points.length; i++) {
    const a = map.points[i], b = map.points[i + 1], d = b.sourceOffset - a.sourceOffset;
    const A = 3 * (b.time - a.time) - d * (2 / a.rate + 1 / b.rate);
    const B = 2 * (a.time - b.time) + d * (1 / a.rate + 1 / b.rate);
    const q = `(ld(0)-${literal(a.sourceOffset)})/${literal(d)}`;
    terms.push(`(st(1,${q});${literal(a.time)}+ld(1)*(${literal(d / a.rate)}+ld(1)*(${literal(A)}+ld(1)*${literal(B)})))*gte(ld(0),${literal(a.sourceOffset)})*lt(ld(0),${literal(b.sourceOffset)})`);
  }
  terms.push(`${literal(map.points.at(-1).time)}*gte(ld(0),${literal(curve.sourceDuration)})`);
  return `st(0,max(0,PTS*TB));(${terms.join('+')})/TB`;
}
function pictureExpressions(clip, t, width, height) {
  const values = Object.fromEntries(['scale', 'x', 'y', 'rotation', 'opacity'].map(field => [field, poseExpression(clip, field, t)]));
  const animation = clipAnimation(clip), alpha = [];
  for (const [type, duration, raw] of [[animation.inType, animation.in, `${t}/${literal(animation.in || 1)}`],
    [animation.outType, animation.out, `(${literal(clip.duration)}-${t})/${literal(animation.out || 1)}`]]) {
    if (!duration) continue;
    const progress = easeExpr(animation.easing, `min(1,max(0,${raw}))`);
    const motion = animationEffectExpressions(type, progress, width, height);
    if (motion.alpha !== '1') alpha.push(motion.alpha);
    if (motion.x !== '0') values.x += `+${motion.x}`;
    if (motion.y !== '0') values.y += `+${motion.y}`;
    if (motion.rotation !== '0') values.rotation += `+${motion.rotation}`;
    if (motion.scale !== '1') values.scale = `(${values.scale})*${motion.scale}`;
  }
  values.opacity = `(${values.opacity})${alpha.map(value => `*${value}`).join('')}`;
  return values;
}
function dynamicPicture(graph, picture, clip, width, height, fps, pictureRange) {
  const id = clip.index, animation = clipAnimation(clip);
  // Source decoding has already advanced to the first globally covered frame.
  // Geometry and alpha must consume that same owner's local-time offset. Even
  // linear fades need the sampled path when their first frame is after start;
  // the zero-offset fast path retains the original FFmpeg fade behavior.
  const offset = pictureRange.offset;
  const hasAnimation = animation.in > 0 || animation.out > 0;
  const dynamic = transformKeyframes(clip).length || (hasAnimation && Math.abs(offset) > 1e-10) || (animation.in > 0 && (animation.inType !== 'fade' || animation.easing !== 'linear')) || (animation.out > 0 && (animation.outType !== 'fade' || animation.easing !== 'linear'));
  if (!dynamic) {
    const filters = transformedPictureFilters(clip, width, height);
    graph.push(`[${picture}]${filters.length ? filters.join(',') : 'null'}[motion${id}]`);
    return `motion${id}`;
  }
  const localTime = clock => offset ? `(${clock}+${literal(offset)})` : clock;
  const value = pictureExpressions(clip, localTime(`((on-1)/${decimal(fps)})`), width, height);
  const transform = clipTransform(clip), pw = width + 2, ph = height + 2, cx = pw / 2, cy = ph / 2;
  const corners = [[0, 0], [pw, 0], [0, ph], [pw, ph]];
  const coords = corners.flatMap(([x, y], n) => {
    const sx = (x - cx) * (transform.flipX ? -1 : 1), sy = (y - cy) * (transform.flipY ? -1 : 1);
    const common = `st(0,${value.scale});st(3,(${value.rotation})*PI/180);st(1,cos(ld(3)));st(2,sin(ld(3)));`;
    return [`x${n}='${common}${cx}+ld(0)*(${sx}*ld(1)-${sy}*ld(2))+(${value.x})'`,
      `y${n}='${common}${cy}+ld(0)*(${sx}*ld(2)+${sy}*ld(1))+(${value.y})'`];
  });
  graph.push(`[${picture}]pad=${pw}:${ph}:1:1:color=black@0,perspective=${coords.join(':')}:sense=destination:interpolation=linear:eval=frame,crop=${width}:${height}:1:1[geometry${id}]`);
  // Only four pixels evaluate the opacity expression per picture. Scaling this
  // uniform alpha plane avoids evaluating a long key expression at every pixel.
  const opacity = pictureExpressions(clip, localTime('T'), width, height).opacity;
  graph.push(`color=c=white:s=2x2:r=${decimal(fps)}:d=${decimal(clip.duration + 1)},format=gray,geq=lum='255*(${opacity})',scale=${width}:${height}[opacity${id}]`);
  graph.push(`[geometry${id}]split[motioncolor${id}][motionasource${id}]`);
  graph.push(`[motionasource${id}]alphaextract[motionalpha${id}]`);
  graph.push(`[motionalpha${id}][opacity${id}]blend=all_mode=multiply:shortest=1[motionproduct${id}]`);
  graph.push(`[motioncolor${id}][motionproduct${id}]alphamerge[motion${id}]`);
  return `motion${id}`;
}

function maskedPicture(graph, picture, mask, suffix) {
  if (!mask) return picture;
  graph.push(`[${picture}]split[color${suffix}][alphasource${suffix}]`);
  graph.push(`[alphasource${suffix}]alphaextract[alpha${suffix}]`);
  graph.push(`[alpha${suffix}][mask${suffix}]blend=all_mode=multiply:shortest=1[maskedalpha${suffix}]`);
  graph.push(`[color${suffix}][maskedalpha${suffix}]alphamerge[masked${suffix}]`);
  return `masked${suffix}`;
}

async function writeMask(clip, project, workDir) {
  const mask = maskGeometry(clip, project);
  if (mask.type === 'none') return null;
  // Build one bounded monochrome image, blur it once, then reuse that frame.
  // Padding with transparent pixels gives the blur the same outside-canvas
  // domain as an SVG mask, including shapes touching the project boundary.
  const padding = mask.padding;
  const width = project.width + 2 * padding, height = project.height + 2 * padding;
  const pixels = Buffer.alloc(width * height);
  const angle = mask.rotation * Math.PI / 180;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  const rx = mask.width / 2, ry = mask.height / 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = x + .5 - padding - mask.cx, dy = y + .5 - padding - mask.cy;
    const u = (dx * cosine + dy * sine) / rx;
    const v = (-dx * sine + dy * cosine) / ry;
    const inside = mask.type === 'ellipse' ? u * u + v * v <= 1 : Math.abs(u) <= 1 && Math.abs(v) <= 1;
    if (inside) pixels[y * width + x] = 255;
  }
  const filename = `mask-${clip.index}.pgm`;
  await fs.writeFile(path.join(workDir, filename), Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), pixels]));
  return { filename, padding, ...mask };
}
async function cjkFont() {
  const candidates = [
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/System/Library/Fonts/STHeiti Medium.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
    'C:/Windows/Fonts/msyh.ttc',
  ];
  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch { /* Try another CJK font. */ }
  }
  throw new HttpError(422, '未找到支持中文的系统字体，暂时无法烧录字幕');
}

export async function prepareRender(project, settings, store, workDir, output, controls = {}) {
  const { width, height, fps, quality, audioOnly = false } = settings;
  const canvasWidth = project.width, canvasHeight = project.height;
  const { pictureFrames: totalFrames, outputDuration } = audioProjectClock(project, fps);
  const graph = [];
  const args = ['-hide_banner', '-y', '-nostdin', '-loglevel', 'error', '-threads', '2', '-filter_complex_threads', '1'];
  const clips = project.clips.map((clip, index) => ({ ...clip, index, media: store.media.get(clip.mediaId) }));
  const cache = controls.clockCache ?? createAudioClockCache(store, { audioHelperPath: controls.audioHelperPath });
  const lease = controls.leaseId ?? randomUUID();
  const runProcess = controls.runProcess ?? ((args, { binary = ffmpegPath, ...options } = {}) => run(binary, args, options));
  const audibleIds = clips.filter(c => clipAudioEnabled(c, c.media, project) && clipAudioSettings(c).volume !== 0).map(c => c.id);
  let assets;
  try {
    assets = await cache.prepare(project, audibleIds, workDir, { ...controls, runProcess,
      onProgress: value => controls.onAudioProgress?.(value * .8) }, lease);
    await renderAudioMix(project, assets, path.join(workDir, 'audio-mix.wav'), { ...controls, fps,
      onProgress: value => controls.onAudioProgress?.(.8 + value * .2) });
  } finally {
    if (!controls.clockCache) { cache.release(lease); await cache.close(); }
  }
  const audioPreparations = assets;
  let inputCount = 0;
  for (const clip of clips) {
    const filename = store.mediaPath(clip.media);
    await fs.access(filename).catch(() => { throw new HttpError(400, `素材文件丢失：${clip.media.name}，请重新导入`); });
    clip.inputs = [];
    const needsPicture = !audioOnly && clip.track === 'video';
    const segments = needsPicture ? clipTiming(clip).segments : [];
    for (const segment of segments) {
      clip.inputs.push({ ...segment, index: inputCount++ });
      args.push('-threads', '2', ...inputSafetyArgs);
      if (clip.media.type === 'image') args.push('-loop', '1', '-framerate', String(fps), '-t', decimal(clip.duration));
      else args.push('-ss', decimal(segment.sourceStart), '-t', decimal(segment.sourceDuration));
      args.push('-i', filename);
    }
  }
  const mixedAudioInput = inputCount++;
  args.push(...inputSafetyArgs, '-i', 'audio-mix.wav');

  if (!audioOnly) {
  const masks = new Map();
  for (const clip of clips.filter(item => item.track === 'video')) {
    const mask = await writeMask(clip, project, workDir);
    if (mask) {
      mask.inputIndex = inputCount + masks.size;
      masks.set(clip.id, mask);
      args.push(...inputSafetyArgs, '-f', 'image2', '-i', mask.filename);
    }
  }

  const videoClips = clips.filter(clip => clip.track === 'video').sort((a, b) => clipLayer(a) - clipLayer(b) || a.start - b.start);
  const transitions = inspectTransitions(project).transitions.map((transition, index) => ({ ...transition, index,
    ...clipPictureFrameRange({ start: transition.start, duration: transition.duration }, fps) }))
    .filter(transition => transition.endFrame > transition.startFrame);
  const sources = new Map();
  graph.push(`color=c=black:s=${canvasWidth}x${canvasHeight}:r=${fps}:d=${decimal(outputDuration)},format=rgba,trim=end_frame=${totalFrames},setpts=PTS-STARTPTS[canvas]`);
  for (const clip of videoClips) {
    const pictureRange = clipPictureFrameRange(clip, fps);
    const { startFrame, endFrame } = pictureRange;
    const frames = Math.max(1, pictureRange.frames);
    const speed = clip.media.type === 'image' ? 1 : clip.speed;
    const outgoing = transitions.find(item => item.fromId === clip.id);
    const incoming = transitions.find(item => item.toId === clip.id);
    const heldFrames = outgoing ? Math.max(0, outgoing.endFrame - endFrame) : 0;
    const headFrames = incoming ? Math.max(0, startFrame - incoming.startFrame) : 0;
    const edgeRange = clipPictureFrameRange(clip, project.fps);
    const edges = clipPictureEdges(clip, project.fps);
    const snapshots = [
      ...(headFrames ? [{ kind: 'head', time: edges.first, frame: 0, frames: headFrames, output: `head${incoming.index}` }] : []),
      ...(heldFrames ? [{ kind: 'tail', time: edges.last, frame: Math.max(0, edgeRange.frames - 1), frames: heldFrames, output: `held${outgoing.index}` }] : []),
    ];
    const needsEdges = snapshots.length > 0;
    if (clipSpeedCurve(clip)) {
      graph.push(`[${clip.inputs[0].index}:v:0]setpts='${curveClockExpression(clip.speedCurve)}'${needsEdges ? `,split[raw${clip.index}][edgeraw${clip.index}]` : `[raw${clip.index}]`}`);
    } else if (clip.speedSegments?.length) {
      for (const part of clip.inputs) {
        if (needsEdges) graph.push(`[${part.index}:v:0]split[segraw${part.index}][segedge${part.index}]`);
      }
      const sequence = (rate, edge) => {
        const labels = [];
        for (const part of clip.inputs) {
          const partRange = clipPictureFrameRange({ start: clip.start + part.start, duration: part.duration }, rate);
          let frameCount = partRange.frames;
          const fallback = !clipPictureFrameRange(clip, rate).frames && part === clip.inputs[0];
          if (fallback) frameCount = 1;
          const raw = needsEdges ? `seg${edge ? 'edge' : 'raw'}${part.index}` : `${part.index}:v:0`;
          if (frameCount <= 0) { graph.push(`[${raw}]nullsink`); continue; }
          const label = `segment${edge ? 'edge' : 'main'}${part.index}`;
          graph.push(`[${raw}]setpts=PTS/${decimal(part.speed)}-${literal(fallback ? 0 : partRange.offset)}/TB,fps=${decimal(rate)}:start_time=0:round=up,tpad=stop_mode=clone:stop=${frameCount},trim=end_frame=${frameCount},${frameClock(rate)}[${label}]`);
          labels.push(`[${label}]`);
        }
        const target = `${edge ? 'edgeraw' : 'raw'}${clip.index}`;
        graph.push(`${labels.join('')}${labels.length > 1 ? `concat=n=${labels.length}:v=1:a=0,${frameClock(rate)}` : 'null'}[${target}]`);
      };
      sequence(fps, false);
      if (needsEdges) sequence(project.fps, true);
    } else {
      graph.push(`[${clip.inputs[0].index}:v:0]setpts=PTS/${decimal(speed)}${needsEdges ? `,split[raw${clip.index}][edgeraw${clip.index}]` : `[raw${clip.index}]`}`);
    }
    // Pad source pictures before motion sampling. Padding an already animated
    // picture would freeze key/alpha/preset time on the last normal frames.
    graph.push(`[raw${clip.index}]${clip.speedSegments?.length ? '' : `setpts=PTS-${literal(pictureRange.offset)}/TB,`}fps=${fps}:start_time=0:round=up,${fittedPictureFilters(clip, canvasWidth, canvasHeight).join(',')},tpad=stop_mode=clone:stop=${frames},trim=end_frame=${frames}[fit${clip.index}]`);
    const mask = masks.get(clip.id);
    if (mask) {
      const maskFilters = ['format=gray'];
      if (mask.sigma > 0) maskFilters.push(`gblur=sigma=${decimal(mask.sigma)}:steps=3`);
      if (mask.padding) maskFilters.push(`crop=${canvasWidth}:${canvasHeight}:${mask.padding}:${mask.padding}`);
      if (mask.invert) maskFilters.push('negate');
      maskFilters.push(`loop=loop=-1:size=1:start=0`, frameClock(fps));
      graph.push(`[${mask.inputIndex}:v:0]${maskFilters.join(',')}${needsEdges ? `,split=${1 + snapshots.length}[mask${clip.index}]${snapshots.map(edge => `[maskedge${edge.kind}${clip.index}]`).join('')}` : `[mask${clip.index}]`}`);
    }
    const picture = maskedPicture(graph, `fit${clip.index}`, mask, clip.index);
    const motion = dynamicPicture(graph, picture, clip, canvasWidth, canvasHeight, fps, pictureRange);
    const uses = [`normal${clip.index}`];
    if (outgoing) uses.push(`from${outgoing.index}`);
    if (incoming) uses.push(`to${incoming.index}`);
    graph.push(`[${motion}]setpts=PTS-STARTPTS${uses.length > 1 ? `,split=${uses.length}${uses.map(use => `[${use}]`).join('')}` : `[${uses[0]}]`}`);
    if (snapshots.length > 1) graph.push(`[edgeraw${clip.index}]split=${snapshots.length}${snapshots.map(edge => `[rawedge${edge.kind}${clip.index}]`).join('')}`);
    for (const edge of snapshots) {
      const suffix = `edge${edge.kind}${clip.index}`;
      const raw = snapshots.length > 1 ? `raw${suffix}` : `edgeraw${clip.index}`;
      graph.push(`[${raw}]${clip.speedSegments?.length ? '' : `setpts=PTS-${literal(edgeRange.frames ? edgeRange.offset : 0)}/TB,`}fps=${decimal(project.fps)}:start_time=0:round=up,tpad=stop_mode=clone:stop=${edge.frame + 1},trim=start_frame=${edge.frame}:end_frame=${edge.frame + 1},${fittedPictureFilters(clip, canvasWidth, canvasHeight).join(',')}[${suffix}fit]`);
      const edgePicture = maskedPicture(graph, `${suffix}fit`, mask, suffix);
      const edgeFilters = transformedPictureFilters({ ...clip, transform: pictureTransformAt(clip, edge.time, project) }, canvasWidth, canvasHeight, { animate: false });
      const alpha = animationAlphaAt(clip, edge.time);
      if (alpha !== 1) edgeFilters.push(`colorchannelmixer=aa=${decimal(alpha)}`);
      graph.push(`[${edgePicture}]${edgeFilters.length ? `${edgeFilters.join(',')},` : ''}setpts=PTS-STARTPTS,loop=loop=-1:size=1:start=0,${frameClock(fps)},trim=end_frame=${edge.frames}[${edge.output}]`);
    }
    sources.set(clip.id, { clip, startFrame, endFrame, frames, outgoing, incoming, headFrames, heldFrames });
  }
  let previous = 'canvas', compositeIndex = 0;
  const overlay = (label, startFrame, endFrame) => {
    const next = `composite${compositeIndex++}`;
    const frame = `floor(t*${decimal(fps)}+0.5)`;
    graph.push(`[${previous}][${label}]overlay=x=0:y=0:format=rgb:eof_action=pass:repeatlast=0:enable='gte(${frame},${startFrame})*lt(${frame},${endFrame})'[${next}]`);
    previous = next;
  };
  for (let layer = 0; layer < VIDEO_LAYER_COUNT; layer++) {
    for (const clip of videoClips.filter(item => clipLayer(item) === layer)) {
      const source = sources.get(clip.id);
      const start = source.incoming ? source.incoming.endFrame : source.startFrame;
      const end = source.outgoing ? source.outgoing.startFrame : source.endFrame;
      graph.push(`[normal${clip.index}]${frameClock(fps, source.startFrame)}[v${clip.index}]`);
      // Keep this stream consumed even when transitions cover its whole normal
      // interval. A false enable cannot accidentally freeze its last frame.
      overlay(`v${clip.index}`, start, Math.max(start, end));
    }
    for (const transition of transitions.filter(item => item.layer === layer)) {
      const from = sources.get(transition.fromId);
      const frames = transition.endFrame - transition.startFrame;
      const startOffset = Math.max(0, Math.min(from.frames - 1, transition.startFrame - from.startFrame));
      const before = frames - from.heldFrames;
      const id = transition.index;
      // Give cloned frames an explicit frame clock. FFmpeg 4.4's tpad may
      // otherwise leave a timestamp gap exactly where source and held frames
      // meet; framesync would repeat the preceding blend at the cut.
      if (before > 0) {
        graph.push(`[from${id}]trim=start_frame=${startOffset}:end_frame=${startOffset + before},setpts=PTS-STARTPTS[live${id}]`);
        if (frames > before) graph.push(`[live${id}][held${id}]concat=n=2:v=1:a=0,${frameClock(fps)},format=gbrap,premultiply=inplace=1[old${id}]`);
        else graph.push(`[live${id}]format=gbrap,premultiply=inplace=1[old${id}]`);
      } else {
        graph.push(`[from${id}]nullsink`);
        graph.push(`[held${id}]format=gbrap,premultiply=inplace=1[old${id}]`);
      }
      const to = sources.get(transition.toId), liveFrames = frames - to.headFrames;
      if (liveFrames > 0) {
        graph.push(`[to${id}]trim=end_frame=${liveFrames},setpts=PTS-STARTPTS[newlive${id}]`);
        graph.push(`${to.headFrames ? `[head${id}][newlive${id}]concat=n=2:v=1:a=0,` : `[newlive${id}]`}${frameClock(fps)},format=gbrap,premultiply=inplace=1[new${id}]`);
      } else {
        graph.push(`[to${id}]nullsink`);
        graph.push(`[head${id}]format=gbrap,premultiply=inplace=1[new${id}]`);
      }
      const progress = clock => `min(1,max(0,(${clock}+${transition.startFrame}/${decimal(fps)}-${decimal(transition.start)})/${decimal(transition.duration)}))`;
      const effect = transitionRenderFilters(transition.type, progress);
      graph.push(`[old${id}]${effect.outgoingFilter}[oldmoved${id}]`);
      graph.push(`[new${id}]${effect.incomingFilter}[newmoved${id}]`);
      graph.push(`[oldmoved${id}][newmoved${id}]${effect.combineFilter},unpremultiply=inplace=1,format=rgba,${frameClock(fps, transition.startFrame)}[transition${id}]`);
      overlay(`transition${id}`, transition.startFrame, transition.endFrame);
    }
  }
  if (project.subtitles.length) {
    const available = await getAvailability();
    if (!available.filters.drawtext) throw new HttpError(422, '当前 FFmpeg 不支持 drawtext，不能安全烧录字幕');
    // Files contain literal UTF-8. Text never enters the FFmpeg filter grammar.
    await fs.symlink(await cjkFont(), path.join(workDir, 'font.ttc'));
    for (let index = 0; index < project.subtitles.length; index++) {
      const subtitle = project.subtitles[index];
      const file = `subtitle-${index}.txt`;
      await fs.writeFile(path.join(workDir, file), subtitle.text);
      const size = subtitle.fontSize;
      const margin = Math.round(canvasHeight * .07);
      const y = subtitle.position === 'top' ? String(margin) : subtitle.position === 'center' ? '(h-text_h)/2' : `h-text_h-${margin}`;
      const next = `sub${index}`;
      const outlineWidth = subtitle.outlineWidth ?? Math.max(1, subtitle.fontSize / 24);
      const outlineColor = subtitle.outlineColor ?? '#000000';
      graph.push(`[${previous}]drawtext=fontfile=font.ttc:textfile=${file}:expansion=none:fontsize=${decimal(size)}:fontcolor=${subtitle.color.replace('#', '0x')}:borderw=${decimal(outlineWidth)}:bordercolor=${outlineColor.replace('#', '0x')}:x=(w-text_w)/2:y=${y}:enable='gte(t,${decimal(subtitle.start)})*lt(t,${decimal(subtitle.start + subtitle.duration)})'[${next}]`);
      previous = next;
    }
  }
  graph.push(`[${previous}]scale=${width}:${height},setsar=1,format=yuv420p,trim=duration=${decimal(outputDuration)},setpts=PTS-STARTPTS[vout]`);
  }
  graph.push(`[${mixedAudioInput}:a:0]anull[aout]`);
  await fs.writeFile(path.join(workDir, 'filters.txt'), graph.join(';\n'));
  args.push('-filter_complex_script', 'filters.txt');
  if (audioOnly) args.push('-map', '[aout]', '-vn', '-t', decimal(outputDuration), '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2');
  else args.push('-map', '[vout]', '-map', '[aout]', '-t', decimal(outputDuration), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', quality === 'high' ? '18' : '23', '-pix_fmt', 'yuv420p', '-r', String(fps), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart');
  args.push('-threads', '2', '-progress', 'pipe:1', '-nostats', output);
  return { args, duration: outputDuration, audioPreparations };
}

export function createExportQueue(store, { onStage = () => {}, onChild = () => {}, removeWork = fs.rm, audioHelperPath } = {}) {
  const jobs = new Map();
  const clockCache = createAudioClockCache(store, { audioHelperPath });
  let active = false, closed = false;
  const idleWaiters = new Set();
  const snapshot = job => ({ id: job.id, status: job.status, progress: job.progress,
    ...(job.assets && { assets: job.assets.map(({ filename, ...asset }) => asset) }),
    ...(job.url && { url: job.url, filename: job.filename }), ...(job.error && { error: job.error }), ...(job.cleanupError && { cleanupError: job.cleanupError }) });
  async function cleanup(job, paths) {
    const remaining = [];
    for (const item of paths) {
      try { await removeWork(item.path, item.options); }
      catch (error) { remaining.push(item); job.cleanupError = `导出临时文件清理失败：${error.message}`; }
    }
    job.cleanupPaths = remaining;
    if (!remaining.length) { delete job.cleanupPaths; if(!job.cleanupHandles?.length)delete job.cleanupError; }
  }
  async function closeHandles(job) {
    const remaining=[];
    for(const handle of job.cleanupHandles??[])try{await handle.close();}catch(error){remaining.push(handle);job.cleanupError=`音频句柄清理失败：${error.message}`;}
    if(remaining.length)job.cleanupHandles=remaining;
    else {delete job.cleanupHandles;if(!job.cleanupPaths?.length)delete job.cleanupError;}
  }
  async function pump() {
    if (active || closed) return;
    const job = [...jobs.values()].find(item => item.status === 'queued');
    if (!job) return;
    active = true;
    job.status = 'rendering';
    const workDir = path.join(store.dirs.work, job.id);
    const extension = job.settings.audioOnly ? 'wav' : 'mp4';
    const partialOutput = path.join(store.dirs.exports, `${job.id}.partial.${extension}`);
    const publications = new Set();
    try {
      await fs.mkdir(workDir, { recursive: true });
      const checkCancelled = () => { if (job.status === 'cancelled') throw new Error('导出已取消'); };
      const stage = name => { job.phase = name; onStage(name, job.id); };
      const runProcess = async (args, options) => {
        checkCancelled(); let current;
        const { binary = ffmpegPath, ...processOptions } = options || {};
        try {
          return await run(binary, args, { ...processOptions, onChild: child => {
            current = child; job.child = child; onChild(child, job.phase, job.id);
          } });
        } finally {
          clearTimeout(job.killTimer); job.killTimer = null;
          if (job.child === current) job.child = null;
        }
      };
      const cacheControls = { checkCancelled, runProcess, onStage: stage,
        ownCleanup: filename => publications.add(filename), releaseCleanup: filename => publications.delete(filename) };
      if (job.kind === 'clock') {
        job.assets = await clockCache.prepare(job.project, job.clipIds, workDir, { ...cacheControls,
          onProgress: value => { job.progress = Math.max(job.progress, Math.min(99.8, value * 100)); } }, job.id);
        checkCancelled(); job.status = 'completed'; job.progress = 100;
        return;
      }
      const { args, duration } = await prepareRender(job.project, job.settings, store, workDir, partialOutput, {
        ...cacheControls, audioHelperPath, clockCache, leaseId: job.id,
        onAudioProgress: progress => { job.progress = Math.max(job.progress, progress * 35); },
      });
      if (job.status === 'cancelled') return;
      let pending = '';
      const initialProgress = 35; // Shared PCM mixing always completes the preparation phase.
      stage(job.settings.audioOnly ? 'audio-mix' : 'video-mux');
      await runProcess(args, {
        cwd: workDir, timeout: 30 * 60 * 1000,
        onProgress: chunk => {
          pending += chunk;
          const lines = pending.split('\n'); pending = lines.pop();
          for (const line of lines) {
            if (line.startsWith('out_time_us=') || line.startsWith('out_time_ms=')) {
              const seconds = Number(line.split('=')[1]) / 1e6;
              if (Number.isFinite(seconds)) job.progress = Math.max(job.progress, Math.min(99.8, initialProgress + seconds / duration * (100 - initialProgress)));
            }
          }
        },
      });
      if (job.status !== 'cancelled') {
        const completedOutput = path.join(store.dirs.exports, `${job.id}.${extension}`);
        await fs.rename(partialOutput, completedOutput);
        if (job.status === 'cancelled') await fs.rm(completedOutput, { force: true });
        else {
          job.status = 'completed'; job.progress = 100;
          job.url = `/exports/${job.id}.${extension}`;
          job.filename = `${job.project.name.replace(/[\\/<>:"|?*\u0000-\u001f]/g, '_').slice(0, 100)}.${extension}`;
        }
      }
    } catch (error) {
      if(error.cleanupHandles)job.cleanupHandles=error.cleanupHandles;
      if (job.status !== 'cancelled') { job.status = 'failed'; job.error = error.message; }
    } finally {
      clearTimeout(job.killTimer);
      job.child = null;
      onStage('cleanup', job.id);
      await cleanup(job, [{ path: partialOutput, options: { force: true } }, { path: workDir, options: { recursive: true, force: true } }]);
      if (publications.size) await cleanup(job, [...(job.cleanupPaths ?? []), ...[...publications].map(filename => ({ path: filename, options: { force: true } }))]);
      await closeHandles(job);
      if (job.kind !== 'clock' || job.status !== 'completed') await clockCache.release(job.id).catch(error=>{job.cacheCleanupError=true;job.cleanupError=`音频缓存清理失败：${error.message}`;});
      // Finished jobs retain only status, never large duplicate project graphs.
      delete job.project; delete job.settings;
      active = false;
      for (const resolve of idleWaiters) resolve();
      idleWaiters.clear();
      queueMicrotask(pump);
    }
  }
  return {
    enqueue(project, settings, { kind = 'export', clipIds } = {}) {
      if (closed) throw new HttpError(503, '本地视频服务正在关闭');
      if ([...jobs.values()].filter(job => ['queued', 'rendering'].includes(job.status)).length >= 3) throw new HttpError(429, '导出队列已满（最多 3 项），请等待当前任务完成');
      // Bound the process-local history; completed MP4 files remain on disk.
      if (jobs.size >= 100) {
        const oldest = [...jobs.values()].find(job => ['completed', 'failed', 'cancelled'].includes(job.status) && !job.cleanupPaths && !job.cleanupHandles && !clockCache.hasLease(job.id));
        if (oldest) jobs.delete(oldest.id);
        else throw new HttpError(503, '导出临时文件尚未清理，暂不能创建更多任务');
      }
      const job = { id: randomUUID(), status: 'queued', progress: 0, project, settings, kind, clipIds };
      if (kind === 'clock') clockCache.startLease(job.id);
      jobs.set(job.id, job);
      queueMicrotask(pump);
      return snapshot(job);
    },
    get(id) { const job = jobs.get(id); if (!job) throw new HttpError(404, '找不到导出任务（服务重启后任务状态会清空）'); return snapshot(job); },
    prepareAudio(project, clipIds) { return this.enqueue(project, { audioOnly: true }, { kind: 'clock', clipIds }); },
    audioRange: (...args) => clockCache.range(...args),
    cancel(id) {
      const job = jobs.get(id);
      if (!job) throw new HttpError(404, '找不到导出任务');
      if (job.kind === 'clock') clockCache.release(job.id);
      if (['queued', 'rendering'].includes(job.status)) {
        const queued = job.status === 'queued';
        job.status = 'cancelled';
        if (queued) { delete job.project; delete job.settings; }
        if (job.child) {
          const child = job.child;
          child.kill('SIGTERM');
          job.killTimer = setTimeout(() => { if (job.child === child) child.kill('SIGKILL'); }, 2000);
          job.killTimer.unref();
        } else if (!active) queueMicrotask(pump);
      }
      return snapshot(job);
    },
    close() {
      closed = true;
      for (const job of jobs.values()) if (['queued', 'rendering'].includes(job.status)) this.cancel(job.id);
      // The desktop must keep its server alive until FFmpeg has exited and its
      // final work directory/partial output cleanup has finished.
      const wait = active ? new Promise(resolve => idleWaiters.add(resolve)) : Promise.resolve();
      return wait.then(async () => {
        for (const job of jobs.values()) if (job.cleanupPaths) await cleanup(job, job.cleanupPaths);
        for (const job of jobs.values()) if (job.cleanupHandles) await closeHandles(job);
        const incomplete = [...jobs.values()].find(job => job.cleanupPaths || job.cleanupHandles);
        if (incomplete) throw new Error(incomplete.cleanupError);
        await clockCache.close();
        for(const job of jobs.values())if(job.cacheCleanupError){delete job.cacheCleanupError;if(!job.cleanupPaths&&!job.cleanupHandles)delete job.cleanupError;}
      });
    },
  };
}
