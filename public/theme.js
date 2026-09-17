/* =====================================================================
 * Immortal Fruit Fly — theme overlay for the flyjump workbench.
 *
 * The vendored Jurassic Runner (vendor/jurassic-runner/game.js) stays
 * UNMODIFIED. This file is concatenated into live.js BY THE BUILD
 * (scripts/build-live.mjs) so it shares the game's top-level scope, and
 * its `function` declarations REPLACE the game's sprites:
 *
 *   drawBackground / drawPath  -> overripe-orchard dusk, faux-3D depth
 *   drawProp                   -> fallen fruit & leaf litter
 *   drawObstacle               -> three DISTINCT hazard languages
 *                                    jump = low ground barrier (hop over)
 *                                    duck = wide OVERHEAD trap (duck under)
 *                                    move = tall lane-blocker (dodge)
 *   drawRunner                 -> the fly FLIES: hover, bank, dive, climb
 *   drawChaser / drawTrex      -> giant predator fly
 *   render / crash             -> 3D depth + death text
 *
 * Pure rendering: none of these touch Math.random or mutation, so gameplay
 * and the trained READOUT are bit-identical (verified by test).
 * Two pure spec helpers power the flight feel and the hazard languages so
 * the unit test can assert them directly:
 *   iffPose(state, t)  -> { altitude, bank }  continuous flight geometry
 *   iffHazard(kind)    -> { top, bottom, width } overlap boxes per hazard
 * No top-level `let`/`const` here; only top-level `function` declarations.
 * ===================================================================== */

/* =====================================================================
 * SPEC — continuous flight geometry for the hero.
 * altitude is the fly's body-centre height above the lane surface (px);
 * bank is a roll for lane changes (neg = banking left). Pure: no RNG/state.
 * ===================================================================== */
function iffPose(s, t) {
  const lift = Math.max(0, s.jumpY) * 0.95;   // climb from the jump meter
  const airborne = !s.grounded;
  const bob = airborne ? 0 : Math.sin(t * 0.32) * 4;  // hovering bob
  const duckDip = s.ducking ? 15 : 0;                 // dive when ducking
  const altitude = (airborne ? 12 + lift * 0.9 : 12 + bob) - (airborne ? 0 : duckDip);
  const bank = clamp(s.laneX * 0.5, -1, 1);           // roll left / right with the lane
  return { altitude: Math.max(2, altitude), bank, airborne: !!airborne };
}

/* =====================================================================
 * SPEC — the three hazard languages, as the vertical overlap box the fly
 * must avoid (drawn at the fly plane, t = PLAYER_T). bottom = distance of
 * the hazard's LOWER edge above the surface line; top = its upper edge;
 * width = horizontal footprint.
 *   jump  low ground barrier  (bottom 0, short)    -> hop over it
 *   duck  wide OVERHEAD gap    (bottom high, wide) -> duck under it
 *   move  tall full blocker    (bottom 0, tall)    -> change lane
 * ===================================================================== */
function iffHazard(kind) {
  if (kind === "duck") return { top: 96, bottom: 44, width: 76 };   // flying bird, 44px clear gap
  if (kind === "move") return { top: 104, bottom: 0, width: 34 };   // wooden wall (slimmer, depth stays visible)
  return { top: 26, bottom: 0, width: 44 };                          // ground-level broken road + pond
}

/* =====================================================================
 * RENDER-ONLY PROJECTION SPEC (gameplay projection is untouched — the
 * vendor's laneToX/projHalf stay the single source of truth; these wrap
 * it so every drawn sprite, road edge and divider shares ONE projection).
 *   iffLaneX(lane, t)   exact vendor laneToX — lanes sit at ±1, ±0.5, 0
 *   iffRoadEdge(side,t) road edge = 3-lane extents, i.e. lane ±1.5
 *   iffScale(t)         sprite scale relative to the player plane
 * ===================================================================== */
