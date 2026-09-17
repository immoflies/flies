import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three.module.js';
import { COLORS } from '../js/config.js';
import { ArmRig } from '../js/arm.js';

// Execute the actual scene construction with real Three geometry/materials.
// Only the WebGL renderer/DOM are excluded; no mock geometry or color config.
const source = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('const glow ='), source.indexOf('/* ---- dark neon runway'));
const assembly = source.slice(source.indexOf('const ARM_SPAN ='), source.indexOf('/* ---- fruit notes'));
const fly = new THREE.Group(); fly.position.set(0, 1.65, -4.85);
const scene = new THREE.Scene(); scene.add(fly);
const armRig = new ArmRig();
const context = vm.createContext({ THREE, COLORS, fly, scene, armRig });
vm.runInContext(helpers + assembly + ';globalThis.rigs = arms; globalThis.update = frameArmKinematics;', context);
const width = mesh => Math.max(mesh.geometry.parameters.radiusTop, mesh.geometry.parameters.radiusBottom);

for (const [side, color] of [['L', 0x48e5ff], ['R', 0xff638e]]) {
  test(`${side} saber has a visible ${side === 'L' ? 'cyan' : 'rose'} halo outside its opaque core`, () => {
    const cylinders = context.rigs[side].wrist.children.filter(o => o.isMesh && o.geometry.type === 'CylinderGeometry');
    const halos = cylinders.filter(o => o.material.transparent && o.material.opacity > 0);
    assert.ok(halos.length >= 2, `${side}: needs layered colored halo, not an enclosing white cylinder`);
    const opaque = cylinders.filter(o => !o.material.transparent);
    const widestOpaque = Math.max(...opaque.map(width));
    for (const halo of halos) {
      assert.equal(halo.material.color.getHex(), color, 'side hue is visible, not white');
      assert.ok(width(halo) > widestOpaque, 'glow extends beyond opaque core');
      assert.equal(halo.material.blending, THREE.AdditiveBlending);
      assert.equal(halo.material.depthWrite, false, 'glow does not mask core or other layers');
      assert.equal(halo.material.depthTest, true, 'scene occlusion still respected');
      assert.equal(halo.material.toneMapped, false, 'ACES does not wash out the hue');
      assert.ok(halo.material.opacity >= 0.1 && halo.material.opacity < 1);
      assert.equal(halo.geometry.parameters.height, 1.3, 'glow keeps blade length');
    }
  });
}
test('visual layers do not move the physical blade contact markers', () => {
  context.update();
  for (const side of ['L', 'R']) {
    const a = context.rigs[side];
    assert.deepEqual(a.base.position.toArray(), [0, 0, 0]);
    assert.deepEqual(a.tip.position.toArray(), [0, 0, -1.3]);
    assert.equal(a.base.parent, a.wrist);
    assert.equal(a.tip.parent, a.wrist);
    assert.ok(Math.abs(new THREE.Vector3(...a.worldBase).distanceTo(new THREE.Vector3(...a.worldTip)) - 1.3) < 1e-12);
  }
});
