// Hand policy v2 against the corrected encoder. Goal: establish the achievable
// survival ceiling for a competent reactive controller on these observations.
import { Env, encodeObs } from "../lib/env.mjs";
import { ACTIONS } from "../lib/readout.mjs";

const SEEDS = [2100001, 2100002, 2100003, 2100004, 2100005];
const DE = 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// obs: [proxDanger, isMove, isJump, isDuck, moveLoom, steerOff, jumpH, lane]
function makePolicy() {
  let dodgeDir = 0, dodgeUntil = 0;
  let lastMoveLoom = 0;
  return function (obs, env) {
    const [prox, isMove, isJump, isDuck, loom, steer, jumpH, lane] = obs;
    const now = env.api.frameCount;

    // Release a committed dodge once the in-lane danger has cleared.
    if (dodgeDir !== 0) {
      if (prox < 0.15) { dodgeDir = 0; }
      else return dodgeDir;
    }

    // lane index in -1..1
    const laneIdx = lane * 2 - 1;

    // 1) TIMED threats in lane: react only when close (prox encodes distance-to-impact).
    //    Jump/duck must land at the resolution tick (~0.94s jump duration), so react late.
    if (prox > 0.85) {
      if (isJump > 0.5) return 3;   // JUMP at the last moment
      if (isDuck > 0.5) return 4;   // DUCK (held while prox high)
      if (isMove > 0.5) {           // must change lane
        const dir = steer >= 0.5 ? 1 : 2;
        dodgeDir = dir;
        return dir;
      }
    }
    // if a move obstacle is in lane but not imminent yet, start the dodge early
    if (isMove > 0.5 && prox > 0.4) {
      const dir = steer >= 0.5 ? 1 : 2;
      dodgeDir = dir;
      return dir;
    }

    // 2) pre-position: a move obstacle is coming but not in lane yet; edge to the
    //    side with space to dodge (toward center if unknown).
    if (loom > 0.3 ) {
      // steer<0.5 -> move-threat is left -> lean right; steer>0.5 -> right -> lean left
      const lean = steer < 0.5 ? 2 : 1;
      // only lean if it reduces future dodge distance without overcommitting
      if (prox < 0.5) return lean;
    }

    // 3) recenter to middle lane when clear
    if (prox < 0.3) {
      if (laneIdx < -0.2) return 2;
      if (laneIdx > 0.2) return 1;
    }
    return 0;
  };
}

function evalPolicy(name, policy, { cap = 180 } = {}) {
  let sum = 0, completed = 0, min = 1e9;
  for (const seed of SEEDS) {
    const env = new Env({ decisionEvery: DE, maxSeconds: cap });
    env.reset({ seed });
    while (true) {
      const obs = encodeObs(env.api);
      const a = policy(obs, env);
      const res = env.step(ACTIONS[a]);
      if (res.done) { sum += res.elapsed; if (!res.crashed) completed++; min = Math.min(min, res.elapsed); break; }
    }
  }
  return { name, mean: +(sum / SEEDS.length).toFixed(2), min: +min.toFixed(2), completed };
}

console.log(evalPolicy("hand v2", makePolicy()));