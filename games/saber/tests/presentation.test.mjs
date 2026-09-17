import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
test('SABER4FLIES names the game and IMMORTAL FRUIT FLIES names the project', () => {
  assert.equal(html.match(/<title>(.*?)<\/title>/)?.[1], 'SABER4FLIES · Autonomous Flight');
  assert.equal(html.match(/<h1>(.*?)<\/h1>/)?.[1], 'SABER4FLIES');
  assert.ok(html.includes('IMMORTAL FRUIT FLIES $FLIES'));
  assert.doesNotMatch(html, /Fruit Fly Saber|FRUIT FLY <span>\/</);
});
test('presentation retains experimental caveats, attribution and strict blade semantics', () => {
  assert.match(html, /Not a whole brain or validated muscle simulation/);
  assert.match(html, /Left blade: cyan only\. Right blade: rose only\. Hits require physical contact/);
  assert.match(html, /HUMAN GAMEPLAY DISABLED/);
  assert.match(html, /ATTRIBUTION\.md/);
  assert.match(html, /Modeled activity, not measured fly behavior/);
});
