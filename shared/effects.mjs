// Independent local-editor effects. Numeric preview samples and FFmpeg
// expressions consume the same catalog and channel definitions.
import { motionTransitionAt, motionTransitionFilters } from './transition-motion.mjs';
const back = 1.70158;
export const ANIMATION_EFFECTS = Object.freeze([
  { type: 'fade', inLabel: '渐显', outLabel: '渐隐', channels: { alpha: [0, 1] } },
  { type: 'slideLeft', inLabel: '从左滑入', outLabel: '向左滑出', channels: { x: [-1, 1] } },
  { type: 'slideRight', inLabel: '从右滑入', outLabel: '向右滑出', channels: { x: [1, -1] } },
  { type: 'zoom', inLabel: '缩放', outLabel: '缩放', channels: { scale: [.5, .5] } },
  { type: 'slideUp', inLabel: '从上滑入', outLabel: '向上滑出', channels: { y: [-1, 1] } },
  { type: 'slideDown', inLabel: '从下滑入', outLabel: '向下滑出', channels: { y: [1, -1] } },
  { type: 'rotate', inLabel: '顺时针旋入', outLabel: '逆时针旋出', channels: { rotation: [-90, 90] } },
  { type: 'pop', inLabel: '弹性放大', outLabel: '弹性缩小', channels: { scale: [.5, (back + 3) / 2, -(2 * back + 3) / 2, (back + 1) / 2] } },
  { type: 'zoomFade', inLabel: '缩放渐显', outLabel: '缩放渐隐', channels: { scale: [.5, .5], alpha: [0, 1] } },
  { type: 'rotateFade', inLabel: '旋转渐显', outLabel: '旋转渐隐', channels: { rotation: [-90, 90], alpha: [0, 1] } },
  { type: 'spinZoom', inLabel: '旋转放大', outLabel: '旋转缩小', channels: { rotation: [-180, 180], scale: [.1, .9], alpha: [0, 1] } },
  { type: 'swingFade', inLabel: '摆动渐显', outLabel: '摆动渐隐', channels: { rotation: { kind: 'dampedSine', amplitude: 20, cycles: 3 }, alpha: [0, 1] } },
  { type: 'riseFade', inLabel: '升起渐显', outLabel: '下降渐隐', channels: { y: [.2, -.2], alpha: [0, 1] } },
  { type: 'arcFade', inLabel: '弧线滑入', outLabel: '弧线滑出', channels: { x: [-.3, .3], y: [0, -.6, .6], rotation: [-20, 20], alpha: [0, 1] } },
]);
export const TRANSITION_EFFECTS = Object.freeze([
  { type: 'dissolve', label: '叠化', kind: 'dissolve' },
  { type: 'wipeLeft', label: '向左擦除', kind: 'wipe', axis: 'x', reverse: true },
  { type: 'wipeRight', label: '向右擦除', kind: 'wipe', axis: 'x', reverse: false },
  { type: 'fadeBlack', label: '淡黑', kind: 'black' },
  { type: 'wipeUp', label: '向上擦除', kind: 'wipe', axis: 'y', reverse: true },
  { type: 'wipeDown', label: '向下擦除', kind: 'wipe', axis: 'y', reverse: false },
  { type: 'circleOpen', label: '圆形展开', kind: 'circle', close: false },
  { type: 'circleClose', label: '圆形收拢', kind: 'circle', close: true },
  { type: 'pushLeft', label: '向左推进', kind: 'push', direction: -1 },
  { type: 'pushRight', label: '向右推进', kind: 'push', direction: 1 },
  { type: 'slideLeft', label: '向左滑入', kind: 'slide', direction: -1 },
  { type: 'slideRight', label: '向右滑入', kind: 'slide', direction: 1 },
  { type: 'fadeWhite', label: '淡白', kind: 'white' },
  { type: 'splitOpen', label: '中间展开', kind: 'window', axes: 'x', close: false },
  { type: 'splitClose', label: '两侧合拢', kind: 'window', axes: 'x', close: true },
  { type: 'boxOpen', label: '矩形展开', kind: 'window', axes: 'xy', close: false },
  { type: 'pushUp', label: '向上推进', kind: 'push', axis: 'y', direction: -1 },
  { type: 'diamondOpen', label: '菱形展开', kind: 'diamond' },
]);
export const ANIMATION_TYPES = Object.freeze(ANIMATION_EFFECTS.map(effect => effect.type));
export const TRANSITION_TYPES = Object.freeze(TRANSITION_EFFECTS.map(effect => effect.type));
const animations = new Map(ANIMATION_EFFECTS.map(effect => [effect.type, effect]));
const transitions = new Map(TRANSITION_EFFECTS.map(effect => [effect.type, effect]));
const clamp = value => Math.max(0, Math.min(1, value));
const number = value => Number(value).toString();
const effect = (map, type) => {
  const result = map.get(type);
  if (!result) throw new RangeError(`未知的画面效果：${type}`);
  return result;
};
export const transitionLabel = type => transitions.get(type)?.label || (type === 'none' ? '无' : '未知转场');

