// Shared game constants + pure helpers (imported by js/game.js, js/controller.js,
// and the Node tests). Beat-Saber convention: a note's COLOR tells the brain
// WHICH saber (cyan=L / rose=R); the LANE tells WHERE (left / centre / right).
export const HIT_Z = -7.2;       // slicing plane
export const WIN = 2.05;         // +/- window around the plane counts as a slice
export const SPAWN_Z = -46;
export const SPEED = 15.78;      // worlds/sec
export const PASS_Z = HIT_Z + WIN;   // past here unsliced = miss
export const SIM_DT = 1 / 60;
export const COOLDOWN = 0.14;
export const BEAT = 60 / 122;    // seconds between beats (BPM 122)

export const LANES = { L: -1.45, C: 0, R: 1.45 };
export const COLORS = { L: 0x48e5ff, C: 0x5fd7e6, R: 0xff638e };

export const laneFor = name => LANES[name];
export function colorFor(lane) {   // which saber the brain must use for a note in `lane`
  if (lane === 'C') return Math.random() < 0.5 ? 'L' : 'R';
  return lane;
}
// Weighted spawn: 30% left, 40% centre, 30% right (inject an rng for tests).
export function spawnChoice(r = Math.random) {
  const u = r();
  return u < 0.3 ? 'L' : u < 0.7 ? 'C' : 'R';
}