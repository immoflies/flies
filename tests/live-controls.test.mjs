import vm from 'node:vm';
import assert from 'node:assert/strict';
import { makeRng } from '../lib/game-adapter.mjs';
import { assembleLive } from '../scripts/build-live.mjs';
// Validate the EXACT assembled bundle (runtime.js overlay + agent decide hook):
// assembleLive() is what the build writes to public/live.js, drawn from source
// so the test stays valid before/after the parent's rebuild.
const source=assembleLive();
export function boot(seed=1) {
 const rotations=[];const events={};const els={};const intervals=[];let now=0;
 const ctx=new Proxy({}, {get:(t,k)=>k in t?t[k]:(...args)=>{if(k==='rotate')rotations.push(args[0]);return ctx;},set:(t,k,v)=>(t[k]=v,true)});
 const el=id=>els[id]??=( {width:520,height:680,style:{},value:'2',classList:{add(){},remove(){}},getContext:()=>ctx,addEventListener:(e,fn)=>{events[id+e]=fn;}} );
 const math=Object.create(Math);math.random=makeRng(seed);
 const sandbox={document:{getElementById:el,querySelector:()=>el('stage'),addEventListener(){}},navigator:{mediaDevices:{getUserMedia:async()=>{throw Error('no camera');}}},location:{hostname:'localhost'},WebSocket:function(){},Math:math,performance:{now:()=>now},setInterval:fn=>intervals.push(fn),setTimeout:()=>0,requestAnimationFrame:()=>0,console};
 sandbox.window=sandbox;sandbox.addEventListener=(e,fn)=>events[e]=fn;
 vm.createContext(sandbox);vm.runInContext(source+'\nwindow.testApi={get player(){return player},get phase(){return phase},get elapsed(){return elapsed},update,startRun,drawRunner,KB};',sandbox);
 return {sandbox,api:sandbox.testApi,rotations,events,tick(){now+=1000/60;sandbox.testApi.update(now);},decide(){sandbox.__FLYJUMP.decide();}};
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 const counts=[0,0,0,0,0];let rightFrames=0,leftFrames=0;
 for(let seed=2100001;seed<2100031;seed++){
  const b=boot(seed);b.api.startRun();
  for(let i=0;i<3600&&b.api.phase!=='dead';i++){
   if(i%2===0){b.decide();counts[b.sandbox.__FLYJUMP.decision.action]++;}
   b.tick();rightFrames+=b.api.player.laneX>0.4;leftFrames+=b.api.player.laneX< -0.4;
  }
 }
 console.log(JSON.stringify({actions:['NOOP','LEFT','RIGHT','JUMP','DUCK'],counts,rightFrames,leftFrames}));
 const b=boot();b.api.startRun();b.api.KB.right=true;for(let i=0;i<20;i++)b.tick();assert(b.api.player.laneX>0.9,'RIGHT control moves character right');
 assert(counts[2]>0&&rightFrames>0,'trained policy must actually select RIGHT and enter right lane');
 assert(counts[1]>0&&leftFrames>0,'trained policy must actually select LEFT and enter left lane');
 assert(counts[3]>0,'trained policy must JUMP');
 assert(counts[4]>0,'trained policy must DUCK');
 const b2=boot();b2.api.startRun();b2.api.KB.left=true;for(let i=0;i<20;i++)b2.tick();assert(b2.api.player.laneX< -0.9,'LEFT control moves character left');
 console.log('PASS: left/right controls and full action coverage (LEFT/RIGHT/JUMP/DUCK)');
}
