import {colors,upperBound,duration,num,clamp} from './core.js';
import {operationNames} from './overview.js';

export const flowStates={done:'Finished',running:'Running',waiting:'Waiting',queued:'Queued',launching:'Launching',future:'Not launched',unknown:'Queue unknown'};
export const launchName=(data,index)=>`#${num(index+1)} ${operationNames[data.events[index]&&data.groups[data.events[index][2]].category]??'Kernel'}`;

// Stream order supplies a prerequisite, not a tensor producer/consumer graph.
// Host API completion establishes submission conservatively; API entry alone does not.
export function executionFlow(data,time,key=data.streamLanes[0]?.key){
 const lane=data.streamLanes.find(l=>l.key===key);
 if(!lane)return{lane:null,nodes:[null,null,null,null],edges:[],time};
 const indices=lane.indices,at=upperBound(indices,time,i=>data.events[i][0]);
 const active=[];for(let i=upperBound(lane.prefixEnd,time);i<at;i++){const e=data.events[indices[i]];if(e[0]+e[1]>time)active.push(i);}
 const activeCount=active.length;let finished=at-1;
 while(finished>=0&&data.events[indices[finished]][0]+data.events[indices[finished]][1]>time)finished--;
 const positions=[activeCount>1?active.at(-2):finished,active.at(-1)??-1,at,at+1];
 const nodes=positions.map(position=>{
  const event=indices[position]??null;
  if(event==null)return null;
  const e=data.events[event];
  const previous=position>0?indices[position-1]:null,prev=previous==null?null:data.events[previous];
  // Reject only the overlapping pair, preserving valid order elsewhere in a capture.
  const blocked=lane.known&&prev&&prev[0]+prev[1]<=e[0]&&prev[0]+prev[1]>time;
  const submitted=e[5]!=null&&e[6]!=null&&e[5]+e[6]<=time;
  const status=e[0]+e[1]<=time?'done':e[0]<=time?'running':submitted?(blocked?'waiting':'queued'):e[5]==null?'unknown':time<e[5]?'future':'launching';
  const blocker=status==='waiting'?previous:null;
  const detail=status==='waiting'?`Waiting for ${launchName(data,blocker)} to finish`:
   status==='running'?`${duration(e[0]+e[1]-time)} left in this launch`:
   status==='done'?`Finished ${duration(time-e[0]-e[1])} ago`:
   status==='queued'?'Submitted; wait cause not recorded':
   status==='launching'?'Host launch call in progress':status==='future'?'Host has not launched this yet':'Host launch timing unavailable';
  return{event,group:data.groups[e[2]],status,blocker,detail,start:e[0],end:e[0]+e[1],progress:status==='done'?1:status==='running'?clamp((time-e[0])/(e[1]||1),0,1):0};
 });
 const present=nodes.filter(Boolean),edges=[];
 if(lane.known)for(let i=1;i<present.length;i++){if(present[i-1].end<=present[i].start)edges.push({from:present[i-1].event,to:present[i].event,waiting:present[i].status==='waiting'});}
 return{lane,nodes,edges,time,activeCount};
}

export function flowSummary(flow,data){
 if(!flow.lane)return'No recorded kernel launches.';
 if(flow.activeCount>1)return`${num(flow.activeCount)} kernels have overlapping recorded intervals on this stream. No dependency arrow is drawn between overlapping launches.`;
 const waiting=flow.nodes.find(n=>n?.status==='waiting');
 if(waiting)return`${launchName(data,waiting.event)} is waiting for ${launchName(data,waiting.blocker)} to finish on this stream.`;
 const running=flow.nodes.find(n=>n?.status==='running'),next=flow.nodes[2];
 if(running)return`${launchName(data,running.event)} is running. ${next?`${launchName(data,next.event)}: ${next.detail.toLowerCase()}.`:'No later kernel is recorded on this stream.'}`;
 if(next)return`No kernel running on this stream. ${launchName(data,next.event)}: ${next.detail.toLowerCase()}. Starts in ${duration(next.start-flow.time)}.`;
 return'All recorded kernels on this stream have finished.';
}

