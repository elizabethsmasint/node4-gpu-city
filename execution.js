import {lowerBound,upperBound} from './core.js';
export function union(intervals,total=Infinity){
 const out=[];
 for(let [a,b] of intervals.sort((a,b)=>a[0]-b[0])){a=Math.max(0,a);b=Math.min(total,b);if(b<=a)continue;if(out.length&&a<=out.at(-1)[1])out.at(-1)[1]=Math.max(out.at(-1)[1],b);else out.push([a,b]);}
 return out;
}
export function complement(intervals,total){const out=[];let t=0;for(const [a,b] of union(intervals,total)){if(a>t)out.push([t,a]);t=b;}if(t<total)out.push([t,total]);return out;}
const laneKey=(device,stream,context,process)=>`${device??'?'}:${stream??'?'}:${context??'?'}:${process??'?'}`;
export function executionModel(data){
 if(data.executionModel)return data.executionModel;
 const nodes=data.events.map((e,i)=>({id:'k'+i,kind:'kernel',event:i,start:e[0],end:e[0]+e[1],device:e[8],stream:e[3],context:e[9],process:e[10],correlation:e[4],group:e[2],label:data.groups[e[2]].label,category:data.groups[e[2]].category}));
 data.memory.forEach((m,i)=>nodes.push({id:'m'+i,kind:m.kind,memory:i,start:m.start_ns,end:m.start_ns+m.duration_ns,device:m.device,stream:m.stream,context:m.context,process:m.process,correlation:m.correlation,label:m.kind,category:'copy',bytes:m.bytes}));
 nodes.sort((a,b)=>a.start-b.start||a.end-b.end);
 const lanes=new Map(),byId=new Map();
 for(const node of nodes){node.lane=laneKey(node.device,node.stream,node.context,node.process);byId.set(node.id,node);if(!lanes.has(node.lane))lanes.set(node.lane,{key:node.lane,device:node.device,stream:node.stream,nodes:[],prefix:[],known:node.device!=null&&node.stream!=null});const l=lanes.get(node.lane);node.position=l.nodes.length;const prev=l.nodes.at(-1);node.previous=prev?.id??null;node.ordered=!!prev&&l.known&&prev.end<=node.start;l.nodes.push(node);l.prefix.push(Math.max(node.end,l.prefix.at(-1)??0));}
 const kernelIntervals=data.events.map(e=>[e[0],e[0]+e[1]]),gaps=complement(nodes.map(n=>[n.start,n.end]),data.duration_ns),kernelGaps=complement(kernelIntervals,data.duration_ns);
 const evidence=data.execution_evidence??{},hosts=(evidence.host_events??[]).map((h,i)=>({id:'h'+i,kind:'host',start:h[0],end:h[0]+h[1],label:evidence.host_names[h[2]],correlation:h[3],thread:h[4],result:h[5]}));
 // Older imports still retain correlated launch API intervals.
 if(!hosts.length)data.events.forEach((e,i)=>{if(e[5]!=null)hosts.push({id:'h'+i,kind:'host',start:e[5],end:e[5]+e[6],label:'Correlated launch API',correlation:e[4],event:i});});
 hosts.sort((a,b)=>a.start-b.start);let he=-Infinity;const hostPrefix=hosts.map(h=>he=Math.max(he,h.end));const hostBy=new Map();for(const h of hosts){if(!hostBy.has(h.correlation))hostBy.set(h.correlation,[]);hostBy.get(h.correlation).push(h);}
 const sync=(evidence.synchronization??[]).map((s,i)=>({id:'s'+i,kind:'sync',start:s.start_ns,end:s.start_ns+s.duration_ns,label:({1:'Event synchronize',2:'Stream wait event',3:'Stream synchronize',4:'Context synchronize'})[s.syncType]??'Synchronization',device:s.deviceId,stream:s.streamId,correlation:s.correlationId,record:s}));
 const model={nodes,byId,lanes:[...lanes.values()],gaps,kernelGaps,hosts,hostPrefix,hostBy,sync,cross:evidence.cross_dependencies??[],totalGap:gaps.reduce((s,[a,b])=>s+b-a,0)};
 data.executionModel=model;return model;
}
export function visibleNodes(lane,start,end){return lane.nodes.slice(upperBound(lane.prefix,start),lowerBound(lane.nodes,end,n=>n.start));}
export function overlapHosts(model,start,end){return model.hosts.slice(upperBound(model.hostPrefix,start),lowerBound(model.hosts,end,h=>h.start)).filter(h=>h.end>start);}
export function classifyTime(model,time,category=null){
 const active=model.lanes.flatMap(l=>visibleNodes(l,time,time+1)).filter(n=>n.start<=time&&time<n.end);
 if(active.some(n=>n.kind==='kernel'))return category&&!active.some(n=>n.category===category)?'No activity in this operation category; other kernels are executing.':'Recorded kernel activity. Internal kernel stalls occur within these execution bars.';
 if(active.length)return 'No kernel activity, but recorded memory activity.';
 return 'No captured kernel or memory activity; cause unknown.';
}
export function correlatedHosts(model,node){
 const candidates=(model.hostBy.get(node.correlation)??[]).filter(h=>(h.result==null||h.result===0)&&(h.thread==null||node.process==null||Math.floor(h.thread/16777216)===Math.floor(node.process/16777216)));
 return candidates.length===1?candidates:[];
}
export function gapEvidence(model,gap){
 const [a,b]=gap;let before=null,after=null;
 for(const n of model.nodes){if(n.end<=a&&(!before||n.end>before.end))before=n;if(n.start>=b&&(!after||n.start<after.start))after=n;}
 return {before,after,hosts:overlapHosts(model,a,b),sync:model.sync.filter(s=>s.start<b&&s.end>a),nextHosts:after?correlatedHosts(model,after):[]};
}
// Aggregate display only; the exact node list is retained and is always browsable.
export function displayGroups(nodes,start,end,pixels,expand=false){
 if(nodes.length<=250){
  const out=[];
  for(const n of nodes){const p=out.at(-1),first=p?.nodes[0];if(!expand&&nodes.length>30&&p&&n.kind==='kernel'&&first.kind==='kernel'&&n.group===first.group&&n.lane===first.lane&&(n.end-p.start)/(end-start)*pixels<150){p.nodes.push(n);p.end=Math.max(p.end,n.end);}else out.push({nodes:[n],start:n.start,end:n.end});}
  return out;
 }
 const width=(end-start)/Math.max(1,pixels/(expand?4:22)),groups=[];
 for(const n of nodes){const prev=groups.at(-1),bucket=Math.floor((n.start-start)/width);if(prev&&prev.bucket===bucket){prev.nodes.push(n);prev.end=Math.max(prev.end,n.end);}else groups.push({bucket,nodes:[n],start:n.start,end:n.end});}
 return groups;
}
export function highlightedLane(model,selected){
 // A single observed lane is a serial execution sequence, not a full causal path.
 // With multiple lanes, focus the selected lane without claiming it is critical.
 const n=model.byId.get('k'+selected);return model.lanes.find(l=>l.key===n?.lane)??model.lanes[0];
}
