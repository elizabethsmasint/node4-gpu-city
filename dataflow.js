import {esc,num,duration,colors,lowerBound,clamp} from './core.js';
import {flowNode,flowStates} from './flow.js?v=big-picture-3';
import {operationNames} from './overview.js';
import {transferProgress} from './transfers.js?v=big-picture-3';

export const sequenceSize=18;
// Every card shares recorded time. Tile phases are illustrative subdivisions of
// execution, not measured memory transactions. Completion is derived, never reset
// by selection, pagination, or repeated animation frames.
export function dataFlowModel(data,selected,time){
 const e=data.events[selected],lane=e&&data.streamLanes.find(l=>l.key===`${e[8]??'?'}:${e[3]??'?'}`);
 if(!lane)return{lane:null,nodes:[],edges:[]};
 const position=lowerBound(lane.indices,selected),start=Math.floor(position/sequenceSize)*sequenceSize;
 const nodes=lane.indices.slice(start,start+sequenceSize).map((event,i)=>{
  const node=flowNode(data,lane,start+i,time);
  return{...node,selected:event===selected,transfer:transferProgress(node.group,node.progress*5500)};
 });
 const edges=[];
 for(let i=0;i<nodes.length;i++){
  const before=flowNode(data,lane,start+i-1,time),node=nodes[i];
  if(lane.known&&before&&before.end<=node.start)edges.push({from:before.event,to:node.event,waiting:node.status==='waiting',satisfied:before.end<=time});
 }
 return{lane,nodes,edges,start,position,previous:lane.indices[position-1],next:lane.indices[position+1],previousPage:lane.indices[start-sequenceSize],nextPage:lane.indices[start+sequenceSize]};
}
const $=id=>document.getElementById(id);
const setText=(id,value)=>{const el=$(id);if(el&&el.textContent!==value)el.textContent=value;};
const percent=n=>n==null?'—':`${Math.floor(n*100)}%`;
export function initialDataFlowEvent(data){
 for(const lane of data.streamLanes)for(let i=1;i<lane.indices.length-1;i++){
  if(lane.indices.slice(i-1,i+2).every(event=>transferProgress(data.groups[data.events[event][2]],0).known))return lane.indices[i];
 }
 return data.events.length?0:-1;
}

export class DataFlowBoard{
 constructor(element){this.element=element;this.data=null;this.key=null;}
 render(data,selected,time,_tileTime,running){
  const model=dataFlowModel(data,selected,time),key=`${model.lane?.key}:${model.start}`;
  this.model=model;
  if(data!==this.data||key!==this.key){
   this.data=data;this.key=key;
   this.element.innerHTML=model.nodes.length?model.nodes.map(node=>{
    const id=node.event,known=node.transfer.known,fill=node.group.category==='fill';
    const memory=(kind,title)=>`<div class="memory-vessel ${kind}${!known||fill&&kind==='source'?' unavailable':''}" id="memory-${id}-${kind}"><div class="vessel-fill" id="fill-${id}-${kind}" aria-hidden="true"></div><span class="vessel-label">${title}</span><strong id="value-${id}-${kind}">${kind==='source'?fill?'v':known?'IN':'?':'—'}</strong><span class="vessel-note" id="note-${id}-${kind}">${kind==='source'?fill?'No read':'Input':''}</span></div>`;
    return `<article class="kernel-lane" id="lane-${id}" data-event="${id}" style="--kernel-color:${colors[node.group.category]}">
     <div class="stream-link" id="stream-link-${id}"><span class="stream-wire" aria-hidden="true">→</span><span id="stream-label-${id}"></span></div>
     <div class="lane-heading"><button class="lane-select" data-event="${id}" title="${esc(node.group.label??node.group.name)}"><span class="lane-role"><b>#${num(id+1)}</b><span>${duration(node.end-node.start)}</span></span><strong>${esc(operationNames[node.group.category])}</strong></button><span class="state-badge" id="lane-state-${id}"></span></div>
     <div class="memory-route">${memory('source',fill?'SCALAR':'DRAM')}<span class="route-arrow" aria-hidden="true">→</span>${memory('gpu','GPU')}<span class="route-arrow" aria-hidden="true">→</span>${memory('dram','DRAM')}</div>
     <div class="lane-foot"><span id="lane-phase-${id}"></span><span id="lane-execution-${id}"></span></div>
    </article>`;
   }).join(''):'<p class="board-empty">No recorded kernel launches in this capture.</p>';
  }
  for(const node of model.nodes){
   const id=node.event,lane=$('lane-'+id),transfer=node.transfer;
   lane.classList.toggle('is-selected',node.selected);
   lane.querySelector('.lane-select').setAttribute('aria-pressed',String(node.selected));
   lane.dataset.phase=node.status==='running'?transfer.phase:node.status==='done'?'done':'idle';
   lane.dataset.animating=String(node.status==='running'&&running&&transfer.known);
   lane.dataset.status=node.status;
   setText('lane-state-'+id,flowStates[node.status]);$('lane-state-'+id).dataset.status=node.status;
   setText('lane-execution-'+id,`${percent(node.progress)} executed`);
   setText('lane-phase-'+id,node.status==='done'?'✓ Finished · retained':node.status==='running'?transfer.known?transfer.label:'Transfer unknown':node.status==='waiting'?`Held for #${num(node.blocker+1)}`:'Execution has not started');
   for(const name of ['gpu','dram']){
    const value=transfer[name],note=transfer[name+'Note'];
    $('fill-'+id+'-'+name).style.transform=`scaleY(${value??0})`;
    setText('value-'+id+'-'+name,percent(value));
    setText('note-'+id+'-'+name,!transfer.known?'Unknown':name==='gpu'&&node.group.category==='fill'?'Scalar':node.status==='done'?'Complete':name==='gpu'?'Loaded':'Written');
    $('memory-'+id+'-'+name).setAttribute('aria-label',`${name.toUpperCase()}: ${note}, ${percent(value)}. Illustrative tile progress.`);
   }
   const edge=model.edges.find(e=>e.to===id),link=$('stream-link-'+id);
   link.dataset.state=edge?edge.waiting?'waiting':edge.satisfied?'satisfied':'ordered':'unknown';
   setText('stream-label-'+id,edge?edge.satisfied?`✓ #${num(edge.from+1)} finished`:edge.waiting?`Must finish first: #${num(edge.from+1)}`:`After #${num(edge.from+1)} finishes`:model.start===0&&id===model.nodes[0].event?'Start of stream':model.lane.known?'Overlap · order unproven':'Stream order unknown');
  }
  setText('sequence-range',model.lane?`Launches ${num(model.start+1)}–${num(model.start+model.nodes.length)} of ${num(model.lane.indices.length)} on this stream`:'No kernels');
  return model;
 }
}
