import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {makeRng} from '../lib/game-adapter.mjs';
const root=new URL('../',import.meta.url);
export function boot(themed=true){
 const calls=[];const stack=[];let matrix=[1,0,0,1,0,0];
 const point=(x,y)=>{assert(Number.isFinite(x)&&Number.isFinite(y),'finite drawing coordinates');const[a,b,c,d,e,f]=matrix;calls.push([a*x+c*y+e,b*x+d*y+f]);};
 const ctx=new Proxy({}, {get(t,k){if(k in t)return t[k];return (...a)=>{
 if(k==='save')stack.push(matrix.slice());
 else if(k==='restore'){assert(stack.length,'balanced canvas restore');matrix=stack.pop();}
 else if(k==='translate'){matrix[4]+=matrix[0]*a[0]+matrix[2]*a[1];matrix[5]+=matrix[1]*a[0]+matrix[3]*a[1];}
 else if(k==='scale'){matrix[0]*=a[0];matrix[1]*=a[0];matrix[2]*=a[1];matrix[3]*=a[1];}
 else if(k==='rotate'){const[c,s]=[Math.cos(a[0]),Math.sin(a[0])];const[m,n,o,p]=matrix;matrix[0]=m*c+o*s;matrix[1]=n*c+p*s;matrix[2]=o*c-m*s;matrix[3]=p*c-n*s;}
 else if(['arc','ellipse','moveTo','lineTo','fillRect','rect'].includes(k))point(a[0],a[1]);
 else if(k==='quadraticCurveTo'){point(a[0],a[1]);point(a[2],a[3]);}
 else if(k==='bezierCurveTo'){point(a[0],a[1]);point(a[2],a[3]);point(a[4],a[5]);}
 return ctx;};},set(t,k,v){t[k]=v;return true;}});
 const els={};const el=id=>els[id]??={width:520,height:680,value:'2',style:{},classList:{add(){},remove(){}},addEventListener(){},getContext:()=>ctx};
 const math=Object.create(Math);math.random=makeRng(42);
 const sb={document:{getElementById:el,querySelector:()=>el('stage'),addEventListener(){}},navigator:{mediaDevices:{getUserMedia:async()=>{throw Error('offline');}}},location:{hostname:'localhost'},WebSocket:function(){},Math:math,performance:{now:()=>0},setTimeout(){},setInterval(){},requestAnimationFrame(){},console};
 sb.window=sb;sb.addEventListener=()=>{};
 vm.createContext(sb);
 vm.runInContext(readFileSync(new URL('vendor/jurassic-runner/game.js',root),'utf8')+(themed?'\n'+readFileSync(new URL('public/theme.js',root),'utf8'):'')+'\nwindow.api={player,KB,startRun,update,render,drawRunner,drawObstacle,drawPath,get obstacles(){return obstacles},get state(){return [phase,score,elapsed,player.laneX,player.jumpY,player.ducking,obstacles]}};',sb);
 return {sb,api:sb.api,calls,stack};
}
const b=boot();b.api.startRun();
assert.equal(typeof b.sb.iffPose,'function','flight pose must expose continuous altitude/bank geometry');
const normal=b.sb.iffPose({...b.api.player},0);
const duck=b.sb.iffPose({...b.api.player,ducking:true},0);
const climb=b.sb.iffPose({...b.api.player,jumpY:50,vy:5,grounded:false},0);
assert(normal.altitude>0,'fly hovers above surface, not walking');
assert(duck.altitude<normal.altitude,'duck visibly dives');
assert(climb.altitude>normal.altitude+40,'jump visibly climbs');
assert(b.sb.iffPose({...b.api.player,laneX:-1},0).bank<0,'left banks left');
assert(b.sb.iffPose({...b.api.player,laneX:1},0).bank>0,'right banks right');
for(const kind of ['jump','duck','move']){
 const h=b.sb.iffHazard(kind);
 if(kind==='jump')assert(h.bottom===0&&h.top<=30,'jump is low grounded barrier');
 if(kind==='duck')assert(h.bottom>=40&&h.width>=70,'duck has wide overhead obstacle and clear gap');
 if(kind==='move')assert(h.bottom===0&&h.top>=100,'dodge obstacle blocks full height');
 for(const t of [.02,.3,.65,.9,1.1])b.api.drawObstacle({kind:'rock',avoid:kind,lane:0,t,seed:1});
}
for(const p of [{},{jumpY:70,vy:5,grounded:false},{ducking:true},{laneX:-1},{laneX:1}]){
 Object.assign(b.api.player,{laneX:0,jumpY:0,vy:0,grounded:true,ducking:false},p);
 b.api.drawRunner();b.api.render(1000);
 assert.equal(b.stack.length,0,'canvas transforms balanced');
}
assert(b.calls.length>100,'renderer actually emits geometry');
// Rendering must not change RNG or simulation: compare full seeded traces.
const original=boot(false),themed=boot(true);original.api.startRun();themed.api.startRun();
for(let i=0;i<1500;i++){
 for(const x of [original,themed]){x.api.KB.left=i%100<25;x.api.KB.right=i%100>=75;x.api.KB.jump=i%77<25;x.api.KB.duck=i%77>50;x.api.update(i*1000/60);}
 themed.api.render(i*1000/60);
 assert.equal(JSON.stringify(themed.api.state),JSON.stringify(original.api.state),`physics/RNG unchanged tick ${i}`);
}
console.log('PASS: hover/climb/dive/banking; distinct hazard geometry; transformed drawing safety; 1500-tick physics/RNG parity');
