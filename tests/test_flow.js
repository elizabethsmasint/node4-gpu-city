import {prepare,advance} from '../core.js';
import {executionFlow,flowSummary,drawFlow,kernelDependencies} from '../flow.js';
let passed=0;
function check(v,label){if(!v)throw Error(label);passed++;}
function equal(a,b,label){check(JSON.stringify(a)===JSON.stringify(b),`${label}: ${JSON.stringify(a)}`);}
function trace(events){return prepare({schema_version:1,duration_ns:300,groups:[{id:0,name:'add',label:'Add',category:'add',count:events.length}],events,stats:{kernel_count:events.length,kernel_sum_ns:events.reduce((n,e)=>n+e[1],0)}});}
const data=trace([
 [10,50,0,7,0,0,5,null,0],
 [20,60,0,8,1,8,5,null,0], // Independent, overlapping stream.
 [30,40,0,7,2,8,5,null,1], // Same stream ID on a different device.
 [65,10,0,7,3,15,5,null,0],
 [80,20,0,7,4,21,2,null,0],
 [120,10,0,7,5,110,5,null,0],
 [140,10,0,7,6,null,null,null,0],
]);
let f=executionFlow(data,25,'0:7');
equal(f.nodes.map(n=>n?.event??null),[null,0,3,4],'Stream order skips other devices and streams');
equal(f.nodes.map(n=>n?.status??null),[null,'running','waiting','waiting'],'Submitted kernels wait behind running work');
equal(f.nodes[2].blocker,0,'First queued kernel identifies running prerequisite');
equal(f.nodes[3].blocker,3,'Next queued kernel identifies immediate prerequisite');
equal(f.edges.map(e=>[e.from,e.to]),[[0,3],[3,4]],'No edges cross devices or streams');
check(flowSummary(f,data).includes('#4 Add is waiting for #1 Add'),'Readable named wait summary');
f=executionFlow(data,15,'0:7');equal(f.nodes[2].status,'launching','API entry alone is not established submission');
f=executionFlow(data,20,'0:7');equal(f.nodes[2].status,'waiting','API completion establishes submission at inclusive boundary');
f=executionFlow(data,60,'0:7');equal(f.nodes.map(n=>n?.status??null),['done',null,'queued','waiting'],'GPU end is exclusive; a queued kernel with completed predecessor has unknown cause');
check(f.nodes[2].blocker===null&&f.nodes[2].detail.includes('not recorded'),'Gap is not falsely blamed on a completed kernel');
f=executionFlow(data,65,'0:7');equal(f.nodes[1].event,3,'GPU start activates the next kernel at inclusive boundary');
f=executionFlow(data,90,'0:7');equal(f.nodes[2].status,'future','Future host calls are not labeled waiting');
equal(f.nodes[3].status,'unknown','Missing API timestamps remain unknown');
f=executionFlow(data,300,'0:7');equal(f.nodes.map(n=>n?.status??null),['done',null,null,null],'End of capture has no invented upcoming work');
check(flowSummary(f,data).includes('finished'),'Completed stream summary');
f=executionFlow(data,0,'0:7');equal(f.nodes[2].status,'launching','Leading capture interval handles host launch');
const unknown=trace([[10,10,0,null,0,0,1,null,null],[25,10,0,null,1,0,1,null,null]]);
f=executionFlow(unknown,15);check(!f.lane.known&&f.edges.length===0&&f.nodes[2].blocker===null,'Unknown stream/device cannot prove a dependency');
const overlap=trace([[0,30,0,7,0,0,1,null,0],[10,20,0,7,1,0,1,null,0],[40,10,0,7,2,0,1,null,0]]);
f=executionFlow(overlap,5);check(!f.edges.some(e=>e.from===0&&e.to===1)&&f.nodes[2].status==='queued','Overlapping intervals do not fabricate serial blockers');
f=executionFlow(overlap,15);equal(f.activeCount,2,'Concurrent intervals remain visible in the summary');
check(!f.edges.some(e=>e.from===0&&e.to===1)&&f.edges.some(e=>e.from===1&&e.to===2),'Overlaps suppress only the affected edge, preserving valid later order');
const enclosing=trace([[0,100,0,7,0,0,1,null,0],[10,10,0,7,1,0,1,null,0],[120,10,0,7,2,0,1,null,0]]);
f=executionFlow(enclosing,30);check(f.nodes[1].event===0&&f.nodes[1].status==='running'&&f.activeCount===1,'A long-running kernel survives later short intervals');
equal(executionFlow(trace([]),0).nodes,[null,null,null,null],'Empty imports render empty slots');
// Exercise real renderer bounds and direction in both layouts and on a narrow canvas.
for(const detail of ['overview','full'])for(const [w,h] of [[800,455],[660,455],[619,680],[320,680]]){
 const coords=[];const ctx=new Proxy({},{get:(o,k)=>o[k]??((...args)=>{if(['fillRect','roundRect'].includes(k))coords.push(args);}),set:(o,k,v)=>(o[k]=v,true)});
 const result=drawFlow(ctx,w,h,executionFlow(data,25,'0:7'),1,{detail,selected:3});
 check(result.hits.length===3,`${detail} ${w}: each real kernel is selectable`);
 check(result.hits.every(n=>n.x-n.w/2>=0&&n.x+n.w/2<=w&&n.y-n.h/2>=0&&n.y+n.h/2<=h),`${detail} ${w}: cards stay on canvas`);
 check(coords.every(a=>a.every(Number.isFinite)&&a[2]>=0&&a[3]>=0),`${detail} ${w}: drawing dimensions are finite and nonnegative`);
}
let dependencies=kernelDependencies(data,3,25);
equal(dependencies.nodes.map(n=>n?.event),[0,3,4],'Selected dependency chain skips other streams and devices');
check(dependencies.nodes[1].status==='waiting'&&dependencies.edges[0].waiting,'Selected queued launch names its running prerequisite');
dependencies=kernelDependencies(data,3,200);
equal(dependencies.nodes.map(n=>n?.event),[0,3,4],'Dependency focus stays pinned when the clock is elsewhere');
check(dependencies.edges.every(e=>e.satisfied&&!e.waiting),'Completed prerequisites are distinct from active waits');
dependencies=kernelDependencies(data,0,25);
check(dependencies.nodes[0]===null&&dependencies.edges.length===1,'First launch has no fabricated predecessor');
dependencies=kernelDependencies(data,6,25);
check(dependencies.nodes[2]===null&&dependencies.nodes[1].status==='unknown','Last launch and absent submission timing stay explicit');
dependencies=kernelDependencies(overlap,1,15);
check(dependencies.edges.length===1&&dependencies.edges[0].from===1,'Selected dependency view suppresses overlapping edges only');
check(kernelDependencies(unknown,1,15).edges.length===0,'Unknown identity cannot establish selected-kernel dependencies');
check(kernelDependencies(trace([]),0,15).nodes.length===0,'Empty trace has no dependency nodes');
print(`PASS: ${passed} waiting chain and selected dependency checks`);
