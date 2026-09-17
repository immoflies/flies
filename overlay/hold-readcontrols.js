/* hold-readcontrols.js — steering-hold overlay (shipped in the live.js bundle
 * AND appended to the headless game source so offline training sees the SAME
 * control semantics as the live page).
 *
 * The vendored game lerps player.laneX toward 0 whenever no horizontal key is
 * held (readControls returns targetLane = 0), so NOOP/JUMP/DUCK all DRIFT the
 * fly back toward the center lane. To hold a safe side lane the old scheme
 * forced the policy to keep re-outputting LEFT/RIGHT, and any jump/duck floated
 * it out of its lane. This overlay inverts the default: NO horizontal key
 * means HOLD the current lane; only an explicit LEFT/RIGHT changes lane.
 *
 *   - LEFT/RIGHT            -> steer toward that lane
 *   - JUMP/DUCK / NOOP      -> stay in the current lane (never re-center)
 *   - bodyPresent (camera)  -> original vision autopilot, unless steering
 *
 * vendor/jurassic-runner/game.js remains byte-identical; this ships as an
 * overlay (same mechanism as the draw and crash overrides).
 */
function readControls(ts) {
  var kbHeld = KB.left || KB.right || KB.jump || KB.duck;
  usingKb = kbHeld || ts - lastKbDown < 200;
  var wantJump = false, wantDuck = false, targetLane;
  if (usingKb) { wantJump = KB.jump; wantDuck = KB.duck; }
  if (KB.left || KB.right) {
    targetLane = (KB.left ? -1 : 0) + (KB.right ? 1 : 0);
  } else if (bodyPresent) {
    var d = steer - 0.5;
    d = Math.sign(d) * Math.max(0, Math.abs(d) - LANE_DEAD);
    targetLane = clamp(d * LANE_GAIN, -1, 1);
    bodyYSmooth = lerp(bodyYSmooth, bodyY, 0.4);
    wantJump = baselineY - bodyYSmooth > JUMP_THRESH;
    wantDuck = bodyYSmooth - baselineY > DUCK_THRESH;
  } else {
    // AUTO / released keys: no horizontal input -> HOLD the current lane.
    targetLane = clamp(player.laneX, -1, 1);
  }
  return { targetLane, wantJump, wantDuck };
}