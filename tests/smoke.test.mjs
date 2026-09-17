// Smoke test: load the game headlessly, drive it with idle controls, verify determinism.
import { loadGame } from "../lib/game-adapter.mjs";

function step(api, steps, dt = 16.67) {
  let died = false;
  for (let i = 0; i < steps; i++) {
    api.update(api._clock() + dt);
    api._setClock(api._clock() + dt);
    if (api.phase === "dead") { died = true; break; }
  }
  return { died, score: api.score, elapsed: api.elapsed, obstacles: api.obstacles.length, phase: api.phase };
}

function loadAndRun(seed) {
  const api = loadGame({ seed });
  api.startRun();
  return step(api, 6000);
}

const a1 = loadAndRun(7);
const a2 = loadAndRun(7);
const b = loadAndRun(8);

console.log("run(seed=7)->", a1);
console.log("re-run(seed=7)->", a2);
console.log("run(seed=8)->", b);
console.log("deterministic(7==7):", JSON.stringify(a1) === JSON.stringify(a2));
console.log("distinct(7!=8):", JSON.stringify(a1) !== JSON.stringify(b));

// Show what idle play looks like (player just runs; will crash into first obstacle)
console.log("idle survival:", a1);