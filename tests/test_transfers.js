import {transferProgress} from '../transfers.js';
import {Operation} from '../city.js';
let passed=0;
function check(value,label){if(!value)throw Error(label);passed++;}
const add={category:'add',name:'add_kernel',semantics:{}};
let progress=transferProgress(add,900);
check(progress.phase==='load'&&progress.gpu>0&&progress.gpu<1&&progress.dram===0,'Input tile loads before any output writes');
progress=transferProgress(add,2750);
check(progress.phase==='compute'&&progress.gpu===1&&progress.dram===0,'Compute retains loaded inputs and leaves output unwritten');
progress=transferProgress(add,4500);
check(progress.phase==='store'&&progress.gpu===1&&progress.dram>0&&progress.dram<1,'Store fills DRAM while retaining inputs');
check(transferProgress(add,5400).dram===1,'Completed output holds at 100% before the next tile');
check(transferProgress(add,5500).gpu===1&&transferProgress(add,5500).dram===1,'Completed tile stays full at its old loop boundary');
check(transferProgress(add,550000).dram===1,'Completed tile never wraps after many cycles');
const fill={category:'fill',name:'fill_kernel',semantics:{fill_value:0}};
check(transferProgress(fill,900).gpu===null&&transferProgress(fill,900).dram===0,'Fill prepares a scalar without inventing input reads');
check(transferProgress(fill,2750).phase==='store'&&transferProgress(fill,2750).dram>0,'Fill writes after scalar preparation');
for(const group of [{category:'other',name:'opaque'},{category:'triton',name:'unknown_custom'},{category:'elementwise',name:'unknown_elementwise'}]){
 progress=transferProgress(group,4000);
 check(!progress.known&&progress.gpu===null&&progress.dram===null,'Unrecovered operation has no invented transfer percentages');
}
for(const category of ['add','multiply','matmul','reduction','copy','gdn'])check(transferProgress({category,name:category},900).known,`${category} has a representative tile cycle`);
check(transferProgress({category:'triton',name:'_assemble_bwd'},900).known,'Known Triton assembly has input/output phases');
check(transferProgress({category:'elementwise',name:'exp_kernel'},900).known,'Exponential has input/output phases');
const ctx=new Proxy({},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
globalThis.devicePixelRatio=1;
const canvas={width:280,height:164,getBoundingClientRect:()=>({width:280,height:164}),getContext:()=>ctx};
const operation=new Operation(canvas);operation.set(add);operation.draw(900);operation.running=false;
const paused=transferProgress(operation.group,operation.time);operation.draw(3000);
check(JSON.stringify(paused)===JSON.stringify(transferProgress(operation.group,operation.time)),'Pausing operation freezes transfer fractions');
operation.set(fill);
check(operation.time===0&&transferProgress(operation.group,operation.time).dram===0,'Selecting another kernel resets the transfer cycle');
check(operation.draw(0).startsWith('PREPARE'),'Fill illustration agrees with scalar preparation phase');
operation.running=true;
check(operation.draw(5400).includes('24 / 24'),'Fill illustration and DRAM box reach completion together');
print(`PASS: ${passed} transfer semantics and animation synchronization checks`);
