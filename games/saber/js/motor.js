// Lane-aware sensory encoding for the motor loop. Eight channels cover the
// 3 lanes x 2 colors so the circuit can distinguish, e.g., a cyan note in the
// centre lane from a cyan note on the left — the information needed for the
// forelegs to physically reach middle-lane fruit with either blade.
//   c0 L(cyan) urg | c1 L imm | c2 C cyan urg | c3 C rose urg
//   c4 C cyan imm | c5 C rose imm | c6 R(rose) urg | c7 R imm
import { HIT_Z } from './config.js';
export function motorSenses(notes) {
  const inp = new Array(8).fill(0);
  const urg = n => Math.max(0, Math.min(1, (n.z + 46) / (HIT_Z + 46)));
  const imm = (n, u) => n.z > HIT_Z ? u : u * 0.45;
  for (const n of notes) {
    if (n.done || n.z > HIT_Z + 0.2) continue;
    const u = urg(n);
    if (n.lane === 'L') { inp[0] = Math.max(inp[0], u); inp[1] = Math.max(inp[1], imm(n, u)); }
    else if (n.lane === 'R') { inp[6] = Math.max(inp[6], u); inp[7] = Math.max(inp[7], imm(n, u)); }
    else if (n.side === 'L') { inp[2] = Math.max(inp[2], u); inp[4] = Math.max(inp[4], imm(n, u)); }
    else { inp[3] = Math.max(inp[3], u); inp[5] = Math.max(inp[5], imm(n, u)); }
  }
  return inp;
}