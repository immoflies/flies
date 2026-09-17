/* =====================================================================
 * runtime.js — refresh-independent live game clock + agent scheduler.
 *
 * scripts/build-live.mjs concatenates this AFTER theme.js into the single
 * live.js script so everything shares one top-level scope. The ONLY bindings
 * that can override the vendored game are TOP-LEVEL `function` declarations
 * here — a later declaration hoists over the earlier one for the whole file.
 * That is exactly why `frame`, `connectWS`, `initCam` and `maybeSend` are
 * declared at top level: the vendored load-time calls (`connectWS(); initCam();
 * requestAnimationFrame(frame)` at its tail) resolve to THESE versions.
 *
 * (Internal clock state is kept in an IIFE + window hooks, never in the way.)
 *
 * Responsibilities (game physics / graph / champion untouched):
 *   1. Fixed 60 Hz simulation clock — game.update() runs 60 times per
 *      real-time second regardless of the display's frame rate
 *      (30 / 60 / 120 / 144 Hz all produce the SAME 60 sim updates/s).
 *   2. Agent scheduling — the trained decide() runs every 2 sim ticks
 *      (~30 decisions/s), replacing the old setInterval(decide, 32).
 *   3. No catch-up on resume — a timestamp gap larger than GAP_MS (hidden
 *      tab, throttled background tab, initial load, long GC) is treated as a
 *      pause and skips the accumulated time instead of bursting updates.
 *   4. Optional smooth-render interpolation hook — window.__IFF_RENDER_ALPHA
 *      is the 0..1 fraction toward the next sim tick each display frame, so
 *      the (parent-owned) theme can interpolate between ticks for smooth
 *      motion on high-refresh displays without breaking the fixed-step sim.
 *   5. Disable unnecessary camera / WebSocket startup (no permission prompt,
 *      no :8765 socket), and reset the circuit's activity buffer per run.
 * ===================================================================== */
(function () {
  "use strict";

  const STEP = 1000 / 60;   // fixed 60 Hz simulation timestep (ms)
  const GAP_MS = 250;       // gaps larger than this are a pause, never catch-up
  const MAX_STEPS = 8;      // safety cap on update()s per display frame

  // ---- pure, testable fixed-step clock (independent instances) ----
  // Tests drive synthetic display rates through MakeClock without touching the
  // live loop. advance(now) returns { updates, alpha, tick }:
  //   updates = number of 60 Hz sim ticks to run (0 while merely waiting),
  //   alpha   = sub-tick fraction toward the next tick, for draw interpolation.
  function MakeClock() {
    let last = null, acc = 0, tick = 0, alpha = 0;
    function reset(now) { last = now; acc = 0; alpha = 0; }
    function advance(now) {
      if (last === null) { last = now; tick = 0; alpha = 0; return { updates: 0, alpha: 0, tick: 0 }; }
      let dt = now - last;
      last = now;
      if (dt > GAP_MS) { acc = 0; alpha = 0; return { updates: 0, alpha: 0, tick }; }
      acc += dt;
      let updates = 0;
      while (acc >= STEP && updates < MAX_STEPS) { acc -= STEP; updates++; tick++; }
      alpha = acc / STEP;
      return { updates, alpha, tick };
    }
    return {
      reset, advance, STEP,
      get tick() { return tick; },
      get alpha() { return alpha; },
    };
  }

  window.__IFF_MAKE_CLOCK = MakeClock;
  window.__IFF_STEP = STEP;
  window.__IFF_LIVE_CLOCK = MakeClock();   // the single live accumulator
})();

/* ---- neutralize camera / WebSocket startup (TOP-LEVEL => hoists over the
 *      vendor's load-time connectWS()/initCam() calls): no getUserMedia
 *      permission prompt, no :8765 socket on this agent-driven page. ---- */
function connectWS() { ws = null; wsReady = true; }
function initCam() { camReady = true; return Promise.resolve(true); }
function maybeSend() {}