export function drawFlow(c,w,h,flow,clock,{detail='overview',selected=null,matches=()=>true}={}){
 const hits=[],vertical=w<=620,pad=20,gap=vertical?27:24;
 const top=vertical?117:158,cardW=vertical?w-pad*2:(w-pad*2-gap*3)/4;
 const cardH=vertical?(h-top-48-gap*3)/4:Math.min(220,h-top-90);
 const text=(s,x,y,size=11,color='#dce8d5',align='left',max)=>{c.font=`${size}px sans-serif`;c.textAlign=align;c.fillStyle=color;if(max)c.fillText(s,x,y,max);else c.fillText(s,x,y);};
 const rect=(x,y,ww,hh,fill,stroke)=>{c.beginPath();c.roundRect(x,y,ww,hh,7);c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=1.4;c.stroke();}};
 const positions=flow.nodes.map((_,i)=>({x:pad+(vertical?0:i*(cardW+gap)),y:top+(vertical?i*(cardH+gap):0)}));
 text(flow.lane?`DEVICE ${flow.lane.device??'?'} / STREAM ${flow.lane.stream??'?'}`:'NO KERNEL RECORDS',pad,102,10,'#a8c2ad');
 if(!vertical)text(flow.activeCount>1?'OVERLAPPING INTERVALS AT CURSOR':'FINISHED  →  RUNNING  →  WAITING / UPCOMING',w-pad,102,9,'#a8c2ad','right');
 // Arrows connect adjacent recorded kernels only within a known, ordered stream.
 for(const edge of flow.edges){
  const ai=flow.nodes.findIndex(n=>n?.event===edge.from),bi=flow.nodes.findIndex(n=>n?.event===edge.to),a=positions[ai],b=positions[bi];
  // An empty running slot is a real gap; don't draw a conveyor through it.
  if(bi-ai!==1)continue;
  const ax=vertical?a.x+cardW/2:a.x+cardW,ay=vertical?a.y+cardH:a.y+cardH/2;
  const bx=vertical?b.x+cardW/2:b.x,by=vertical?b.y:b.y+cardH/2;
  c.strokeStyle=edge.waiting?'#efbd67':'#729183';c.lineWidth=edge.waiting?2:1;c.beginPath();c.moveTo(ax,ay);c.lineTo(bx,by);c.stroke();
  c.beginPath();c.moveTo(bx-(vertical?4:5),by-(vertical?5:4));c.lineTo(bx,by);c.lineTo(bx+(vertical?4:-5),by-(vertical?5:-4));c.stroke();
 }
 flow.nodes.forEach((node,i)=>{
  const{x,y}=positions[i],slot=['LAST FINISHED','RUNNING NOW','NEXT KERNEL','THEN'][i];
  if(!node){rect(x,y,cardW,cardH,'#1c3330','#385148');text(slot,x+12,y+18,9,'#91ad9d');text(i===1?'No kernel running':i===0?'No earlier kernel':'No later kernel',x+12,y+43,11,'#91ad9d','left',cardW-24);return;}
  const color=colors[node.group.category],active=node.status==='running',waiting=node.status==='waiting',context=!matches(node);
  rect(x,y,cardW,cardH,waiting?'#3d3828':active?'#294c3d':'#233b33',selected===node.event?'#e7edb6':waiting?'#ca9e50':active?'#86c7a2':'#4b6656');
  c.fillStyle=color;c.fillRect(x+10,y,cardW-20,3);
  text(`${flowStates[node.status].toUpperCase()}${context?' · CONTEXT':''}`,x+12,y+19,9,waiting?'#f4cc83':active?'#aff0c8':'#adc4b4','left',cardW-24);
  const name=`#${num(node.event+1)} ${operationNames[node.group.category]}`;
  text(name,x+12,y+41,vertical?13:12,color,'left',cardW-(detail==='full'&&vertical?100:24));
  // In Full city each launch is a workshop. Placement follows stream order, not SM IDs.
  if(detail==='full'){
   const cx=vertical?x+cardW-44:x+cardW/2,cy=vertical?y+49:y+89;
   const poly=(points,fill)=>{c.beginPath();points.forEach(([xx,yy],j)=>j?c.lineTo(xx,yy):c.moveTo(xx,yy));c.closePath();c.fillStyle=fill;c.fill();};
   poly([[cx-31,cy-13],[cx,cy-26],[cx+31,cy-13],[cx,cy+1]],active?'#98b585':'#68846a');
   poly([[cx-31,cy-13],[cx,cy+1],[cx,cy+31],[cx-31,cy+17]],'#40644f');
   poly([[cx,cy+1],[cx+31,cy-13],[cx+31,cy+17],[cx,cy+31]],'#527760');
   for(let k=0;k<3;k++){c.fillStyle=active&&Math.sin(clock*3+k)>0?'#e7edb6':waiting?'#d4ad68':color;c.fillRect(cx+6+k*7,cy+7-k*3,4,8);}
  }else if(!vertical){
   text(operationNames[node.group.category],x+cardW/2,y+91,16,color,'center',cardW-24);
   text(active?'Working':waiting?'On hold':node.status==='done'?'Complete':'Upcoming',x+cardW/2,y+115,11,'#b4cbb9','center');
  }
  const note=waiting?`Waits for #${num(node.blocker+1)}`:node.status==='running'?`${duration(node.end-flow.time)} left`:node.status==='done'?'Launch finished':node.status==='future'?'Not yet submitted':node.status==='launching'?'Host is launching':node.status==='queued'?'Wait cause unknown':'Submission unknown';
  text(note,x+12,y+cardH-25,11,waiting?'#f4cc83':'#dce8d5','left',cardW-24);
  c.fillStyle='#142c25';c.fillRect(x+12,y+cardH-13,cardW-24,3);c.fillStyle=active?'#95d7ae':color;c.fillRect(x+12,y+cardH-13,(cardW-24)*node.progress,3);
  hits.push({x:x+cardW/2,y:y+cardH/2,w:cardW,h:cardH,event:node.event});
 });
 return{hits};
}
