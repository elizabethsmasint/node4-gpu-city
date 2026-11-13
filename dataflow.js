import {esc,num,duration,colors} from './core.js';
import {kernelDependencies,flowStates} from './flow.js';
import {operationNames,operationActions} from './overview.js';
import {transferProgress} from './transfers.js';

// The measured execution clock and the explanatory tile clock are independent.
// Only the selected row previews transfers; neighboring rows never imply that
// queued work is executing or that a finished kernel's memory contents are known.
export function dataFlowModel(data,selected,time,tileTime){
 const focus=kernelDependencies(data,selected,time);
 return {...focus,nodes:focus.nodes.map((node,index)=>node&&{
  ...node,selected:node.event===selected,role:['Previous kernel','Selected kernel','Next kernel'][index],
  transfer:transferProgress(node.group,tileTime),
 })};
}

const $=id=>document.getElementById(id);
const setText=(id,value)=>{const el=$(id);if(el&&el.textContent!==value)el.textContent=value;};
const percent=n=>n==null?'—':`${Math.floor(n*100)}%`;

export function initialDataFlowEvent(data){
 // Open on an early, explainable sequence, without changing any capture times.
 for(const lane of data.streamLanes){
  for(let i=1;i<lane.indices.length-1;i++){
   if(lane.indices.slice(i-1,i+2).every(event=>transferProgress(data.groups[data.events[event][2]],0).known))return lane.indices[i];
  }
 }
 return data.events.length?0:-1;
}

export class DataFlowBoard{
 constructor(element){this.element=element;this.data=null;this.selected=null;}
 render(data,selected,time,tileTime,running){
  const model=dataFlowModel(data,selected,time,tileTime);
  if(data!==this.data||selected!==this.selected){
   const restoreFocus=document.activeElement?.closest?.('.lane-select')!=null;
   this.data=data;this.selected=selected;
   this.element.innerHTML=model.nodes.length?model.nodes.map((node,i)=>{
    const before=model.nodes[i-1];
    const link=i&&node&&before?`<div class="stream-link" id="stream-link-${i}"><span class="stream-wire" aria-hidden="true">↓</span><span id="stream-label-${i}"></span></div>`:'';
    if(!node)return `<div class="stream-boundary">${i===0?'Start of this stream':'End of this stream'}</div>`;
    const id=node.event,chosen=node.selected,known=node.transfer.known,fill=node.group.category==='fill';
    const memory=(kind,title,subtitle)=>{
     const selectedId=chosen&&kind!=='source'?` id="transfer-${kind}"`:'';
     const fillId=chosen&&kind!=='source'?` id="transfer-${kind}-fill"`:'';
     const valueId=chosen&&kind!=='source'?` id="transfer-${kind}-percent"`:'';
     const noteId=chosen&&kind!=='source'?` id="transfer-${kind}-note"`:'';
     return `<div class="memory-vessel ${kind}${!known||fill&&kind==='source'?' unavailable':''}"${selectedId}>
      <div class="vessel-fill"${fillId} aria-hidden="true"></div><span class="vessel-label">${title}</span>
      <strong${valueId}>${kind==='source'?fill?'v':known?'INPUT':'?':chosen?'0%':kind==='gpu'?'GPU':'OUTPUT'}</strong>
      <span class="vessel-note"${noteId}>${subtitle}</span></div>`;
    };
    const conveyor=(kind,label)=>`<div class="conveyor ${kind}" aria-hidden="true"><span>${label}</span><div class="conveyor-track"><i></i><i></i><i></i><b>→</b></div></div>`;
    return `${link}<article class="kernel-lane${chosen?' is-selected':''}" id="lane-${id}" data-event="${id}" style="--kernel-color:${colors[node.group.category]}">
     <div class="lane-heading"><button class="lane-select" data-event="${id}" aria-pressed="${chosen}" title="${esc(node.group.label??node.group.name)}"><span class="lane-role">${node.role} <b>#${num(id+1)}</b></span><strong>${esc(operationNames[node.group.category])}</strong><span class="lane-action">${esc(operationActions[node.group.category])}</span></button><div class="recorded-state"><span class="state-badge" id="lane-state-${id}"></span><small>${duration(node.end-node.start)} recorded</small></div></div>
     <div class="memory-route">
      ${memory('source',fill?'SCALAR':'DRAM',fill?'No tensor read':known?'Source retained':'Read pattern unknown')}
      ${conveyor('read',fill?'Prepare':'Read')}
      ${memory('gpu','GPU',chosen?'Working tile':'Select to preview')}
      ${conveyor('write','Write')}
      ${memory('dram','DRAM',chosen?'Output tile':'Destination')}
     </div>
     <div class="lane-foot"><span id="lane-phase-${id}">${chosen?'Transfer preview':'Select this kernel to animate its transfers'}</span><span id="lane-execution-${id}"></span></div>
    </article>`;
   }).join(''):'<p class="board-empty">No recorded kernel launches in this capture.</p>';
   if(restoreFocus)document.querySelector('.kernel-lane.is-selected .lane-select')?.focus({preventScroll:true});
  }
  model.nodes.forEach(node=>{
   if(!node)return;
   const id=node.event,lane=$('lane-'+id),transfer=node.transfer;
   lane.dataset.phase=node.selected?transfer.phase:'idle';
   lane.dataset.animating=String(node.selected&&running&&transfer.known);
   lane.dataset.status=node.status;
   setText('lane-state-'+id,flowStates[node.status]);
   $('lane-state-'+id).dataset.status=node.status;
   setText('lane-execution-'+id,node.status==='running'?`${percent(node.progress)} executed`:node.status==='waiting'?`Waits for #${num(node.blocker+1)}`:node.status==='done'?'Execution finished':'Execution has not started');
   if(node.selected){
    setText('transfer-phase',transfer.label);
    setText('lane-phase-'+id,transfer.known?`${running?'Preview':'Paused preview'} · ${transfer.label}`:'Transfer pattern not available for this kernel');
    for(const name of ['gpu','dram']){
     const value=transfer[name],note=transfer[name+'Note'];
     $('transfer-'+name+'-fill').style.transform=`scaleY(${value??0})`;
     setText('transfer-'+name+'-percent',percent(value));
     setText('transfer-'+name+'-note',note);
     $('transfer-'+name).setAttribute('aria-label',`${name.toUpperCase()}: ${note}, ${percent(value)}. Illustrative tile progress.`);
    }
   }
  });
  model.nodes.forEach((node,i)=>{
   if(!i||!node||!model.nodes[i-1])return;
   const edge=model.edges.find(e=>e.to===node.event&&e.from===model.nodes[i-1].event);
   $('stream-link-'+i).dataset.state=edge?edge.waiting?'waiting':edge.satisfied?'satisfied':'ordered':'unknown';
   setText('stream-label-'+i,edge?edge.waiting?`Must finish first · #${num(node.event+1)} waits for #${num(edge.from+1)}`:edge.satisfied?'Prerequisite finished · stream order':'Must finish first · stream order':model.lane.known?'Overlapping intervals · no dependency established':'Stream identity missing · dependency unknown');
  });
  return model;
 }
}
