// Environment: ties the headless game + connectome + readout together.
// 8 engineered observations -> 80-cell MaleCNS circuit -> 16 activities ->
// trainable readout -> 5 actions injected into the game's KB input.
import { loadGame } from "./game-adapter.mjs";
import { Connectome } from "./connectome.mjs";
import { ACTIONS, N_IN, N_HID, forward, argmax } from "./readout.mjs";

export const FPS = 60;
export const DT = 1000 / FPS;
export const PLAYER_T = 0.9;
const OB_LEAD = 1.1;
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// Lane-aware encoding: the 8 hard-wired circuit input channels carry per-lane
// danger proximity (so an EMPTY lane is observable), our own lane, the in-lane
// obstacle kind, and jump height. The old encoder only saw in-lane danger plus
// a single move-threat offset, so the policy steered blind to adjacent-lane
// safety and flapped into unsafe lanes.
export function encodeObs(api) {
  const p = api.player;
  const obsList = api.obstacles;
  const pick = (lane) => obsList.reduce(
    (b, o) => o.resolved ? b : (Math.abs(o.lane - lane) < 0.6 && (!b || o.t > b.t) ? o : b), null);
  const P = (o) => (o ? 1 - clamp((PLAYER_T - o.t) / OB_LEAD, 0, 1) : 0);
  const dL = pick(-1), dC = pick(0), dR = pick(1);
  const mine = p.laneX <= -0.6 ? dL : p.laneX >= 0.6 ? dR : dC;
  return [
    P(dL), P(dC), P(dR),                 // left / center / right danger
    (p.laneX + 1) / 2,                    // own lane
    mine && mine.avoid === "jump" ? 1 : 0,
    mine && mine.avoid === "duck" ? 1 : 0,
    mine && mine.avoid === "move" ? 1 : 0,
    clamp(p.jumpY / 30, 0, 1),
  ];
}

const ACT_KEY = { NOOP: null, LEFT: "left", RIGHT: "right", JUMP: "jump", DUCK: "duck" };
function setKB(api, actionName) {
  const key = ACT_KEY[actionName];
  for (const k of ["left", "right", "jump", "duck"]) api.KB[k] = key === k;
}

export class Env {
  constructor({ decisionEvery = 2, maxSeconds = 180, speedLevel = 2 } = {}) {
    this.decisionEvery = decisionEvery;
    this.maxSeconds = maxSeconds;
    this.maxTicks = Math.floor(maxSeconds * FPS);
    this.speedLevel = speedLevel; // informational; vendor defaults to level 2
    this.circuit = null;
    this.api = null;
  }
  reset({ seed = 1, ablated = false } = {}) {
    this.api = loadGame({ seed });
    this.ablated = ablated;
    this.circuit = new Connectome();
    this.api.startRun();
    this.tick = 0;
    return encodeObs(this.api);
  }
  step(actionName) {
    setKB(this.api, actionName);
    for (let k = 0; k < this.decisionEvery; k++) {
      const t = this.api._clock();
      this.api.update(t + DT);
      this.api._setClock(t + DT);
      this.tick++;
      if (this.api.phase === "dead") {
        return { obs: null, done: true, elapsed: this.api.elapsed, score: this.api.score, crashed: true };
      }
      if (this.tick >= this.maxTicks) {
        return { obs: null, done: true, elapsed: this.api.elapsed, score: this.api.score, crashed: false };
      }
    }
    return { obs: encodeObs(this.api), done: false, elapsed: this.api.elapsed, score: this.api.score, crashed: false };
  }
}

// Coverage is a per-episode distinct-action bonus, not a reward per move.
export function rollout(params, { seed = 1, decisionEvery = 2, ablated = false, maxSeconds = 180 } = {}) {
  const env = new Env({ decisionEvery, maxSeconds });
  env.reset({ seed, ablated });
  const net = env.circuit;
  const used = [false, false, false, false];
  let prevSteer = 0;          // 0 | 1(LEFT) | 2(RIGHT) last chosen steer
  let switches = 0;           // LEFT<->RIGHT oscillations (the flapping signal)
  while (true) {
    const obs = encodeObs(env.api);
    const feats = net.step(obs, ablated);
    const logits = forward(params, feats);
    const a = argmax(logits);
    if (a >= 1) used[a - 1] = true;
    if (a === 1 || a === 2) { if (prevSteer !== 0 && a !== prevSteer) switches++; prevSteer = a; }
    const res = env.step(ACTIONS[a]);
    if (res.done) return { ...res, coverage: used, switches };
  }
}
