export const EASING_TYPES = Object.freeze(['linear', 'easeIn', 'easeOut', 'easeInOut']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const easingAt = (type, progress) => {
  const u = clamp(progress, 0, 1);
  return type === 'easeInOut' ? u * u * (3 - 2 * u) : type === 'easeIn' ? u * u : type === 'easeOut' ? 1 - (1 - u) * (1 - u) : u;
};
export function keyProgressAt(key, u) {
  const [a, b] = key.phase ?? [0, 1];
  if (a === 0 && b === 1) return easingAt(key.easing, u);
  const c = keyProgressPolynomial(key), value = clamp(u, 0, 1);
  return value * (c[1] + value * (c[2] + value * c[3]));
}
// Coefficients in normalized segment time u. Consumers evaluate these numeric
// facts rather than reinterpreting easing names or retained trim/split phases.
export function keyProgressPolynomial(key) {
  const [a, b] = key.phase ?? [0, 1], d = b - a;
  // Factor out the common phase width before normalizing. Subtracting f(b)
  // minus f(a) loses all significant bits at stationary endpoints; d*d also
  // underflows for legal very small phases when it needlessly appears in both
  // numerator and denominator.
  const [c1, c2, c3] = key.easing === 'easeIn' ? [2 * a, d, 0]
    : key.easing === 'easeOut' ? [2 * (1 - a), -d, 0]
      : key.easing === 'easeInOut' ? [6 * a * (1 - a), 3 * (1 - 2 * a) * d, -2 * d * d] : [1, 0, 0];
  const denominator = c1 + c2 + c3;
  if (!denominator) return [0, 1, 0, 0];
  return [0, c1 / denominator, c2 / denominator, c3 / denominator];
}
