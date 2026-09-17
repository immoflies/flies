// Regression tests for the fly-jitter fix. The root cause had two halves:
//   (1) the vendored controller re-centred toward lane 0 whenever no horizontal
//       key was held, so NOOP/JUMP/DUCK drifted the fly out of a safe side lane;
//       the hold-readcontrols overlay makes no-horizontal = HOLD current lane.
//   (2) the policy steered blind to adjacent-lane safety; the encoder now feeds
//       per-lane danger proximity into the 8 fixed circuit input channels.
// Plus the fitness incentive: coverage bonus + switch penalty (so training
// rewards all four actions without rewarding oscillation).
import assert from "node:assert/strict";
import { Env, encodeObs } from "../lib/env.mjs";
import { loadGame } from "../lib/game-adapter.mjs";
import { fitnessScore } from "../scripts/train.mjs";

const cfg = { coverageWeight: 1.4, switchWeight: 0.01 };

// (1) hold physics: a non-steer action keeps the chosen lane instead of
//     re-centering. Runs through loadGame (which now ships the hold overlay).
{
  const env = new Env(); env.reset({ seed: 7 });
  for (let i = 0; i < 10; i++) env.step("LEFT");
  const held = env.api.player.laneX;
  assert.ok(held < -0.9, `settled firmly in the left lane (laneX=${held.toFixed(2)})`);
  for (const action of ["NOOP", "JUMP", "DUCK"]) {
    const beforeIter = env.api.player.laneX;
    env.step(action);
    const after = env.api.player.laneX;
    assert.ok(Math.abs(after - beforeIter) < 0.02,
      `${action} HOLDS the lane (${beforeIter.toFixed(3)} -> ${after.toFixed(3)}), did not re-center`);
  }
}
console.log("PASS (1) no-horizontal action holds the lane (no recenter)");

// (2) encoder sees each lane: an EMPTY lane is observable, so the policy can
//     tell a safe lane from an unsafe one. Here a jump-hazard sits dead-ahead
//     in the CENTER lane (where the fresh run starts), so the center danger and
//     the in-lane "jump" kind fire while both side lanes read clear.
{
  const api = loadGame({ seed: 7 });
  api.startRun();
  api.obstacles.push({ kind: "rock", avoid: "jump", lane: 0, t: 0.9, resolved: false });
  const o = encodeObs(api);
  assert.equal(o.length, 8, "8 hard-wired channels");
  assert.ok(o[1] > 0.8, `center lane shows danger (prox=${o[1].toFixed(2)})`);
  assert.ok(o[0] < 0.05 && o[2] < 0.05, "both side lanes read clear (safe lanes observable)");
  assert.equal(o[4], 1, "in-my-lane kind fires 'jump' for the center hazard");
}
console.log("PASS (2) encoder exposes per-lane danger");

// (2b) the legacy recenter control is still replayable for honest A/B
//      (hold:false restores the vendored readControls semantics).
{
  const api = loadGame({ seed: 7, hold: false });
  api.startRun();
  const env = new Env(); env.api = api; env.tick = 0;
  for (let i = 0; i < 10; i++) env.step("LEFT");
  const before = api.player.laneX;
  env.step("NOOP");
  assert.ok(Math.abs(api.player.laneX - before) > 0.05,
    "hold:false recenters toward 0 (legacy controller replayable: " +
    `${before.toFixed(3)} -> ${api.player.laneX.toFixed(3)})`);
}
console.log("PASS (2b) legacy recenter controller replayable via hold:false");

// (3) fitness rewards all-four coverage but penalises LEFT<->RIGHT flapping.
{
  const still = fitnessScore(12.0, 4, 0, cfg);
  const flappy = fitnessScore(12.0, 4, 200, cfg);
  const lazy = fitnessScore(12.0, 2, 0, cfg);
  assert.ok(flappy < still, "200 switches reduce fitness");
  assert.ok(still > lazy, "using both sides beats one side (coverage rewarded)");
}
console.log("PASS (3) fitness penalises oscillation, rewards coverage");
console.log("ANTI-JITTER OK");