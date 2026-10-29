// Source-domain continuous positive speed. Stored points are the definition;
// integration tables and render approximations are derived, never persisted.
export const MAX_SPEED_CURVE_POINTS = 128;
export const MAX_SPEED_CURVE_SOURCE_SLOPE = 8;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ease = u => u * u * (3 - 2 * u);
const gaussX = [.1834346424956498, .525532409916329, .7966664774136267, .9602898564975363];
const gaussW = [.362683783378362, .3137066458778873, .2223810344533745, .1012285362903763];
const plans = new WeakMap();
function spanRate(a, b, position) {
  const u = clamp((position - a.position) / (b.position - a.position), 0, 1);
  const [lo, hi] = a.phase ?? [0, 1];
  const first = ease(lo), range = ease(hi) - first;
  const progress = range ? (ease(lo + (hi - lo) * u) - first) / range : u;
  return a.speed + (b.speed - a.speed) * progress;
}
export function curveRate(curve, position) {
  const points = curve.points;
  if (position <= 0) return points[0].speed;
  if (position >= 1) return points.at(-1).speed;
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >>> 1; if (points[m].position <= position) lo = m; else hi = m; }
  return spanRate(points[lo], points[hi], position);
}
export function speedCurveMaxSourceSlope(curve) {
  let maximum = 0;
  for (let i = 0; i + 1 < curve.points.length; i++) {
    const a = curve.points[i], b = curve.points[i + 1], [lo, hi] = a.phase ?? [0, 1];
    const range = ease(hi) - ease(lo), peak = clamp(.5, lo, hi);
    const normalizedDerivative = range ? (hi - lo) * 6 * peak * (1 - peak) / range : 1;
    maximum = Math.max(maximum, Math.abs(b.speed - a.speed) * normalizedDerivative / ((b.position - a.position) * curve.sourceDuration));
  }
  return maximum;
}
function integrate(a, b, from, to, sourceDuration) {
  if (to <= from) return 0;
  const center = (from + to) / 2, half = (to - from) / 2;
  let value = 0;
  for (let i = 0; i < gaussX.length; i++) {
    const offset = half * gaussX[i];
    value += gaussW[i] * (1 / spanRate(a, b, center - offset) + 1 / spanRate(a, b, center + offset));
  }
  return value * half * sourceDuration;
}
export function curvePlan(curve) {
  // Consumers may mutate a draft in-place. Check every result-affecting value
  // before reusing the object cache; identity alone is not a freshness proof.
  const signature = JSON.stringify([curve.sourceDuration, curve.points.map(p => [p.position, p.speed, p.phase ?? [0, 1]])]);
  const cached = plans.get(curve);
  if (cached?.signature === signature) return cached;
  const cells = [];
  let duration = 0;
  for (let i = 0; i + 1 < curve.points.length; i++) {
    const a = curve.points[i], b = curve.points[i + 1];
    // Fixed Gauss-Legendre integration over 64 subintervals is deterministic.
    // Even the .25..4 rate ratio is well resolved, including clipped phases.
    for (let j = 0; j < 64; j++) {
      const left = a.position + (b.position - a.position) * j / 64;
      const right = a.position + (b.position - a.position) * (j + 1) / 64;
      const length = integrate(a, b, left, right, curve.sourceDuration);
      cells.push({ left, right, start: duration, end: duration + length, a, b });
      duration += length;
    }
  }
  const plan = { signature, cells, duration };
  plans.set(curve, plan);
  return plan;
}
function timelineAtPlan(curve, plan, position) {
  const u = clamp(position, 0, 1);
  if (u === 0) return 0;
  if (u === 1) return plan.duration;
  let lo = 0, hi = plan.cells.length - 1;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (plan.cells[m].right < u) lo = m + 1; else hi = m; }
  const cell = plan.cells[lo];
  return cell.start + integrate(cell.a, cell.b, cell.left, u, curve.sourceDuration);
}
export function curveTimelineAt(curve, position) { return timelineAtPlan(curve, curvePlan(curve), position); }
export function sampleSpeedCurve(curve, count) {
  const plan = curvePlan(curve);
  return Array.from({ length: count }, (_, i) => {
    const position = i / (count - 1);
    return { position, sourceOffset: position * curve.sourceDuration, time: timelineAtPlan(curve, plan, position), rate: curveRate(curve, position) };
  });
}
function sourceAtPlan(curve, plan, time) {
  const t = clamp(time, 0, plan.duration);
  if (t === 0) return 0;
  if (t === plan.duration) return 1;
  let lo = 0, hi = plan.cells.length - 1;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (plan.cells[m].end < t) lo = m + 1; else hi = m; }
  const cell = plan.cells[lo];
  let left = cell.left, right = cell.right;
  let u = left + (right - left) * (t - cell.start) / (cell.end - cell.start);
  for (let i = 0; i < 20; i++) {
    const value = cell.start + integrate(cell.a, cell.b, cell.left, u, curve.sourceDuration) - t;
    if (Math.abs(value) < 1e-10) break;
    if (value > 0) right = u; else left = u;
    const next = u - value * spanRate(cell.a, cell.b, u) / curve.sourceDuration;
    u = next > left && next < right ? next : (left + right) / 2;
  }
  return clamp(u, cell.left, cell.right);
}
export function curveSourceAt(curve, time) { return sourceAtPlan(curve, curvePlan(curve), time); }
export function curveSourcesAt(curve, times) {
  const plan = curvePlan(curve);
  return times.map(time => sourceAtPlan(curve, plan, time));
}
export function sliceSpeedCurve(curve, left, right) {
  const locations = [left, ...curve.points.filter(p => p.position > left && p.position < right).map(p => p.position), right];
  const points = locations.map((position, i) => {
    const original = curve.points.find(p => Math.abs(p.position - position) < 1e-12);
    const next = locations[i + 1];
    const point = { id: original?.id ?? crypto.randomUUID(), position: (position - left) / (right - left), speed: curveRate(curve, position), phase: [0, 1] };
    if (next !== undefined) {
      const index = curve.points.findIndex((p, j) => j + 1 < curve.points.length && position >= p.position && position < curve.points[j + 1].position);
      if (index >= 0) {
        const a = curve.points[index], b = curve.points[index + 1], phase = a.phase ?? [0, 1];
        point.phase = [position, next].map(x => clamp(phase[0] + (phase[1] - phase[0]) * (x - a.position) / (b.position - a.position), 0, 1));
      }
    }
    return point;
  });
  points[0].position = 0; points.at(-1).position = 1;
  return { sourceDuration: curve.sourceDuration * (right - left), points };
}
// Cubic Hermite approximation of the forward clock, with independent midpoint
// and quarter-point error checks. It changes timestamp representation, not the
// continuous saved speed definition. Consumers receive its measured error.
export function curveRenderKnots(curve, tolerance = .00005) {
  const points = [], errors = [];
  const exact = position => ({ position, sourceOffset: position * curve.sourceDuration, time: curveTimelineAt(curve, position), rate: curveRate(curve, position) });
  const approximate = (a, b, u) => {
    const d = b.sourceOffset - a.sourceOffset, q = (u - a.position) / (b.position - a.position);
    const A = 3 * (b.time - a.time) - d * (2 / a.rate + 1 / b.rate);
    const B = 2 * (a.time - b.time) + d * (1 / a.rate + 1 / b.rate);
    return { value: a.time + q * (d / a.rate + q * (A + q * B)), derivative: (d / a.rate + q * (2 * A + q * 3 * B)) / d };
  };
  function add(a, b, depth) {
    const samples = [.25, .5, .75].map(q => a.position + (b.position - a.position) * q);
    const error = Math.max(...samples.map(u => Math.abs(approximate(a, b, u).value - curveTimelineAt(curve, u))));
    const positive = [a.position, ...samples, b.position].every(u => approximate(a, b, u).derivative > 0);
    if (error > tolerance || !positive) {
      if (depth >= 20) throw new RangeError('速度曲线过于密集，无法在有界精度内导出');
      const mid = exact((a.position + b.position) / 2); add(a, mid, depth + 1); add(mid, b, depth + 1);
    } else { if (!points.length) points.push(a); points.push(b); errors.push(error); }
  }
  for (let i = 0; i + 1 < curve.points.length; i++) add(exact(curve.points[i].position), exact(curve.points[i + 1].position), 0);
  return { points, sampledMaxTimeError: Math.max(0, ...errors), tolerance };
}