function iffLaneX(lane, t) { return laneToX(lane, t); }
function iffRoadEdge(side, t) { return W / 2 + side * 1.5 * projHalf(t) * 0.52; }
function iffScale(t) { return projHalf(t) / projHalf(PLAYER_T); }

/* ---- tiny shared helpers ---- */
function js(v, k) { return (Math.sin(v + k * 1.3) * 0.5 + 0.5); }
function tpop(ctx, pts, close, fill) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
  if (fill) ctx.fill(); else ctx.stroke();
}
function iffillPs(ctx, col, x, y, w, h) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, col[0]); g.addColorStop(1, col[1]);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
}
// Ground-contact shadow. The sink (offset below the surface line) scales with
// `s` so a far hazard's shadow hugs its own ground line instead of poking below
// the player plane — keeps depth ordering truthful at every distance.
function ifShadow(ctx, x, groundY, w, h, a, off) {
  const sink = off === undefined ? 4 : off;   // px below the lane surface
  ctx.fillStyle = "rgba(0,0,0,1)"; ctx.globalAlpha = a;
  ctx.beginPath(); ctx.ellipse(x, groundY + sink, w, h, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}
function ifgrad(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (let i = 0; i + 1 < stops.length; i += 2) g.addColorStop(stops[i], stops[i + 1]);
  ctx.fillStyle = g; return g;
}
function teardrop(c, cx, cy, w, h, rot) {
  c.save(); c.translate(cx, cy); c.rotate(rot);
  c.beginPath();
  c.moveTo(-w * 0.5, 0);
  c.quadraticCurveTo(-w * 0.1, -h * 0.62, w * 0.28, -h * 0.55);
  c.quadraticCurveTo(w * 0.62, -h * 0.18, w * 0.5, 0);
  c.quadraticCurveTo(w * 0.28, h * 0.1, -w * 0.12, h * 0.18);
  c.quadraticCurveTo(-w * 0.42, h * 0.06, -w * 0.5, 0);
  c.closePath(); c.fill(); c.restore();
}

/* ============ the HERO: a 100-year-old fruit fly that FLIES ============ */
function drawRunner() {
  const t = PLAYER_T;
  const x = laneToX(player.laneX, t);
  const ground = projY(t);
  const s = projHalf(t) / projHalf(1) * 1.25;
  const rt = ((window.__IFF_RENDER_ALPHA || 0) * 0.5) + frameCount;         // interp-aware time
  const pose = iffPose(player, rt);

  const alt = pose.altitude;                       // body centre above lane
  const bodyY = ground - alt * s;

  // shadow shrinks & fades as the fly climbs (depth)
  const shA = clamp(0.34 - alt / 320, 0.06, 0.34);
  ifShadow(ctx, x, ground, 20 * s * clamp(1 - alt / 130, 0.35, 1), 6 * s, shA, 4 * s);

  // wing flutter — a soft double-exposure motion blur
  const flap = Math.sin(rt * 0.9);
  ctx.save();
  ctx.translate(x - 2 * s, bodyY);
  ctx.rotate(clamp(pose.bank * 0.28, -0.3, 0.3));
  // ghost wing then main wing (blur trail)
  ctx.globalAlpha = 0.16;
  teardrop(ctx, (pose.bank > 0 ? 4 : -4) * s, -6 * s, 22 * s, 16 * s, flap * 0.6);
  ctx.globalAlpha = 0.34;
  teardrop(ctx, 0, -6 * s, 22 * s, 16 * s, flap);

  // body (silver-grey, aged) — drawn slightly above the surface = hovering
  ctx.fillStyle = "#9aa0a6";
  ctx.beginPath(); ctx.ellipse(0, -2 * s, 11 * s, 7 * s, 0.15, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#8a8378";
  ctx.beginPath(); ctx.ellipse(-4 * s, -6 * s, 9 * s, 6 * s, -0.1, 0, Math.PI * 2); ctx.fill();
  // head
  ctx.fillStyle = "#7d7a72";
  ctx.beginPath(); ctx.ellipse(-10 * s, -9 * s, 6 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#a0483c";
  ctx.beginPath(); ctx.arc(-14 * s, -10 * s, 3.6 * s, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(-5 * s, -10 * s, 3.6 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,246,230,0.9)";
  ctx.beginPath(); ctx.arc(-15 * s, -11 * s, 1.2 * s, 0, Math.PI * 2); ctx.fill();
  // bent antennae (ageing)
  ctx.strokeStyle = "#5c5850"; ctx.lineWidth = 1.7 * s; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-12 * s, -12 * s); ctx.quadraticCurveTo(-18 * s, -17 * s, -14 * s, -20 * s); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-6 * s, -12 * s); ctx.quadraticCurveTo(-2 * s, -18 * s, -7 * s, -22 * s); ctx.stroke();
  // legs — dangling loose in flight, splayed when grounded
  ctx.strokeStyle = "#6b6a66"; ctx.lineWidth = 1.6 * s; ctx.lineCap = "round";
  for (const [lx, ph] of [[-6, 0], [0, 1.4], [6, 2.8]]) {
    const d = player.grounded ? 5 * s : 9 * s;
    ctx.beginPath(); ctx.moveTo(lx * s, 0);
    ctx.quadraticCurveTo(lx * s + Math.sin(rt + ph) * 3 * s, d * 0.5, lx * s + Math.sin(rt * 1.5 + ph) * 4 * s, d);
    ctx.stroke();
  }
  ctx.restore();
}

/* ============ three DISTINCT hazard languages ============ */
function drawJumpHazard(ctx2, x, y, s) {
  // a broken stretch of road filled with a pond (hop over it).
  ifShadow(ctx2, x, y, 34 * s, 5 * s, 0.34, 4 * s);
  // ragged broken-edge basin (jagged right edge = the gap in the road)
  const g = ctx2.createLinearGradient(x - 20 * s, y - 10 * s, x + 20 * s, y + 2 * s);
  g.addColorStop(0, "#6e5638"); g.addColorStop(1, "#40301e");
  ctx2.fillStyle = g;
  ctx2.beginPath();
  ctx2.moveTo(x - 22 * s, y);
  ctx2.lineTo(x - 18 * s, y - 4 * s);
  ctx2.lineTo(x - 6 * s, y - 12 * s);
  ctx2.lineTo(x + 6 * s, y - 8 * s);
  ctx2.lineTo(x + 14 * s, y - 13 * s);
  ctx2.lineTo(x + 22 * s, y - 5 * s);
  ctx2.lineTo(x + 22 * s, y);
  ctx2.closePath(); ctx2.fill();
  // pond water surface sitting flush at the tops of the broken edges
  const wg = ctx2.createLinearGradient(x - 17 * s, y - 11 * s, x + 17 * s, y - 11 * s);
  wg.addColorStop(0, "#2f5a52"); wg.addColorStop(0.5, "#3f6f66"); wg.addColorStop(1, "#2a4c47");
  ctx2.fillStyle = wg;
  ctx2.beginPath();
  ctx2.moveTo(x - 19 * s, y - 6 * s);
  ctx2.quadraticCurveTo(x - 8 * s, y - 13 * s, x + 3 * s, y - 11 * s);
  ctx2.quadraticCurveTo(x + 12 * s, y - 14 * s, x + 19 * s, y - 6 * s);
  ctx2.lineTo(x + 19 * s, y - 2 * s);
  ctx2.lineTo(x - 19 * s, y - 2 * s);
  ctx2.closePath(); ctx2.fill();
  // glints so water reads as liquid
  ctx2.strokeStyle = "rgba(230,244,238,0.55)"; ctx2.lineWidth = 1.6 * s; ctx2.lineCap = "round";
  ctx2.beginPath(); ctx2.moveTo(x - 11 * s, y - 7 * s); ctx2.lineTo(x - 3 * s, y - 8 * s); ctx2.stroke();
  ctx2.beginPath(); ctx2.moveTo(x + 5 * s, y - 9 * s); ctx2.lineTo(x + 11 * s, y - 8 * s); ctx2.stroke();
  // exposed rebar / jagged chip on the broken lip (readable "damaged road")
  ctx2.strokeStyle = "#4a3a2c"; ctx2.lineWidth = 2 * s; ctx2.lineCap = "round";
  ctx2.beginPath(); ctx2.moveTo(x - 15 * s, y - 2 * s); ctx2.lineTo(x - 9 * s, y - 5 * s); ctx2.stroke();
  ctx2.beginPath(); ctx2.moveTo(x + 10 * s, y - 1 * s); ctx2.lineTo(x + 15 * s, y - 4 * s); ctx2.stroke();
}
function drawDuckTrap(ctx2, x, y, s) {
  // a FLYING BIRD strung across the lane: duck UNDER it (bird stays aloft;
  // a ground-contact shadow tells you how far away it really is).
  const h = iffHazard("duck");
  const topY = y - h.top * s, botY = y - h.bottom * s, midY = (topY + botY) / 2;
  const flap = Math.sin(frameCount * 0.5) * 0.5;
  // ground-contact shadow (lanes, not overhead): shrinks with altitude
  ifShadow(ctx2, x, y, 26 * s * clamp(1 - h.top / 300, 0.45, 1), 4 * s, 0.22, 4 * s);
  // wings (upswept, above the body, flapping)
  const wg = ctx2.createLinearGradient(x - 8 * s, topY, x + 8 * s, topY);
  wg.addColorStop(0, "#e6e6e6"); wg.addColorStop(1, "#b9b3a8");
  ctx2.fillStyle = wg;
  ctx2.beginPath(); ctx2.moveTo(x, topY + 2 * s);
  ctx2.quadraticCurveTo(x - 22 * s, topY - (16 + flap * 16) * s, x - h.width * 0.36 * s, topY + 3 * s);
  ctx2.quadraticCurveTo(x - 4 * s, topY + 7 * s, x, topY + 3 * s);
  ctx2.closePath(); ctx2.fill();
  ctx2.beginPath(); ctx2.moveTo(x, topY + 2 * s);
  ctx2.quadraticCurveTo(x + 22 * s, topY - (16 + flap * 16) * s, x + h.width * 0.36 * s, topY + 3 * s);
  ctx2.quadraticCurveTo(x + 4 * s, topY + 7 * s, x, topY + 3 * s);
  ctx2.closePath(); ctx2.fill();
  // body (bird): tucked toward the bottom of the overhead box
  ctx2.fillStyle = "#6d6a60";
  ctx2.beginPath(); ctx2.ellipse(x, midY + 6 * s, h.width * 0.30 * s, 11 * s, 0, 0, Math.PI * 2); ctx2.fill();
  ctx2.fillStyle = "#e8e4da";
  ctx2.beginPath(); ctx2.ellipse(x - 8 * s, midY + 4 * s, 8 * s, 9 * s, 0, 0, Math.PI * 2); ctx2.fill();
  ctx2.beginPath(); ctx2.arc(x - 14 * s, midY + 4 * s, 4 * s, 0, Math.PI * 2); ctx2.fill();
  // beak (amber) pointing toward travel
  ctx2.fillStyle = "#c98b2e";
  ctx2.beginPath(); ctx2.moveTo(x - 18 * s, midY + 3 * s); ctx2.lineTo(x - 26 * s, midY + 2 * s); ctx2.lineTo(x - 16 * s, midY + 8 * s); ctx2.closePath(); ctx2.fill();
  // eye
  ctx2.fillStyle = "#d9d3c8";
  ctx2.beginPath(); ctx2.arc(x - 10 * s, midY + 1 * s, 2.4 * s, 0, Math.PI * 2); ctx2.fill();
  ctx2.fillStyle = "#141312";
  ctx2.beginPath(); ctx2.arc(x - 10 * s, midY + 1 * s, 1.2 * s, 0, Math.PI * 2); ctx2.fill();
  // feet — dangle beneath the body toward the lane (readable as overhead)
  ctx2.strokeStyle = "#b9a24a"; ctx2.lineWidth = 1.6 * s; ctx2.lineCap = "round";
  ctx2.beginPath(); ctx2.moveTo(x - 4 * s, botY - 4 * s); ctx2.lineTo(x - 6 * s, botY + 1 * s); ctx2.stroke();
  ctx2.beginPath(); ctx2.moveTo(x + 4 * s, botY - 6 * s); ctx2.lineTo(x + 6 * s, botY + 1 * s); ctx2.stroke();
  // thin lower fringe: the "duck under me" line
  ctx2.strokeStyle = "rgba(74,72,64,0.65)"; ctx2.lineWidth = 1.8 * s;
  ctx2.beginPath(); ctx2.moveTo(x - h.width * 0.5 * s, botY); ctx2.lineTo(x + h.width * 0.5 * s, botY); ctx2.stroke();
}
function drawMovePlant(ctx2, x, y, s) {
  // a tall WOODEN WALL blocking the lane — must change lane.
  ifShadow(ctx2, x, y, 26 * s, 5 * s, 0.32, 4 * s);
  const h = iffHazard("move");
  const topY = y - h.top * s;
  // weathered plank (vertical grain, slightly tapered toward the top)
  const g = ctx2.createLinearGradient(x - 9 * s, topY, x + 9 * s, y);
  g.addColorStop(0, "#8f7a50"); g.addColorStop(0.5, "#a08b5c"); g.addColorStop(1, "#6e5a38");
  ctx2.fillStyle = g;
  ctx2.beginPath();
  ctx2.moveTo(x - 11 * s, y);
  ctx2.lineTo(x - 8 * s, topY + 8 * s);
  ctx2.lineTo(x - 5 * s, topY);
  ctx2.lineTo(x + 5 * s, topY);
  ctx2.lineTo(x + 8 * s, topY + 8 * s);
  ctx2.lineTo(x + 14 * s, y);
  ctx2.closePath(); ctx2.fill();
  // vertical plank seams + grain (reads as timber)
  ctx2.strokeStyle = "rgba(84,66,40,0.7)"; ctx2.lineWidth = 1.4 * s; ctx2.lineCap = "round";
  for (const off of [-5, 1]) {
    ctx2.beginPath(); ctx2.moveTo(x + off * s, y - 6 * s); ctx2.lineTo(x + off * s, topY + 10 * s); ctx2.stroke();
  }
  ctx2.strokeStyle = "rgba(96,78,48,0.5)"; ctx2.lineWidth = 1.1 * s;
  for (let i = -3; i <= 3; i++) {
    ctx2.beginPath(); ctx2.moveTo(x + i * 2.5 * s, y - i * 2 * s); ctx2.quadraticCurveTo(x + (i + 2) * 2 * s, y - (i + 3) * 3 * s, x + (i % 2 ? 2 : -2) * s, topY + (2 + i) * 5 * s); ctx2.stroke();
  }
  // flat plank top cap + a nail dot
  ctx2.fillStyle = "#7a6846";
  ctx2.fillRect(x - 6 * s, topY - 4 * s, 12 * s, 5 * s);
  ctx2.fillStyle = "rgba(40,32,22,0.7)";
  ctx2.beginPath(); ctx2.arc(x, topY - 1.5 * s, 1.4 * s, 0, Math.PI * 2); ctx2.fill();
  // a small grass tuft by the base anchors it to the ground line
  ctx2.strokeStyle = "#5c7640"; ctx2.lineWidth = 1.6 * s; ctx2.lineCap = "round";
  ctx2.beginPath(); ctx2.moveTo(x - 17 * s, y); ctx2.quadraticCurveTo(x - 18 * s, y - 6 * s, x - 15 * s, y - 10 * s); ctx2.stroke();
  ctx2.beginPath(); ctx2.moveTo(x + 15 * s, y); ctx2.quadraticCurveTo(x + 16 * s, y - 6 * s, x + 13 * s, y - 10 * s); ctx2.stroke();
}
function drawObstacle(o) {
  const x = laneToX(o.lane, o.t);
  const y = projY(o.t);
  const s = iffScale(o.t);
  if (s < 0.02) return;
  if (o.avoid === "duck") return drawDuckTrap(ctx, x, y, s);
  if (o.avoid === "move") return drawMovePlant(ctx, x, y, s);
  drawJumpHazard(ctx, x, y, s);
}

/* ============ the giant predator fly (chase + death) ============ */
function drawGiantPredator(cx, groundY, sc, open, runP) {
  ctx.save(); ctx.translate(cx, groundY); ctx.scale(sc, sc);
  const flap = Math.sin(runP * 0.6) * 0.5 + 0.5;
  teardrop(ctx, -34, -150, 60, 40, -0.6 + flap * 0.3);
  teardrop(ctx, 34, -150, 60, 40, 0.6 + flap * 0.3);
  ctx.fillStyle = "#3a2c26";
  ctx.beginPath(); ctx.moveTo(-52, -84); ctx.quadraticCurveTo(0, -28 + open, 52, -84); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#c98b2e";
  for (let i = 0; i < 5; i++) ctx.fillRect(-42, -64 + i * 9, 84, 2.6);
  ctx.fillStyle = "#54423a"; ctx.beginPath(); ctx.ellipse(0, -130, 42, 34, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#2f2824"; ctx.beginPath(); ctx.ellipse(0, -174, 32, 27, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#c23b2e"; ctx.beginPath(); ctx.arc(-14, -186, 13, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(14, -186, 13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,240,230,0.9)";
  ctx.beginPath(); ctx.arc(-17, -189, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(11, -189, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#c98b2e"; ctx.lineWidth = 6; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-13, -162); ctx.lineTo(-24, -122 - open); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(13, -162); ctx.lineTo(24, -122 - open); ctx.stroke();
  ctx.strokeStyle = "#3a3a40"; ctx.lineWidth = 7;
  for (let i = 0; i < 3; i++) { const b = -26 + i * 26; ctx.beginPath(); ctx.moveTo(b, -62); ctx.lineTo(b - 28, 8 + (i % 2) * 8); ctx.lineTo(b - 36, 36); ctx.stroke(); }
  ctx.restore();
}
function drawChaser() {
  const f = frameCount, surge = Math.max(0, Math.sin(f * 0.025)), lunge = surge * surge;
  drawGiantPredator(W / 2 - player.laneX * 30 + Math.sin(f * 0.04) * 26, H + 120 - lunge * 170 + Math.sin(f * 0.3) * 4, 0.62, 24 + lunge * 42, f * 0.3);
}
function drawTrex() {
  const p = clamp((1.36 - trexT) / 0.4, 0, 1);
  drawGiantPredator(W / 2 - 285 * (0.8 + p * 0.5) + player.laneX * 14, H + 120 - p * 360, 0.8 + p * 0.5, 30 + p * 50 + Math.sin(frameCount * 0.3) * 6, frameCount * 0.4);
}

/* ============ backdrop: overripe orchard at dusk, with depth ============ */
function drawOldTree(cx, cy, sc) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc);
  ctx.strokeStyle = "#4a3826"; ctx.lineWidth = 7; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -56); ctx.stroke();
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, -44); ctx.lineTo(-22, -62); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(22, -64); ctx.stroke();
  const g = ctx.createLinearGradient(0, -102, 0, -56);
  g.addColorStop(0, "#4a4630"); g.addColorStop(1, "#5c5436");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(-11, -84, 22, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(12, -86, 20, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -98, 18, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#a3442d";
  for (let i = 0; i < 3; i++) { const hx = -14 + i * 12, hy = -60 + (i % 2) * 5; ctx.beginPath(); ctx.arc(hx, hy, 4, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}
function drawBackground() {
  ifgrad(ctx, 0, 0, 0, HORIZON + 70, [0, "#241f33", 0.45, "#5b3c4a", 0.8, "#c8773f", 1, "#e8a84f"]);
  ctx.fillRect(0, 0, W, HORIZON + 70);
  ctx.fillStyle = "rgba(255,214,150,0.9)";
  ctx.beginPath(); ctx.arc(W * 0.34, HORIZON - 20, 44, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,236,200,0.5)";
  ctx.beginPath(); ctx.arc(W * 0.34, HORIZON - 20, 28, 0, Math.PI * 2); ctx.fill();
  ifgrad(ctx, 0, HORIZON - 70, 0, HORIZON + 40, [0, "rgba(240,170,110,0)", 0.6, "rgba(240,180,120,0.35)", 1, "rgba(170,110,70,0.05)"]);
  ctx.fillRect(0, HORIZON - 70, W, 110);
  const par = -player.laneX * 26;
  drawOldTree(((frameCount * 0.05 + 130) % (W + 360)) - 180 + par * 0.15, HORIZON - 2, 0.45);
  drawOldTree(((frameCount * 0.18) % (W + 320)) - 160 + par * 0.5, HORIZON - 4, 0.9);
  drawOldTree(W + 160 - ((frameCount * 0.12) % (W + 320)) + par * 0.5, HORIZON - 2, 1.05);
  drawOldTree(W * 0.55 + par * 0.7, HORIZON - 6, 0.62);
  for (let i = 0; i < 10; i++) {
    const fy = HORIZON - ((frameCount * 0.6 + i * 41) % (H - HORIZON + 140)) * 0.9;
    const fx = (i * 71 + worldScroll * 0.01 * (i % 3 + 1)) % (W + 60) - 30;
    ctx.fillStyle = "rgba(255,200,120,1)"; ctx.globalAlpha = 0.5 * (0.4 + 0.6 * js(frameCount * 0.1, i));
    ctx.beginPath(); ctx.arc(fx, fy, 1.2 + (i % 2), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ============ the avenue: faux-3D converging road ============ */
function drawPath() {
  ifgrad(ctx, 0, HORIZON, 0, H, [0, "#7a5f40", 1, "#4f3824"]);
  ctx.fillRect(0, HORIZON, W, H - HORIZON);
  // road body spans the full 3-lane extents (lane ±1.5) at EVERY depth —
  // same projection as hazards, so lanes never spill onto the verge.
  ctx.beginPath();
  ctx.moveTo(iffRoadEdge(-1, 0), projY(0));
  for (let t = 0; t <= 1.0001; t += 0.05) ctx.lineTo(iffRoadEdge(-1, t), projY(t));
  for (let t = 1; t >= 0; t -= 0.05) ctx.lineTo(iffRoadEdge(1, t), projY(t));
  ctx.closePath();
  ifgrad(ctx, 0, HORIZON, 0, H, [0, "#8a6a44", 1, "#5c4128"]); ctx.fill();
  // dirt speckles that grow toward the viewer (depth)
  ctx.fillStyle = "rgba(60,40,22,0.5)";
  for (let i = 0; i < 26; i++) {
    const tt = ((i * 47 + worldScroll * 0.02) % 1000) / 1000, tt2 = ((i * 91 + worldScroll * 0.02) % 1000) / 1000;
    const lane = ((i * 13) % 2 ? 1 : -1) * (0.2 + (i * 7) % 50 * 0.03);
    ctx.beginPath(); ctx.arc(iffLaneX(lane * 0.9, tt2) + (i * 3) % 7, projY(tt2), (0.8 + tt * 3.2) * 1.4, 0, Math.PI * 2); ctx.fill();
  }
  // perspective depth markers: full-width cross rings at receding depths
  // (spacing compresses toward the horizon so speed is readable).
  const period = 0.11;
  const off = ((worldScroll * 0.0009) % period + period) % period;
  for (let t = off; t <= 1; t += period) {
    ctx.beginPath();
    ctx.lineWidth = 1 + t * 5;
    ctx.moveTo(iffRoadEdge(-1, t), projY(t));
    ctx.lineTo(iffRoadEdge(1, t), projY(t));
    ctx.stroke();
  }
  // lane dividers BETWEEN the lanes at lane ±0.5 (NOT the vendor's lane ±1, so
  // each divider marks the true boundary of the lane the fly moves through).
  // 0.05-depth vertices keep them perfectly aligned with the road-edge polylines.
  ctx.strokeStyle = "rgba(232,196,128,0.75)"; ctx.lineCap = "round";
  for (const d of [-0.5, 0.5]) {
    ctx.save(); ctx.lineWidth = 3; ctx.beginPath();
    ctx.moveTo(iffLaneX(d, 0), projY(0));
    let pen = true;
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const px = iffLaneX(d, t), py = projY(t);
      if (pen) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      pen = !pen;
    }
    ctx.stroke(); ctx.restore();
  }
}

/* ============ props: fallen fruit & leaf litter ============ */
function drawProp(p) {
  const x = edgeX(p.side, p.t) + p.side * p.off * projHalf(p.t);
  const y = projY(p.t); const s = projHalf(p.t) / projHalf(1) * 1.1;
  if (s < 0.02) return;
  if (p.kind === "bush") {
    ifShadow(ctx, x, y, 16 * s, 4 * s, 0.28, 4 * s);
    ctx.fillStyle = "#8a4a2a"; ctx.beginPath(); ctx.arc(x, y - 4 * s, 7 * s, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 9 * s, y - 3 * s, 5.5 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#b33a2a"; ctx.beginPath(); ctx.arc(x - 4 * s, y - 5 * s, 3.6 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#4c2818"; ctx.beginPath(); ctx.arc(x - 1 * s, y - 6 * s, 1.6 * s, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.save(); ctx.rotate(0.4);
    ctx.strokeStyle = "#6f5f33"; ctx.lineWidth = 3 * s; ctx.lineCap = "round";
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + i * 12 * s, y - 30 * s, x + i * 22 * s, y - 50 * s); ctx.stroke(); }
    ctx.restore();
  }
}

/* ============ death / ready text ============ */
function crash(ts) {
  phase = "dead"; restartAt = ts + 3000; trexT = 1.3; action = "CAUGHT";
  overlayTitle.textContent = "CAUGHT!";
  overlayText.textContent = "Survived " + elapsed.toFixed(1) + "s and scored " + score +
    ". A fruit-fly predator got you — restarting in 3s.";
  startBtn.style.display = "none"; overlay.classList.remove("hidden");
  if (window.Jungle) Jungle.roar();
}

/* belt-and-suspenders: guarantee the overrides are the live bindings */
if (typeof window !== "undefined") {
  window.drawRunner = drawRunner;
  window.drawBackground = drawBackground;
  window.drawPath = drawPath;
  window.drawProp = drawProp;
  window.drawObstacle = drawObstacle;
  window.drawChaser = drawChaser;
  window.drawTrex = drawTrex;
  window.crash = crash;
  window.iffPose = iffPose;
  window.iffHazard = iffHazard;
  window.iffLaneX = iffLaneX;
  window.iffRoadEdge = iffRoadEdge;
  window.iffScale = iffScale;
}