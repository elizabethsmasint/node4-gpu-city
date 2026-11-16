import {executionModel} from './execution.js';

// Dependency topology is independent of layout. Time is evidence, never a position.
export function dependencyDag(data){
 if(data.dependencyDag)return data.dependencyDag;
 const execution=executionModel(data),nodes=new Map(execution.nodes.map(n=>[n.id,{...n,in:[],out:[]}])),edges=[];
 const add=(from,to,kind,evidence)=>{if(from===to||!nodes.has(from)||!nodes.has(to))return;const edge={from,to,kind,evidence};edges.push(edge);nodes.get(from).out.push(edge);nodes.get(to).in.push(edge);};
 const laneNodes=new Map(execution.lanes.map(l=>[l.key,[...l.nodes]]));
 // Event completion and wait completion are explicit anchor nodes. Never attach
 // a cross-stream arrow using the nearest launch on an unrelated stream.
 execution.cross.forEach((e,i)=>{
  const matches=(n,stream)=>n.device===e.device&&n.stream===stream&&n.context===e.context&&n.process===e.process;
  const source=execution.lanes.find(l=>matches(l.nodes[0],e.from_stream)),target=execution.lanes.find(l=>matches(l.nodes[0],e.to_stream));
  if(!source||!target||e.from_ns>e.to_ns)return;
  const record={id:'event'+i,kind:'event',label:'Event '+e.event_id+' complete',start:e.from_ns,end:e.from_ns,device:e.device,stream:e.from_stream,context:e.context,process:e.process,lane:source.key,category:'copy',in:[],out:[]},wait={...record,id:'wait'+i,kind:'wait',label:'Wait for event '+e.event_id,start:e.to_ns,end:e.to_ns,stream:e.to_stream,lane:target.key,in:[],out:[]};
  nodes.set(record.id,record);nodes.set(wait.id,wait);
  laneNodes.get(source.key).push(record);laneNodes.get(target.key).push(wait);
  add(record.id,wait.id,'event',e.evidence);
 });
 for(const lane of execution.lanes){const ordered=laneNodes.get(lane.key).sort((a,b)=>a.start-b.start||a.end-b.end);for(let i=1;i<ordered.length;i++){const before=ordered[i-1],next=ordered[i];if(lane.known&&before.end<=next.start)add(before.id,next.id,'stream','Non-overlapping adjacent activities on the same recorded device/context/process/stream, including resolved event/wait completions. Execution order, not a tensor dependency.');}}
 const dag={nodes,edges,execution};data.dependencyDag=dag;return dag;
}
const token=n=>n.kind==='kernel'?'k'+n.group:n.kind;
export function repeatedPattern(nodes){
 for(let width=1;width<=Math.min(16,Math.floor(nodes.length/2));width++){
  if(nodes.length%width)continue;let good=true;
  for(let i=width;i<nodes.length;i++)if(token(nodes[i])!==token(nodes[i%width])){good=false;break;}
  if(good)return {width,repeats:nodes.length/width,labels:nodes.slice(0,width).map(n=>n.label)};
 }
 return null;
}
// Detect repetitions before applying generic sequence blocks, so a pattern's
// boundary need not coincide with an arbitrary 128-node page boundary.
export function sequenceBlocks(chain,limit=128){
 const tokens=chain.map(token),blocks=[];let pending=[];
 const flush=()=>{if(pending.length){blocks.push(pending);pending=[];}};
 for(let i=0;i<chain.length;){let best=0;
  for(let width=1;width<=Math.min(16,Math.floor((chain.length-i)/2));width++){
   let size=width;while(size<Math.min(limit,chain.length-i)&&tokens[i+size]===tokens[i+size%width])size++;
   size=Math.floor(size/width)*width;
   if(size>=Math.max(3,width*2)&&size>best)best=size;
  }
  if(best){flush();blocks.push(chain.slice(i,i+best));i+=best;}
  else{pending.push(chain[i++]);if(pending.length===limit)flush();}
 }
 flush();return blocks;
}
// Collapse only linear, non-branching chains. No branch or merge can disappear
// inside an expandable block. Expanded blocks still reference every source node.
export function collapseDag(dag,expanded=new Set(),limit=128){
 const visited=new Set(),chains=[];
 const walk=start=>{if(visited.has(start.id))return;const chain=[];let n=start;
  while(n&&!visited.has(n.id)){visited.add(n.id);chain.push(n);const edge=n.out[0],next=edge&&dag.nodes.get(edge.to);if(n.out.length!==1||!next||next.in.length!==1||edge.kind!=='stream'||next.lane!==n.lane)break;n=next;}
  chains.push(chain);
 };
 for(const n of dag.nodes.values())if(n.in.length!==1||dag.nodes.get(n.in[0].from).out.length!==1||n.in[0].kind!=='stream')walk(n);
 for(const n of dag.nodes.values())walk(n);
 const nodes=[],bySource=new Map();
 for(const chain of chains)for(const members of sequenceBlocks(chain,limit)){const id='block:'+members[0].id,pattern=repeatedPattern(members);
  if(members.length<3||expanded.has(id))for(const n of members){const view={id:n.id,members:[n],label:n.label,pattern:null};nodes.push(view);bySource.set(n.id,view);}
  else{const view={id,members,label:pattern?`${pattern.width===1?members[0].label:pattern.width+'-operation sequence'} × ${pattern.repeats}`:`Serial sequence · ${members.length} activities`,pattern};nodes.push(view);for(const n of members)bySource.set(n.id,view);}
 }
 const edgeMap=new Map();for(const e of dag.edges){const from=bySource.get(e.from),to=bySource.get(e.to);if(from===to)continue;const key=from.id+'>'+to.id+':'+e.kind;if(!edgeMap.has(key))edgeMap.set(key,{...e,from:from.id,to:to.id,sourceFrom:e.from,sourceTo:e.to});}
 return {nodes,edges:[...edgeMap.values()],bySource};
}