// One offline R3 short-window stretcher owns the whole selected source interval. Only its
// sample map is batched; there are no independently restarted audio blocks.
export const CURVE_AUDIO_ENGINE_ID = 'rubberband-4.0.0-r3-short-offline-v1';
const AUDIO_RATE = 48000, MAP_INTERVAL_SAMPLES = 960;
export function curveAudioPlan(curve) {
  if (!Number.isFinite(curve?.sourceDuration) || curve.sourceDuration <= 0 || curve.sourceDuration > 3600 || !Array.isArray(curve.points) || curve.points.length < 2 || curve.points.length > MAX_SPEED_CURVE_POINTS)
    throw new RangeError('曲线音频源区间无效，工程最长支持900秒、源区间最长3600秒');
  if (curve.points.some((p, i) => !Number.isFinite(p.position) || !Number.isFinite(p.speed) || p.speed < .25 || p.speed > 4 || p.position < 0 || p.position > 1 || (i && p.position <= curve.points[i - 1].position)))
    throw new RangeError('曲线音频节点无效');
  if (curve.points[0].position !== 0 || curve.points.at(-1).position !== 1) throw new RangeError('曲线音频节点必须覆盖完整源区间');
  const duration = curvePlan(curve).duration, samples = Math.round(duration * AUDIO_RATE), sourceSamples = Math.round(curve.sourceDuration * AUDIO_RATE);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 900 + 1e-9 || !Number.isSafeInteger(samples) || samples < 1 || samples > 900 * AUDIO_RATE || !Number.isSafeInteger(sourceSamples) || sourceSamples < 1)
    throw new RangeError('曲线音频时长无效，工程最长支持900秒');
  const flat = curve.points.every(p => p.speed === curve.points[0].speed);
  const minimum = Math.min(...curve.points.map(p => p.speed)), sourceSlope = speedCurveMaxSourceSlope(curve);
  const mapCount = flat ? 0 : Math.max(0, Math.ceil(sourceSamples / MAP_INTERVAL_SAMPLES) - 1);
  // This is the interpolation error of the source/output map, not a bound on
  // Rubber Band's transient placement. Runtime audio markers are tested separately.
  const idealTimeErrorBound = sourceSlope * (MAP_INTERVAL_SAMPLES / AUDIO_RATE) ** 2 / (8 * minimum ** 2);
  return { engine: flat ? 'constant-atempo' : CURVE_AUDIO_ENGINE_ID, flat, samples, sourceSamples, mapCount, mapIntervalSamples: MAP_INTERVAL_SAMPLES, sourceSlope, idealTimeErrorBound };
}
export function assertSpeedCurveSupported(curve) {
  const plan = curveAudioPlan(curve), maximum = plan.sourceSlope;
  if (maximum > MAX_SPEED_CURVE_SOURCE_SLOPE * (1 + 1e-10)) throw new RangeError(`曲线速度变化过陡（${maximum.toFixed(2)}倍/源秒），请拉开节点或减小速度差；本版已验证范围为${MAX_SPEED_CURVE_SOURCE_SLOPE}倍/源秒以内`);
  return plan;
}
export function curveAudioTimeMapBatch(curve, firstIndex = 0, count = 4096) {
  const plan = assertSpeedCurveSupported(curve);
  if (!Number.isSafeInteger(firstIndex) || firstIndex < 0 || !Number.isInteger(count) || count < 1 || count > 4096) throw new RangeError('曲线音频映射批次范围无效');
  if (firstIndex >= plan.mapCount) return [];
  const integration = curvePlan(curve);
  return Array.from({ length: Math.min(count, plan.mapCount - firstIndex) }, (_, j) => {
    const sourceFrame = (firstIndex + j + 1) * plan.mapIntervalSamples;
    return { sourceFrame, outputFrame: Math.round(timelineAtPlan(curve, integration, sourceFrame / plan.sourceSamples) * AUDIO_RATE) };
  });
}
