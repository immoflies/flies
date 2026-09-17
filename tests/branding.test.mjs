import test from 'node:test';
import assert from 'node:assert/strict';
import {renderLanding,renderPicker,renderHtml} from '../scripts/build-live.mjs';
test('landing uses the requested title and shortened copy', () => {
 const home = renderLanding();
 assert.equal(home.match(/<title>(.*?)<\/title>/s)[1], 'IMMORTAL FRUIT FLIES · $FLIES');
 assert.ok(home.includes('<p>$FLIES is the ticker. The fields here are provisional and informational—not an offer, and not financial advice.</p>'));
 assert.ok(home.includes('<p>Nothing on this page is financial or legal advice.  These are an experiment, not a validated result: the runner’s benchmark is an archived control, and SABER4FLIES has an unresolved motor acceptance gate — the arms can still drift at idle and right-center reach is unreliable.</p>'));
});
test('token card: deleted items gone, HOLDER→DIVIDEN, NAME left / $FLIES right', () => {
  const home = renderLanding();
  assert.doesNotMatch(home, /FLY-BRAIN GAMES/);                    // hero eyebrow removed
  assert.doesNotMatch(home, /<dt>STATUS<\/dt>/);                   // STATUS row removed
  assert.doesNotMatch(home, /placeholder \u00b7 pending/);         // contract note removed
  assert.doesNotMatch(home, /<dt>HOLDER<\/dt>/);                   // label renamed
  assert.match(home, /<dt>DIVIDEN<\/dt><dd>0\.4%<\/dd>/);          // DIVIDEN row
  assert.match(home, /Rewards to Holders/);                        // DIVIDEN subtitle
  assert.match(home, /class="token-name"/);                        // name|ticker pair row
  assert.match(home, /<dt>NAME<\/dt><dd>IMMORTAL FRUIT FLIES<\/dd>/); // name on the left
  assert.match(home, /<dt>TICKER<\/dt><dd>\$FLIES<\/dd>/);         // $FLIES stays (right)
  assert.match(home, /<dt>CONTRACT<\/dt><dd><code>0x400000000000000000000000000000000000000<\/code><\/dd>/); // contract row intact
});
test('brand and provisional token details are honest across generated pages',()=>{
 const home=renderLanding(),picker=renderPicker(),runner=renderHtml();

 for(const html of [home,picker,runner]) {
  assert.match(html,/IMMORTAL FRUIT FLIES/);
  assert.doesNotMatch(html,/FruitFlyWeb|FRUITFLYWEB|FF\//);
 }
 assert.match(picker,/SABER4FLIES/);
 assert.match(picker,/fly.*plays/i);
 for(const s of ['id="onchain"','id="disclaimer"','0x400000000000000000000000000000000000000','GOOGL','0.6%','0.4%','$FLIES']) assert.ok(home.includes(s),s);
 assert.doesNotMatch(home,/launched by the fly|own wallet|No token has been issued|1,000,000 \$FLIES|OPEN ON THE LAUNCHPAD/i);
 assert.match(home,/provisional/i);
 assert.match(home,/not financial advice/i);
 assert.equal((home.match(/<p(?:\s[^>]*)?>/g)||[]).length,(home.match(/<\/p>/g)||[]).length,'paragraph tags balance');
});