// Layer by graph depth and fold long chains into readable rows. Parallel slots
// are allocated only for topology; stream IDs and timestamps do not set position.
export function layoutDag(view,columns=5){
 const byId=new Map(view.nodes.map(n=>[n.id,n])),incoming=new Map(view.nodes.map(n=>[n.id,[]])),outgoing=new Map(view.nodes.map(n=>[n.id,[]]));
 for(const e of view.edges){incoming.get(e.to).push(e.from);outgoing.get(e.from).push(e.to);}
 const seen=new Set(),positions=new Map(),components=[];let yOffset=30;
 for(const seed of view.nodes){if(seen.has(seed.id))continue;const ids=[],todo=[seed.id];seen.add(seed.id);for(let q=0;q<todo.length;q++){const id=todo[q];ids.push(id);for(const next of [...incoming.get(id),...outgoing.get(id)])if(!seen.has(next)){seen.add(next);todo.push(next);}}
  const degree=new Map(ids.map(id=>[id,incoming.get(id).length])),rank=new Map(ids.map(id=>[id,0])),ready=ids.filter(id=>!degree.get(id)),layers=[];
  for(let q=0;q<ready.length;q++){const id=ready[q],r=rank.get(id);(layers[r]??=[]).push(id);for(const next of outgoing.get(id)){rank.set(next,Math.max(rank.get(next),r+1));degree.set(next,degree.get(next)-1);if(!degree.get(next))ready.push(next);}}
  // Cycles are unsupported evidence, not a reason to fabricate an ordering.
  if(ready.length!==ids.length)throw Error('Dependency evidence contains a cycle; cannot lay out as a DAG.');
  const maxParallel=Math.max(1,...layers.map(l=>l?.length??0)),stride=maxParallel*132+72;
  layers.forEach((layer,r)=>{const row=Math.floor(r/columns),col=row%2?columns-1-r%columns:r%columns;layer.forEach((id,slot)=>positions.set(id,{x:30+col*276,y:yOffset+row*stride+slot*132,w:226,h:94,rank:r,component:components.length}));});
  const height=Math.ceil(layers.length/columns)*stride;components.push({ids,y:yOffset,height});yOffset+=height+50;
 }
 return {positions,width:30+columns*276,height:yOffset,components,byId,incoming,outgoing};
}
