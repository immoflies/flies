// ArmRig — damped elastic joints that translate 16 circuit-output features into
// foreleg angles. Movement is physical: a fast, slightly-overshooting (underdamped)
// second-order response — like an insect leg lashing out then stabilizing — not a
// sluggish ease-in. Organic variation comes from the live outputs, never an RNG.
//
// Default target source: an ENGINEERED opposing-pair mapping (yaw=L0-L1, ...).
// Pass `new ArmRig(motorModel)` to swap in a CEM-trained motor model instead
// (W1/b1 -> 10 hidden, W2/b2 -> per-joint target), so lane timing/side can be
// learned rather than scripted. Never auto-aims, never fake-scores.
export const JOINTS = ['yaw', 'pitch', 'elbow', 'wrist'];
const J = { yaw: { min: -1.1, max: 1.1 }, pitch: { min: -1.2, max: 1.2 }, elbow: { min: -1.0, max: 1.0 }, wrist: { min: -1.0, max: 1.0 } };
export const MAP = { L: {}, R: {} };
for (const side of ['L', 'R']) for (const j of JOINTS) MAP[side][j] = { ...J[j] };

const SIM_SCALE = 1.3;
// Opposing pairs: yaw=L[0]-L[1], pitch=L[2]-L[3], elbow=L[4]-L[5], wrist=L[6]-L[7]; right side is +8.
function targetFromPairs(side, outs) {
  const o = side === 'L' ? 0 : 8;
  const t = {};
  JOINTS.forEach((j, idx) => t[j] = SIM_SCALE * (outs[o + idx * 2] - outs[o + idx * 2 + 1]));
  return t;
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const blank = () => Object.fromEntries(['L', 'R'].map(s => [s, Object.fromEntries(JOINTS.map(j => [j, 0]))]));

export class ArmRig {
  constructor(motorModel = null) {
    this.model = motorModel;                 // {W1,b1,W2,b2} when a trained map is provided
    this._state = blank();
    this.velocity = blank();
    this.targets = blank();
    this.neural = Array(16).fill(0);
  }
  pose() { return structuredClone(this._state); }
  telemetry() {
    return { neural: this.neural.slice(), targets: structuredClone(this.targets),
      angles: structuredClone(this._state), velocity: structuredClone(this.velocity) };
  }
  _jointTarget(side, joint, outs) {
    if (!this.model) return targetFromPairs(side, outs)[joint] || 0;
    const m = this.model[side === 'L' ? 'left' : 'right'] || this.model, h = new Float64Array(m.b1.length);
    for (let u = 0; u < h.length; u++) {
      let acc = 0; for (let n = 0; n < 16; n++) acc += m.W1[u][n] * outs[n];
      h[u] = Math.tanh(acc + m.b1[u]);
    }
    let acc = m.b2[joint] ?? 0;
    for (let u = 0; u < h.length; u++) acc += m.W2[joint][u] * h[u];
    return SIM_SCALE * Math.tanh(acc);
  }
  update(dt, outs) {
    if (!Array.isArray(outs) || outs.length !== 16 || outs.some(x => !Number.isFinite(x)))
      throw new Error('needs 16 finite brain-output features');
    if (!Number.isFinite(dt) || dt < 0 || dt > 0.1) throw new Error('dt in (0,0.1]');
    this.neural = Array.from(outs);
    // Ballistic spring: stiff + underdamped for a fast, slightly-overshooting response.
    const K = 420, C = 2 * Math.sqrt(K) * 0.65, VMAX = 9.0;
    const steps = Math.max(1, Math.ceil(dt / (1 / 240))); const h = dt / steps;
    for (const side of ['L','R']) for (const j of JOINTS) this.targets[side][j] = clamp(this._jointTarget(side,j,outs),J[j].min,J[j].max);
    for (let n = 0; n < steps; n++) {
      for (const side of ['L', 'R']) for (const j of JOINTS) {
        const target = this.targets[side][j];
        this.targets[side][j] = target;
        const p = this._state[side], v = this.velocity[side];
        const acc = clamp(K * (target - p[j]) - C * v[j], -2200, 2200);
        v[j] = clamp(v[j] + acc * h, -VMAX, VMAX);
        const next=p[j]+v[j]*h;
        p[j] = clamp(next, J[j].min, J[j].max);
        if(next!==p[j]) v[j]=0;
      }
    }
    return this.pose();
  }
}