/* ---- reset the circuit per run (offline determinism unaffected) ----
 * Wrap startRun so a fresh run zeroes the circuit's activity buffer. Offline
 * coverage tests boot a fresh VM per seed, so this never changes policy counts;
 * live it stops one run's stale circuit state leaking into the next. */
var __iffOrigStartRun = startRun;
startRun = function () {
  __iffOrigStartRun();
  var J = window.__FLYJUMP;
  if (J && typeof J.resetCircuit === "function") J.resetCircuit();
};

/* ---- fixed 60 Hz frame loop (TOP-LEVEL `function frame` replaces the
 *      vendored `frame`: hoisting makes the tail's requestAnimationFrame(frame)
 *      bind to THIS one). ---- */
var __iffTick = 0;            // cumulative simulation-tick counter (per update)
var __iffDecidedTick = -1;    // last tick a decision was taken on
var __iffLiveClock = window.__IFF_LIVE_CLOCK;

/* ---- human-input separation. The AGENT writes KB directly, so `usingKb`
 *      (set whenever any key is held) is true for agent actions too — gating
 *      decide() on it would wedge auto-play after the first non-idle decision
 *      (the fly would hold one key forever). Only REAL keydown events set
 *      __iffHuman; we cede the wheel to the human for 200 ms after one and let
 *      auto resume after. The agent never triggers this signal. ---- */
var __iffHuman = -9999;
try {
  window.addEventListener("keydown", function (e) {
    var k = e && e.key;
    if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown" || k === " ") __iffHuman = performance.now();
  });
} catch (_) {}
window.__IFF_NOTE_HUMAN_INPUT = function () { __iffHuman = performance.now(); };
window.__IFF_HUMAN_ACTIVE = function () { return performance.now() - __iffHuman < 200; };

function frame(ts) {
  const r = __iffLiveClock.advance(ts);
  // publish optional render-interpolation alpha + clock telemetry
  window.__IFF_RENDER_ALPHA = r.alpha;
  window.__IFF_CLOCK_STATE = r;

  if (r.updates) {
    for (let i = 0; i < r.updates; i++) {
      update(ts);
      __iffTick++;
      // agent decides every 2 sim ticks (~30 decisions/s at 60 Hz sim) —
      // cede only to a REAL keypress (auto resumes ~200ms after release).
      if ((__iffDecidedTick < 0 || __iffTick - __iffDecidedTick >= 2) && !window.__IFF_HUMAN_ACTIVE()) {
        const J = window.__FLYJUMP;
        if (J && typeof J.decide === "function") { J.decide(); __iffDecidedTick = __iffTick; }
      }
    }
  }

  render(ts); // themed scene: current sim state (+ __IFF_RENDER_ALPHA to smooth)
  requestAnimationFrame(frame);
}

window.__IFF_FRAME = frame; // reference the replacement loop (diagnosis only)

// ===== Sound: muted on load; the header SOUND button flips it manually =====
// Vendored Jungle (audio.js) exposes only toggle(); calling it once at boot
// puts the engine in a known muted state BEFORE any autoplay, then the button
// unmutes. Guarded so headless boots (no audio.js) stay inert.
(function () {
  function syncSound(on) {
    var b = document && document.getElementById && document.getElementById("audio-toggle");
    if (!b) return;
    b.textContent = on ? "SOUND: ON" : "SOUND: OFF";
    if (b.setAttribute) b.setAttribute("aria-pressed", on ? "true" : "false");
  }
  if (!window.Jungle) return;
  try { syncSound(!window.Jungle.toggle()); } catch (_) { syncSound(false); }
  var btn = document && document.getElementById && document.getElementById("audio-toggle");
  if (btn && btn.addEventListener) btn.addEventListener("click", function () {
    var m = false;
    try {
      m = window.Jungle.toggle();
      // unmuting => ensure the engine is actually running so sound is audible
      if (!m && window.Jungle.start) window.Jungle.start();
    } catch (_) {}
    syncSound(!m);
  });
})();
