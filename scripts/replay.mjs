// A/B the anti-jitter fix on IDENTICAL courses.
//   OLD arm: champion-legacy.json + vendored recenter physics (hold:false) + legacy encoder
//   NEW arm: champion.json        + hold-steering overlay        + lane-aware encoder
// Same seed set as tests/live-controls.test.mjs (2100001..2100030), same step
// budget (60s cap), one shared code path so the only differences are physics,
// encoder and weights. Reports per-arm: mean survival, action coverage, NOOP
// usage, LEFT<->RIGHT reversals, and departures from a CLEAR lane into a RISKY one.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGame } from "../lib/game-adapter.mjs";
import { Connectome } from "../lib/connectome.mjs";
import { forward, argmax } from "../lib/readout.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url)) + "/..";
const ACT_KEYS = { NOOP: null, LEFT: "left", RIGHT: "right", JUMP: "jump", DUCK: "duck" };
const PLAYER_T = 0.9, OB_LEAD = 1.1, DT = 1000 / 60;
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function setKB(api, name) {
  const key = ACT_KEYS[name];
  for (const k of ["left", "right", "jump", "duck"]) api.KB[k] = key === k;
}

const encoders = {
  // lane-aware (default): per-lane danger + own lane + in-lane kind + jump height
  lane(api) {
    const p = api.player;
    const pick = (lane) => api.obstacles.reduce(
      (b, o) => o.resolved ? b : (Math.abs(o.lane - lane) < 0.6 && (!b || o.t > b.t) ? o : b), null);
    const P = (o) => (o ? 1 - clamp((PLAYER_T - o.t) / OB_LEAD, 0, 1) : 0);
    const dL = pick(-1), dC = pick(0), dR = pick(1);
    const mine = p.laneX <= -0.6 ? dL : p.laneX >= 0.6 ? dR : dC;
    return [P(dL), P(dC), P(dR), (p.laneX + 1) / 2,
      mine && mine.avoid === "jump" ? 1 : 0,
      mine && mine.avoid === "duck" ? 1 : 0,
      mine && mine.avoid === "move" ? 1 : 0,
      clamp(p.jumpY / 30, 0, 1)];
  },
  // legacy: in-lane danger + is-move/jump/duck + nearest-move offset + jumpY + own lane
  legacy(api) {
    const p = api.player;
    let danger = null, mv = null;
    for (const o of api.obstacles) {
      if (o.resolved) continue;
      if (Math.abs(o.lane - p.laneX) < 0.6 && (!danger || o.t > danger.t)) danger = o;
      if (o.avoid === "move" && (!mv || o.t > mv.t)) mv = o;
    }
    const prox = o => o ? 1 - clamp((PLAYER_T - o.t) / OB_LEAD, 0, 1) : 0;
    return [prox(danger), danger && danger.avoid === "move" ? 1 : 0,
      danger && danger.avoid === "jump" ? 1 : 0, danger && danger.avoid === "duck" ? 1 : 0,
      prox(mv), mv ? (clamp(mv.lane - p.laneX, -1, 1) + 1) / 2 : 0.5,
      clamp(p.jumpY / 30, 0, 1), (p.laneX + 1) / 2];
  },
};

// per-lane prox for the "safe -> risky departure" metric
function laneProx(api, lane) {
  let best = null;
  for (const o of api.obstacles) {
    if (o.resolved) continue;
    if (Math.abs(o.lane - lane) < 0.6 && (!best || o.t > best.t)) best = o;
  }
  return best ? 1 - clamp((PLAYER_T - best.t) / OB_LEAD, 0, 1) : 0;
}

export function runArm(champion, { hold, encoder }, { seeds = [1], maxTicks = 3600 } = {}) {
  const enc = encoders[encoder];
  const agg = { survival: [], noops: 0, reversals: 0, unsafe: 0, used: [0, 0, 0, 0], deaths: 0 };
  for (const seed of seeds) {
    const api = loadGame({ seed, hold });
    api.startRun();
    const net = new Connectome();
    let prev = 0, tick = 0;
    while (tick < maxTicks) {
      const obs = enc(api);
      const logits = forward(champion, net.step(obs));
      const a = argmax(logits);
      if (a >= 1) agg.used[a - 1]++;
      if (a === 0) agg.noops++;
      if (a === 1 || a === 2) {
        if (prev !== 0 && a !== prev) agg.reversals++;
        prev = a;
        // safe -> risky: leaving my clear lane toward a lane with danger closing
        const p = api.player;
        const cur = p.laneX <= -0.6 ? 0 : p.laneX >= 0.6 ? 2 : 1;
        const target = a === 1 ? 0 : 2;
        const lanes = [-1, 0, 1].map((l) => laneProx(api, l));
        if (lanes[cur] < 0.2 && lanes[target] > 0.5) agg.unsafe++;
      }
      setKB(api, ACT_KEYS[a] === null ? "NOOP" : ["", "LEFT", "RIGHT", "JUMP", "DUCK"][a]);
      for (let k = 0; k < 2; k++) {
        const t = api._clock();
        api.update(t + DT); api._setClock(t + DT); tick++;
        if (api.phase === "dead") break;
      }
      if (api.phase === "dead") { agg.deaths++; break; }
    }
    agg.survival.push(api.elapsed);
  }
  const n = seeds.length;
  return {
    meanSurvival: agg.survival.reduce((a, b) => a + b, 0) / n,
    deaths: agg.deaths,
    noopsPerCourse: agg.noops / n,
    reversalsPerCourse: agg.reversals / n,
    unsafePerCourse: agg.unsafe / n,
    coverage: [...agg.used],
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const seeds = Array.from({ length: 30 }, (_, i) => 2100001 + i);
  const legacy = JSON.parse(readFileSync(join(ROOT, "public/checkpoints/champion-legacy.json"), "utf8"));
  const fresh = JSON.parse(readFileSync(join(ROOT, "public/checkpoints/champion.json"), "utf8"));
  const OLD = runArm(legacy, { hold: false, encoder: "legacy" }, { seeds });
  const NEW = runArm(fresh, { hold: true, encoder: "lane" }, { seeds });
  console.log("=== OLD (recenter physics + legacy encoder + legacy champ) ===");
  console.log(JSON.stringify(OLD, null, 2));
  console.log("=== NEW (hold physics + lane encoder + retrained champ) ===");
  console.log(JSON.stringify(NEW, null, 2));
  console.log("=== DELTAS (NEW - OLD) ===");
  console.log(JSON.stringify({
    meanSurvival: +(+NEW.meanSurvival - OLD.meanSurvival).toFixed(2),
    reversalsPerCourse: +(NEW.reversalsPerCourse - OLD.reversalsPerCourse).toFixed(1),
    unsafePerCourse: +(NEW.unsafePerCourse - OLD.unsafePerCourse).toFixed(1),
    noopsPerCourse: +(NEW.noopsPerCourse - OLD.noopsPerCourse).toFixed(1),
    coverage: NEW.coverage,
  }, null, 2));
}