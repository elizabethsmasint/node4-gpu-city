export const colors={add:'#eeae53',fill:'#bd91e8',matmul:'#58cfb2',reduction:'#f17870',copy:'#78bcea',triton:'#e1e86b',gdn:'#f192b9',multiply:'#77c7cc',elementwise:'#94b78c',other:'#8f9aa9'};
export const categories=Object.keys(colors);
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const num=(n,d=0)=>n==null?'Unavailable':Number(n).toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d});
export const ms=n=>n==null?'Unavailable':num(n/1e6,3)+' ms';
export const duration=n=>n==null?'Unavailable':n<1e6?num(n/1e3,3)+' µs':ms(n);
export const bytes=n=>n==null?'Unavailable':n>=1048576?num(n/1048576,2)+' MiB':n>=1024?num(n/1024,2)+' KiB':num(n)+' B';
export const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export function lowerBound(a,x,key=v=>v){let l=0,r=a.length;while(l<r){const m=(l+r)>>>1;if(key(a[m])<x)l=m+1;else r=m;}return l;}
export function upperBound(a,x,key=v=>v){let l=0,r=a.length;while(l<r){const m=(l+r)>>>1;if(key(a[m])<=x)l=m+1;else r=m;}return l;}
export function prepare(data){
 validate(data);
 data.operators??=[];data.memory??=[];data.issues??=[];data.hardware??=[];data.phase_note??='Model phase ranges unavailable.';for(const g of data.groups)g.semantics??={formula:'dispatch → execute → complete',explanation:'Exact computation unavailable for this imported implementation.',dependency:'Temporal order is not a proven buffer dependency.'};
 data.prefixEnd=[];data.byGroup=data.groups.map(()=>[]);let end=-Infinity;
 data.events.forEach((e,i)=>{end=Math.max(end,e[0]+e[1]);data.prefixEnd.push(end);data.byGroup[e[2]].push(i);});
 const apiKeys=new Set();data.apiEvents=[];for(const e of data.events){if(e[5]!=null){const key=`${e[4]}:${e[5]}:${e[6]}`;if(!apiKeys.has(key)){apiKeys.add(key);data.apiEvents.push([e[5],e[6]]);}}}data.apiEvents.sort((a,b)=>a[0]-b[0]);data.apiPrefix=[];let apiEnd=-Infinity;for(const a of data.apiEvents){apiEnd=Math.max(apiEnd,a[0]+a[1]);data.apiPrefix.push(apiEnd);}
 // Keep device and stream identity, including unknown IDs, for execution-order views.
 const lanes=new Map();
 data.events.forEach((e,i)=>{const key=`${e[8]??'?'}:${e[3]??'?'}`;let lane=lanes.get(key);if(!lane){lane={key,device:e[8],stream:e[3],indices:[],prefixEnd:[],known:e[8]!=null&&e[3]!=null,end:-Infinity};lanes.set(key,lane);}lane.end=Math.max(lane.end,e[0]+e[1]);lane.indices.push(i);lane.prefixEnd.push(lane.end);});
 data.streamLanes=[...lanes.values()];data.streams=data.streamLanes.map(l=>l.key);
 return data;
}
export function validate(d){
 if(d.schema_version!==1||!Array.isArray(d.events)||!Array.isArray(d.groups)||!Number.isSafeInteger(d.duration_ns)||d.duration_ns<=0)throw Error('Expected GPU City schema v1. Convert the source trace with normalize.py first.');
 if(d.groups.some((g,i)=>g.id!==i||typeof g.name!=='string'||!colors[g.category]))throw Error('Invalid kernel groups or category.');
 let last=-1,total=0;const counts=d.groups.map(()=>0);
 for(const e of d.events){if(!Array.isArray(e)||e.length<9||!Number.isSafeInteger(e[0])||!Number.isSafeInteger(e[1])||e[0]<last||e[1]<0||e[0]+e[1]>d.duration_ns||!d.groups[e[2]])throw Error('Invalid, unsorted or out-of-bounds event data.');last=e[0];total+=e[1];counts[e[2]]++;}
 if(d.stats?.kernel_count!==d.events.length||d.stats?.kernel_sum_ns!==total||d.groups.some((g,i)=>g.count!==counts[i]))throw Error('Trace totals do not match event records.');
 return true;
}
export function eventRange(data,start,end,instant=false){
 const events=data.events;
 const lo=upperBound(data.prefixEnd,start),hi=instant?upperBound(events,end,e=>e[0]):lowerBound(events,end,e=>e[0]);
 const result=[];
 for(let i=lo;i<hi;i++){const e=events[i];if(e[0]+e[1]>start&&(instant?e[0]<=end:e[0]<end))result.push(i);}
 return result;
}
export function groupMatches(g,category,query){return(category==='all'||g.category===category)&&(!query||`${g.name} ${g.label} ${g.mangled??''} ${g.semantics?.explanation??''}`.toLowerCase().includes(query.toLowerCase()));}
export function nextIndex(indices,current,direction){const p=direction>0?upperBound(indices,current):lowerBound(indices,current)-1;return p>=0&&p<indices.length?indices[p]:null;}
export function zoomRange(start,end,center,factor,total){const span=clamp((end-start)*factor,1000,total);const relative=(center-start)/(end-start||1);const a=clamp(center-span*relative,0,total-span);return[a,a+span];}
export function advance(time,elapsedMs,speed,total){return clamp(time+elapsedMs*1e6*speed,0,total);}
export function compareTime(t,total,referenceTotal,relative){return relative?clamp(t/referenceTotal*total,0,total):clamp(t,0,total);}
export function reduction(before,after){return before===0||before==null||after==null?null:(before-after)/before*100;}
export function aggregate(data,indices,range=null){const map=new Map();for(const i of indices){const e=data.events[i];const entry=map.get(e[2])??{group:data.groups[e[2]],count:0,time:0,event:i};entry.count++;entry.time+=range?Math.max(0,Math.min(e[0]+e[1],range[1])-Math.max(e[0],range[0])):e[1];map.set(e[2],entry);}return[...map.values()].sort((a,b)=>b.time-a.time);}
// Collapse repeated signatures for display only. All events remain in the trace.
export function operationFamilies(orders){const map=new Map();for(const order of orders){const category=order.group.category;let family=map.get(category);if(!family){family={category,count:0,time:0,representative:order};map.set(category,family);}family.count+=order.count;family.time+=order.time;if(order.time>family.representative.time)family.representative=order;}return[...map.values()].sort((a,b)=>b.time-a.time||categories.indexOf(a.category)-categories.indexOf(b.category));}
export function replayWindow(span,overview=false){return span>5e6?(overview?Math.min(100e6,span/20):span/1000):0;}
export function threads(g){return g.grid?.every(Number.isFinite)&&g.block?.every(Number.isFinite)?g.grid.reduce((a,b)=>a*b,1)*g.block.reduce((a,b)=>a*b,1):null;}
