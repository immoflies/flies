// Physical 3D check whether the point P lies on the blade segment
// from A to B, within a radius r and along its finite length. The game uses this
// so NOTHING is scored via position snapping/auto-aim — the arm must physically
// reach the note, pure neural→joint mapping decides where the blade goes.
function bladeTouches(A, B, P, r) {
  const ax = A[0], ay = A[1], az = A[2];
  const bx = B[0], by = B[1], bz = B[2];
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  const px = P[0] - ax, py = P[1] - ay, pz = P[2] - az;
  let t = len2 ? (px * dx + py * dy + pz * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx - P[0], cy = ay + t * dy - P[1], cz = az + t * dz - P[2];
  return cx * cx + cy * cy + cz * cz <= r * r;
}

// A slice is a CUT, not an overlap: the blade must be MOVING through the note.
// `previous`/`current` are {base, tip} world position pairs from consecutive
// ticks. A stationary blade can never cut (a fruit driving into a parked blade
// is a miss, not contact) — the arm must actually move to hit the target.
const CUT_MIN_SPEED = 1.0; // game-world units/second; engineered anti-drift threshold
function bladeCuts({ previous, current, point, radius, dt, bladeSide, noteSide }) {
  if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1 || !previous || !current) return false;
  if (!['L','R'].includes(bladeSide) || bladeSide !== noteSide) return false;
  const vectors = [previous.base, previous.tip, current.base, current.tip, point];
  if (vectors.some(v => !Array.isArray(v) || v.length !== 3 || v.some(x => !Number.isFinite(x)))) return false;
  if (!Number.isFinite(radius) || radius < 0) return false;
  if (!bladeTouches(current.base, current.tip, point, radius)) return false;
  // Closest material point on the CURRENT blade: compare the same fraction
  // along the previous blade, not the fruit's motion or the moving projection.
  const d = current.tip.map((v,i) => v-current.base[i]);
  const len2 = d.reduce((s,v) => s+v*v,0);
  const t = len2 ? Math.max(0,Math.min(1,d.reduce((s,v,i) => s+v*(point[i]-current.base[i]),0)/len2)) : 0;
  const displacement = current.base.map((v,i) =>
    v + t*d[i] - (previous.base[i] + t*(previous.tip[i]-previous.base[i])));
  return Math.hypot(...displacement)/dt >= CUT_MIN_SPEED;
}

export { bladeTouches, bladeCuts, CUT_MIN_SPEED };