function polynomial(coefficients, progress) {
  return coefficients.reduceRight((result, coefficient) => result * progress + coefficient, 0);
}
function polynomialExpression(coefficients, progress) {
  return coefficients.reduceRight((result, coefficient) => result === null ? number(coefficient) : `(${number(coefficient)}+(${progress})*${result})`, null);
}
function channelAt(definition, progress) {
  if (Array.isArray(definition)) return polynomial(definition, progress);
  if (definition.kind === 'dampedSine') return definition.amplitude * Math.sin(2 * Math.PI * definition.cycles * progress) * (1 - progress);
  throw new RangeError('未知的动画通道函数');
}
function channelExpression(definition, progress) {
  if (Array.isArray(definition)) return polynomialExpression(definition, progress);
  if (definition.kind === 'dampedSine') return `(${number(definition.amplitude)}*sin(2*PI*${number(definition.cycles)}*(${progress}))*(1-(${progress})))`;
  throw new RangeError('未知的动画通道函数');
}
export function animationEffectAt(type, progress, project) {
  const definition = effect(animations, type), p = clamp(progress);
  const result = { scale: 1, x: 0, y: 0, rotation: 0, alpha: 1 };
  if (p === 1) return result;
  for (const [channel, coefficients] of Object.entries(definition.channels)) {
    const value = channelAt(coefficients, p);
    result[channel] = channel === 'x' ? value * project.width : channel === 'y' ? value * project.height : value;
  }
  return result;
}
export function animationAlphaProgress(type, progress) {
  const coefficients = effect(animations, type).channels.alpha;
  return coefficients ? channelAt(coefficients, clamp(progress)) : 1;
}
export function animationEffectExpressions(type, progress, width, height) {
  const definition = effect(animations, type);
  const result = { scale: '1', x: '0', y: '0', rotation: '0', alpha: '1' };
  for (const [channel, coefficients] of Object.entries(definition.channels)) {
    const value = channelExpression(coefficients, progress);
    result[channel] = channel === 'x' ? `(${number(width)}*${value})` : channel === 'y' ? `(${number(height)}*${value})` : value;
  }
  return result;
}

