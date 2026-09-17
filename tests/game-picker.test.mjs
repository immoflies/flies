import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as build from '../scripts/build-live.mjs';
const read = p => readFileSync(new URL('../'+p, import.meta.url),'utf8');
test('Open Monitor offers two separate games without booting either', () => {
  assert.equal(typeof build.renderPicker,'function');
  const html=build.renderPicker();
  for(const s of ['runner/','saber/','IMMORTAL FRUIT FLIES','SABER4FLIES','Experimental','Choose a game']) assert.ok(html.includes(s),s);
  assert.doesNotMatch(html, /<script|<iframe|<canvas/);
  const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size);
  assert.match(build.renderHtml(),/href="\.\.\/monitor\//);
});
test('GAME 01 is FLYINGFLIES while the project branding stays unchanged', () => {
  for (const html of [build.renderPicker(), build.renderLanding()]) {
    assert.ok(html.includes('<h2>FLYINGFLIES</h2>'), 'GAME 01 card title');
    assert.ok(html.includes('aria-label="Open FLYINGFLIES live monitor"'));
    assert.ok(html.includes('IMMORTAL FRUIT FLIES'), 'project branding retained');
  }
  assert.ok(build.renderLanding().includes('FLYINGFLIES dodges looming threats'));
});
test('Saber is an in-repo runtime snapshot, with navigation and licenses', () => {
  for(const p of ['index.html','js/game.js','js/brain.js','js/arm.js','js/motor.js','js/contact.js','js/config.js','js/panels.js','data/connectome.json','data/motor-readout.json','vendor/three.module.js','ATTRIBUTION.md']) assert.ok(existsSync(new URL('../games/saber/'+p,import.meta.url)),p);
  const html=read('games/saber/index.html');
  assert.match(html,/href="\.\.\/monitor\//);
  assert.match(html,/href="\.\.\/"/);
  assert.match(html,/integration.css/);
  assert.match(html,/Experimental/i);
  assert.doesNotMatch(read('scripts/build-live.mjs'),/\/home\/hermes|\.\.\/fruitfly-saber/);
});
