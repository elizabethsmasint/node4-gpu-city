import {prepare,eventRange,nextIndex,zoomRange,advance,compareTime,reduction,groupMatches,aggregate,threads,validate,operationFamilies,replayWindow} from '../core.js';
let passed=0;
function equal(a,b,label){if(JSON.stringify(a)!==JSON.stringify(b))throw Error(`${label}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);passed++;}
function check(c,label){if(!c)throw Error(label);passed++;}
const data=prepare({schema_version:1,duration_ns:100,groups:[{id:0,name:'CUDAFunctor_add<float>',label:'FP32 add',category:'add',count:2,grid:[2,1,1],block:[128,1,1]},{id:1,name:'FillFunctor',category:'fill',count:1}],events:[[0,20,0,7,1,0,3,null,0],[10,30,1,8,2,8,3,null,0],[70,10,0,7,3,66,3,null,0]],stats:{kernel_count:3,kernel_sum_ns:60}});
equal(eventRange(data,15,15,true),[0,1],'Concurrent streams are simultaneously active');
equal(eventRange(data,20,20,true),[1],'End is exclusive');
equal(eventRange(data,70,70,true),[2],'Start is inclusive');
equal(eventRange(data,50,50,true),[],'Gaps do not light up factories');
equal(eventRange(data,0,100),[0,1,2],'Full interval');
equal(eventRange(data,25,75),[1,2],'Overlapping range includes early long event');
equal(nextIndex([0,2,7],2,1),7,'Next matching event');equal(nextIndex([0,2,7],2,-1),0,'Previous matching event');equal(nextIndex([0,2,7],7,1),null,'No end wrap');
equal(nextIndex([2,7],0,1),2,'Step from hidden event');
equal(advance(10,1,.1,1e9),100010,'Real 0.1x time scale');equal(advance(0,1,1000,1e10),1e9,'1000x time scale');equal(advance(99,10,1,100),100,'Clamp at capture end');
equal(advance(0,1000,.000001,1e9),1000,'Slowest playback advances one microsecond per real second');
equal(advance(0,1000,.00001,1e9),10000,'Extra slow playback advances ten microseconds per second');
equal(compareTime(50,50,100,true),25,'Relative progress');equal(compareTime(50,20,100,false),20,'Elapsed comparison ends independently');
equal(reduction(100,50),50,'Comparison reduction');equal(reduction(0,12),null,'Zero baseline unavailable');
check(groupMatches(data.groups[0],'add','float'),'Kernel name filtering');check(!groupMatches(data.groups[0],'fill','float'),'Category filter intersection');
equal(aggregate(data,[0,1,2]).map(g=>[g.group.id,g.count,g.time]),[[0,2,30],[1,1,30]],'Aggregate counts without replacing timestamps');
equal(aggregate(data,[0,1],[15,25]).map(g=>[g.group.id,g.count,g.time]),[[1,1,10],[0,1,5]],'Window ranking counts only overlapping duration, including concurrent work');
const repeated=[{group:{id:1,category:'add'},count:100,time:20,event:5},{group:{id:2,category:'fill'},count:3,time:70,event:9},{group:{id:3,category:'add'},count:200,time:40,event:12}];
const families=operationFamilies(repeated);
equal(families.map(f=>[f.category,f.count,f.time,f.representative.event]),[['fill',3,70,9],['add',300,60,12]],'Repeated signatures become one family with measured counts and representative launch');
equal(replayWindow(7e9,true),100e6,'Overview smooths full-step activity over 100 ms');
equal(replayWindow(7e9,false),7e6,'Full city retains fine-grained window');
equal(replayWindow(5e6,true),0,'Microscope remains exact in Overview');
equal(threads(data.groups[0]),256,'Grid and block thread count');equal(threads(data.groups[1]),null,'Missing config remains missing');
equal(zoomRange(0,100000,50000,.1,100000),[45000,55000],'Zoom stays centered');
equal(zoomRange(0,100000,100000,4,100000),[0,100000],'Zoom clamps to trace');
let rejected=false;try{validate({...data,stats:{kernel_count:3,kernel_sum_ns:99}});}catch{rejected=true;}check(rejected,'Import rejects incorrect duration sums');
// Canvas call compatibility and category branches use the same renderer as the UI.
import {City,Operation} from '../city.js';
globalThis.devicePixelRatio=1;
const ctx=new Proxy({},{get:(o,k)=>o[k]??(o[k]=()=>{}),set:(o,k,v)=>(o[k]=v,true)});
const canvas={width:0,height:0,getBoundingClientRect:()=>({width:800,height:550}),getContext:()=>ctx};
const city=new City(canvas,{detail:'full'});city.draw(aggregate(data,[0,1]),1,{smCount:48});equal(city.hits.length,48,'48 factory hit regions');check(city.hits.every(h=>Number.isFinite(h.x)&&Number.isFinite(h.y)),'Valid factory geometry');
const overview=new City(canvas);overview.draw(repeated,1);equal(overview.hits.length,2,'300 add launches use one workshop, with a separate fill workshop');
const first=overview.hits[0];equal(overview.hit(first.x,first.y).event,9,'Workshop opens its recorded representative');equal(overview.hit(0,0),undefined,'Overview background is not clickable');
const many=Object.keys((await import('../core.js')).colors).map((category,i)=>({group:{id:i,category},count:10+i,time:100-i,event:i}));
overview.draw(many,2);equal(overview.hits.length,4,'Overview caps animated workshops at four');equal(overview.families.length,10,'Families beyond the four workshops are preserved');
overview.draw([],3);equal(overview.hits.length,0,'Empty activity clears workshop selection targets');
for(const category of ['add','fill','matmul','reduction','copy','triton','gdn','multiply','elementwise','other']){const op=new Operation(canvas);op.set({name:category==='triton'?'_assemble_fwd':'example',category,semantics:{formula:'example',fill_value:0}});for(const dt of [1,2000,2000])check(typeof op.draw(dt)==='string',`${category} animation stage`);}
print(`PASS: ${passed} JavaScript logic and renderer checks`);
