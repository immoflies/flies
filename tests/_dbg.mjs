import { readFileSync } from "node:fs";
const PANELS_SRC = readFileSync(new URL("../public/panels.js", import.meta.url), "utf8");
const instrumented = PANELS_SRC.replace(/\}\)\(\);\s*$/, `window.__PANELS_TEST = { brainGeom, makeProj, renderBrain, convexHull2D: typeof convexHull2D === "function" ? convexHull2D : undefined }; })();`);
function makeCanvas(w=300,h=150){const r=[];const ctx={canvas:null,globalAlpha:1,lineWidth:1,fillStyle:"#000",strokeStyle:"#000",font:"",setTransform:(...a)=>r.push(["setTransform",...a]),clearRect:(...a)=>r.push(["clearRect",...a]),beginPath:()=>r.push(["beginPath"]),moveTo:(...a)=>r.push(["moveTo",...a]),lineTo:(...a)=>r.push(["lineTo",...a]),closePath:()=>r.push(["closePath"]),stroke:()=>r.push(["stroke"]),fill:()=>r.push(["fill"]),arc:(...a)=>r.push(["arc",...a]),fillText:(...a)=>r.push(["fillText",...a]),drawImage:(img,...a)=>r.push(["drawImage",...a])};const el={width:w,height:h,_record:r,getContext:()=>ctx};ctx.canvas=el;return el;}
function makeFlyjump(){const N_IN=2,N_HID=2,N_OUT=5;const W=new Array(N_HID*(N_IN+1)+N_OUT*(N_HID+1)).fill(0.1);return {decision:{inputs:[0.1,0.8],hidden:[0.3,0.3],scores:[.1,.2,.3,.4,.5],action:0,activity:[.2,.2,.2,.2,.2,.2]},weights:W,positions:[[0,0,0],[10,0,0],[10,10,0],[0,10,0],[5,5,4],[2,2,-3]],roles:["input","interneuron","output","input","interneuron","output"],edges:[[0,1],[1,2],[2,3],[3,0],[0,2]],inputLabels:["a","b"],actions:["NOOP","LEFT","RIGHT","JUMP","DUCK"],N_IN,N_HID,N_OUT,brainYaw:0,brainZoom:1,connected:true};}
function load(dpr=1){const brain=makeCanvas(420,300);brain.clientWidth=420;brain.clientHeight=300;const J=makeFlyjump();const q=[];const win={devicePixelRatio:dpr,__FLYJUMP:J,addEventListener:()=>{}};const doc={createElement:t=>makeCanvas(),getElementById:id=>id==="brain-scene"?brain:undefined};new Function("window","document","requestAnimationFrame",instrumented)(win,doc,cb=>q.push(cb));return {win,J,q,brain};}
const {win,J,q,brain}=load();
q.shift()();
let layer=brain._record.find(c=>c[0]==="drawImage")[1];
const builds=()=>layer._record.filter(c=>c[0]==="setTransform").length;
console.log("initial",builds());
const steps=[
  ()=>{win.devicePixelRatio=2;},
  ()=>{brain.clientWidth=600;},
  ()=>{J.brainYaw=0.001;},
  ()=>{J.brainZoom=1.001;},
  ()=>{J.positions=[[0,0,0],[5,5,5]]; J.edges=[[0,1]];},
];
for(const s of steps){q.shift()();console.log("-> builds",builds());}
for(let i=0;i<3;i++){q.shift()();console.log("settle",i,builds());}