export function transitionEffectAt(type, progress) {
  const definition = effect(transitions, type), p = clamp(progress);
  const outgoing = { weight: 1 - p }, incoming = { weight: p };
  let blackOpacity = 0, whiteOpacity = 0;
  if (definition.kind === 'push' || definition.kind === 'slide') {
    return { ...motionTransitionAt(definition, p), blackOpacity, whiteOpacity };
  }
  if (definition.kind === 'black' || definition.kind === 'white') {
    outgoing.weight = Math.max(0, 1 - 2 * p); incoming.weight = Math.max(0, 2 * p - 1);
    if (definition.kind === 'black') blackOpacity = 1 - outgoing.weight - incoming.weight;
    else whiteOpacity = 1 - outgoing.weight - incoming.weight;
  } else if (definition.kind === 'wipe') {
    outgoing.weight = incoming.weight = 1;
    const offset = definition.reverse ? 1 - p : p;
    const old = { x: 0, y: 0, width: 1, height: 1 }, next = { ...old };
    const size = definition.axis === 'x' ? 'width' : 'height';
    old[definition.axis] = definition.reverse ? 0 : offset; old[size] = 1 - p;
    next[definition.axis] = definition.reverse ? offset : 0; next[size] = p;
    outgoing.clipRect = old; incoming.clipRect = next;
  } else if (definition.kind === 'circle') {
    outgoing.weight = incoming.weight = 1;
    const radius = definition.close ? 1 - p : p;
    outgoing.clipCircle = { radius, outside: !definition.close };
    incoming.clipCircle = { radius, outside: definition.close };
  } else if (definition.kind === 'window') {
    outgoing.weight = incoming.weight = 1;
    const size = definition.close ? 1 - p : p;
    const rect = { x: (1 - size) / 2, y: definition.axes === 'xy' ? (1 - size) / 2 : 0, width: size, height: definition.axes === 'xy' ? size : 1 };
    // outside selects the complement on the project canvas, not a second
    // overlapping rectangle. Both samples keep their complete RGBA values.
    outgoing.clipRect = { ...rect, outside: !definition.close };
    incoming.clipRect = { ...rect, outside: definition.close };
  } else if (definition.kind === 'diamond') {
    outgoing.weight = incoming.weight = 1;
    // The polygon may extend beyond the canvas. Its complement is clipped by
    // the same fixed project canvas, retaining transparent source holes.
    const points = [[.5, .5 - p], [.5 + p, .5], [.5, .5 + p], [.5 - p, .5]];
    outgoing.clipPolygon = { points, outside: true };
    incoming.clipPolygon = { points, outside: false };
  }
  return { outgoing, incoming, blackOpacity, whiteOpacity };
}

