// Trainable readout MLP: maps 16 connectome outputs -> hidden -> N action logits.
// Only these parameters are trained (CEM). Float64 for determinism.
export const ACTIONS = ["NOOP", "LEFT", "RIGHT", "JUMP", "DUCK"];
export const N_IN = 16;
export const N_HID = 12;
export const N_OUT = ACTIONS.length;
export const PARAM_COUNT = N_IN * N_HID + N_HID + N_OUT * N_HID + N_OUT; // 269

export function initParams(rng = Math.random) {
  const p = new Float64Array(PARAM_COUNT);
  // small zero-centered init
  for (let i = 0; i < p.length; i++) p[i] = (rng() * 2 - 1) * 0.3;
  return p;
}

// logits for one observation
export function forward(params, x) {
  // W1: N_HID x N_IN, b1: N_HID ; W2: N_OUT x N_HID, b2: N_OUT
  let k = 0;
  const h = new Float64Array(N_HID);
  for (let i = 0; i < N_HID; i++) {
    let acc = 0;
    for (let j = 0; j < N_IN; j++) acc += params[k++] * x[j];
    acc += params[k++];
    h[i] = Math.tanh(acc);
  }
  const out = new Float64Array(N_OUT);
  for (let o = 0; o < N_OUT; o++) {
    let acc = 0;
    for (let j = 0; j < N_HID; j++) acc += params[k++] * h[j];
    acc += params[k++];
    out[o] = acc;
  }
  return out;
}

export function argmax(logits) {
  let bi = 0;
  for (let i = 1; i < logits.length; i++) if (logits[i] > logits[bi]) bi = i;
  return bi;
}