import {colors,categories,num,ms,lowerBound,upperBound,clamp} from './core.js';
import {operationNames} from './overview.js';
import {executionFlow,flowSummary} from './flow.js?v=big-picture-3';

// Keep every launch in the overview, independent of inspector filters or zoom.
// At capture scale several launches can share a pixel; the source index remains
// complete and clicking drills down to an actual recorded launch.
export function captureRows(data){
 const rows=[];
 for(const lane of data.streamLanes)for(const category of categories){
  const indices=lane.indices.filter(i=>data.groups[data.events[i][2]].category===category);
  if(indices.length)rows.push({lane,category,indices,ends:indices.map(i=>data.events[i][0]+data.events[i][1]).sort((a,b)=>a-b)});
 }
 return rows;
}
export class CaptureMap{
 constructor(canvas){this.canvas=canvas;this.data=null;this.rows=[];this.base=document.createElement('canvas');this.signature='';}
 render(data,time,selected){
  if(this.data!==data){this.data=data;this.rows=captureRows(data);this.signature='';}
  const w=Math.max(1,this.canvas.getBoundingClientRect().width),h=30+this.rows.length*23,dpr=Math.min(2,globalThis.devicePixelRatio||1);
  const left=w<600?90:135,right=w-12,span=right-left,x=t=>left+t/data.duration_ns*span;
  const signature=`${w}:${h}:${dpr}`;
  this.canvas.style.height=h+'px';this.left=left;this.right=right;
  if(signature!==this.signature){
   this.signature=signature;this.canvas.width=Math.ceil(w*dpr);this.canvas.height=Math.ceil(h*dpr);
   this.base.width=this.canvas.width;this.base.height=this.canvas.height;
   const b=this.base.getContext('2d');b.scale(dpr,dpr);
   for(let r=0;r<this.rows.length;r++){
    const row=this.rows[r];b.fillStyle=colors[row.category];
    for(const i of row.indices){const e=data.events[i];b.fillRect(x(e[0]),25+r*23,Math.max(.8,e[1]/data.duration_ns*span),12);}
   }
  }
  const c=this.canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
  c.font='10px sans-serif';c.fillStyle='#acbdab';
  for(let i=0;i<=4;i++){c.textAlign=i===4?'right':i===0?'left':'center';c.fillText(ms(data.duration_ns*i/4),left+span*i/4,12);}
  c.globalAlpha=.22;c.drawImage(this.base,0,0,w,h);c.globalAlpha=1;
  c.save();c.beginPath();c.rect(left,20,Math.max(0,x(time)-left),h-20);c.clip();c.drawImage(this.base,0,0,w,h);c.restore();
  let done=0;
  for(let r=0;r<this.rows.length;r++){
   const row=this.rows[r],n=upperBound(row.ends,time);done+=n;c.textAlign='left';c.fillStyle=colors[row.category];c.font='11px sans-serif';
   c.fillText(operationNames[row.category],0,31+r*23,left-8);
   c.font='8px sans-serif';c.fillStyle='#a3b7a5';c.fillText(`${num(n)} / ${num(row.indices.length)} done${data.streamLanes.length>1?' · '+row.lane.key:''}`,0,40+r*23,left-8);
  }
  const event=data.events[selected];
  if(event){const row=this.rows.findIndex(r=>r.category===data.groups[event[2]].category&&r.lane.key===`${event[8]??'?'}:${event[3]??'?'}`);if(row>=0){c.strokeStyle='#f0d293';c.lineWidth=2;c.strokeRect(x(event[0])-2,23+row*23,Math.max(4,event[1]/data.duration_ns*span+4),16);}}
  c.strokeStyle='#eff2cb';c.lineWidth=1.5;c.beginPath();c.moveTo(x(time),17);c.lineTo(x(time),h);c.stroke();
  this.canvas.setAttribute('aria-label',`Entire capture: ${num(data.events.length)} kernels across ${data.streamLanes.length} streams, ${num(done)} finished. Click a row to inspect a launch; use the position slider to seek.`);
  const set=(id,value)=>{const el=document.getElementById(id);if(el.textContent!==value)el.textContent=value;};
  set('capture-total',`${num(data.events.length)} launches · ${data.streamLanes.length} ${data.streamLanes.length===1?'stream':'streams'} · ${ms(data.duration_ns)}`);
  set('capture-completed',`${num(done)} / ${num(data.events.length)} finished`);
  set('capture-story',data.streamLanes.map(l=>flowSummary(executionFlow(data,time,l.key),data)).join(' '));
  document.getElementById('capture-position').value=Math.round(time/data.duration_ns*100000);
 }
 hit(clientX,clientY){
  if(!this.data)return null;
  const rect=this.canvas.getBoundingClientRect(),r=Math.floor((clientY-rect.top-23)/23),row=this.rows[r];
  if(!row)return null;
  const time=clamp((clientX-rect.left-this.left)/(this.right-this.left),0,1)*this.data.duration_ns;
  const at=lowerBound(row.indices,time,i=>this.data.events[i][0]);
  return row.indices.slice(Math.max(0,at-1),at+1).sort((a,b)=>{
   const distance=i=>{const e=this.data.events[i];return Math.max(e[0]-time,time-e[0]-e[1],0);};return distance(a)-distance(b);
  })[0]??null;
 }
}