// Circle radius is a fraction of the canvas center-to-corner distance. CSS's
// farthest-corner radial gradient preserves this geometry at every preview size.
export function transitionSampleStyle(sample) {
  const style = {};
  if (sample.translate) style.transform = `translate(${sample.translate.x * 100}%, ${sample.translate.y * 100}%)`;
  if (sample.clipRect) {
    const { x, y, width, height, outside = false } = sample.clipRect;
    if (outside) {
      // One even-odd polygon owns the complete rectangular complement. Its
      // retraced bridge has no area; no overlapping opaque strips are added.
      const point = (px, py) => `${px * 100}% ${py * 100}%`;
      style.clipPath = `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${point(x, y)}, ${point(x, y + height)}, ${point(x + width, y + height)}, ${point(x + width, y)}, ${point(x, y)})`;
    } else style.clipPath = `inset(${y * 100}% ${(1 - x - width) * 100}% ${(1 - y - height) * 100}% ${x * 100}%)`;
  }
  if (sample.clipCircle) {
    const { radius, outside } = sample.clipCircle, stop = clamp(radius) * 100;
    const gradient = `radial-gradient(circle farthest-corner at 50% 50%, ${outside ? 'transparent' : '#000'} ${stop}%, ${outside ? '#000' : 'transparent'} ${stop}%)`;
    Object.assign(style, { maskImage: gradient, WebkitMaskImage: gradient, maskSize: '100% 100%', WebkitMaskSize: '100% 100%', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' });
  }
  if (sample.clipPolygon) {
    const { points, outside } = sample.clipPolygon;
    const point = ([x, y]) => `${x * 100}% ${y * 100}%`;
    // A retraced bridge joins the outer canvas to the reversed inner loop.
    // evenodd also clips polygons extending outside the canvas at p > .5.
    const vertices = outside
      ? ['0% 0%', '100% 0%', '100% 100%', '0% 100%', '0% 0%', ...[points[0], ...points.slice(1).reverse(), points[0]].map(point)]
      : points.map(point);
    style.clipPath = `polygon(${outside ? 'evenodd, ' : ''}${vertices.join(', ')})`;
  }
  return Object.keys(style).length ? style : undefined;
}

// Inputs are already premultiplied gbrap. A/B select all four planes together;
// black/white add a canvas-colored opaque contribution to premultiplied alpha.
export function transitionBlendFilter(type, progress) {
  const definition = effect(transitions, type);
  if (definition.kind === 'push' || definition.kind === 'slide') throw new TypeError('空间转场需要完整的转场渲染计划');
  if (definition.kind === 'wipe') {
    const coordinate = definition.axis === 'x' ? 'X' : 'Y', size = definition.axis === 'x' ? 'W' : 'H';
    const incoming = definition.reverse ? `gte(${coordinate},${size}*(1-(${progress})))` : `lt(${coordinate},${size}*(${progress}))`;
    return `all_expr='if(${incoming},B,A)'`;
  }
  if (definition.kind === 'circle') {
    const radius = definition.close ? `(1-(${progress}))` : `(${progress})`;
    const distance = '((X-W/2)*(X-W/2)+(Y-H/2)*(Y-H/2))';
    const threshold = `((W*W+H*H)/4*${radius}*${radius})`;
    const incoming = `${definition.close ? 'gte' : 'lt'}(${distance},${threshold})`;
    return `all_expr='if(${incoming},B,A)'`;
  }
  if (definition.kind === 'window') {
    const size = definition.close ? `(1-(${progress}))` : progress;
    const inside = `lt(abs(2*X+1-W),W*ld(0))${definition.axes === 'xy' ? '*lt(abs(2*Y+1-H),H*ld(0))' : ''}`;
    return `all_expr='st(0,${size});if(${inside},${definition.close ? 'A,B' : 'B,A'})'`;
  }
  if (definition.kind === 'diamond') {
    // Pixel centers define a normalized L1 diamond on a non-square canvas.
    // Integer-scaled coordinates avoid two divisions per RGBA plane/pixel.
    const inside = 'lt(abs(2*X+1-W)*H+abs(2*Y+1-H)*W,2*W*H*ld(0))';
    return `all_expr='st(0,${progress});if(${inside},B,A)'`;
  }
  if (definition.kind === 'white') {
    // Each half mixes one input with opaque white, identically on RGBA.
    // Evaluate the project clock once per pixel instead of repeating it in
    // every coefficient; this keeps 1080P fades within the simple-blend cost.
    return `all_expr='st(0,${progress});if(lt(ld(0),0.5),A*(1-2*ld(0))+510*ld(0),B*(2*ld(0)-1)+510*(1-ld(0)))'`;
  }
  if (definition.kind === 'black') {
    const a = `max(0,1-2*(${progress}))`, b = `max(0,2*(${progress})-1)`;
    return `c0_expr='A*${a}+B*${b}':c1_expr='A*${a}+B*${b}':c2_expr='A*${a}+B*${b}':c3_expr='A*${a}+B*${b}+255*(1-${a}-${b})'`;
  }
  return `all_expr='A*(1-(${progress}))+B*(${progress})'`;
}

// The owner returns complete filters so consumers never reinterpret kinds or
// force spatial effects through a same-coordinate pixel blend operation.
export function transitionRenderFilters(type, progress) {
  const definition = effect(transitions, type);
  if (definition.kind === 'push' || definition.kind === 'slide') return motionTransitionFilters(definition, progress);
  const p = typeof progress === 'function' ? progress('T') : progress;
  return { outgoingFilter: 'null', incomingFilter: 'null', combineFilter: `blend=${transitionBlendFilter(type, p)}:shortest=1` };
}
