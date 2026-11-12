import {colors,operationFamilies,num} from './core.js';

export const operationNames={add:'Add',fill:'Fill',matmul:'Matrix multiply',reduction:'Reduce',copy:'Copy',triton:'Triton',gdn:'Triangular solve',multiply:'Multiply',elementwise:'Elementwise',other:'Other kernels'};
export const operationActions={add:'Combine two inputs',fill:'Initialize a buffer',matmul:'Multiply matrix tiles',reduction:'Combine many values',copy:'Move / convert values',triton:'Run a custom kernel',gdn:'Solve row by row',multiply:'Multiply matching values',elementwise:'Process tensor elements',other:'Computation unspecified'};

// Each diagram has its own visual verb; no repeated worker or conveyor swarms.
// Coordinates are local to a 160 × 54 workshop. Values and motion are examples.
function drawAction(c,category,clock,color){
 const phase=(clock/4)%1,step=Math.floor(phase*3),u=phase*3-step;
 const text=(s,x,y,size=12)=>{c.fillStyle='#e0ebdf';c.font=`${size}px sans-serif`;c.textAlign='center';c.fillText(s,x,y);};
 const rect=(x,y,w,h,active=false)=>{c.fillStyle=active?color:'#304b43';c.beginPath();c.roundRect(x,y,w,h,3);c.fill();};
 const line=(x,y,xx,yy,active=true)=>{c.strokeStyle=active?color:'#5e7b6c';c.lineWidth=1.5;c.beginPath();c.moveTo(x,y);c.lineTo(xx,yy);c.stroke();};
 const arrow=(x,y,xx,yy)=>{line(x,y,xx,yy);line(xx-4,yy-3,xx,yy);line(xx-4,yy+3,xx,yy);};
 const grid=(x,y,cols,rows,lit=0)=>{for(let i=0;i<cols*rows;i++)rect(x+i%cols*10,y+Math.floor(i/cols)*10,8,8,i<lit);};
 if(category==='add'||category==='multiply'){
  rect(3,3,24,19,step===0);rect(3,32,24,19,step===0);text('A',15,17);text('B',15,46);
  line(32,12,65,27,step===0);line(32,41,65,27,step===0);
  rect(66,13,29,29,step===1);text(category==='add'?'+':'×',80,34,22);
  arrow(100,27,126,27);rect(132,16,24,23,step===2);text('C',144,32);
 }else if(category==='fill'){
  rect(4,14,27,27,true);text('v',17,33,18);arrow(36,27,57,27);grid(65,8,8,4,Math.floor(phase*33));
 }else if(category==='matmul'){
  grid(3,12,3,3,step===0?Math.ceil(u*9):9);text('×',42,33,19);grid(55,12,3,3,step===1?Math.ceil(u*9):0);arrow(92,27,116,27);grid(126,12,3,3,step===2?Math.ceil(u*9):0);
 }else if(category==='reduction'){
  for(let i=0;i<4;i++){rect(4,i*14,15,11,step===0);line(24,i*14+5,65,13+Math.floor(i/2)*28,step===0);}
  for(let i=0;i<2;i++){rect(67,7+i*28,16,13,step===1);line(89,14+i*28,129,27,step===1);}
  rect(132,17,23,23,step===2);text('1',144,33);
 }else if(category==='copy'){
  grid(3,13,3,3,9);arrow(44,27,116,27);grid(127,13,3,3,step===2?9:0);rect(44+phase*65,21,12,12,true);
 }else if(category==='gdn'){
  const row=Math.min(3,Math.floor(phase*4));
  for(let y=0;y<4;y++)for(let x=0;x<=y;x++)rect(13+x*12,3+y*12,10,10,y<=row);
  arrow(71,27,116,27);for(let i=0;i<4;i++)rect(130,3+i*12,18,10,i<=row);
 }else if(category==='triton'){
  c.strokeStyle=color;c.lineWidth=1;c.strokeRect(6,5,148,44);
  for(let i=0;i<3;i++){rect(17+i*48,14,28,26,i===step);text(String(i+1),31+i*48,32);if(i<2)arrow(48+i*48,27,61+i*48,27);}
 }else if(category==='elementwise'){
  grid(3,13,3,3,step===0?9:0);arrow(40,27,59,27);rect(63,12,34,30,step===1);text('f',80,33,20);arrow(102,27,121,27);grid(127,13,3,3,step===2?9:0);
 }else{
  rect(26,8,108,38);text('execute',80,31,12);
  for(let i=0;i<3;i++)rect(62+i*13,38,9,4,i===step);
 }
}

export function drawOverview(c,w,h,orders,clock,{mini=false,completed=false,dispatch=0,memory=[],exact=false}={}){
 const families=operationFamilies(orders),visible=families.slice(0,4),hits=[];
 const text=(s,x,y,size=11,color='#b6ccbd',align='center')=>{c.fillStyle=color;c.font=`${size}px sans-serif`;c.textAlign=align;c.fillText(s,x,y);};
 const rect=(x,y,ww,hh,fill,stroke)=>{c.beginPath();c.roundRect(x,y,ww,hh,8);c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();}};
 const top=mini?40:105,bottom=h-(mini?43:70),gap=12,pad=mini?16:20;
 if(mini)text('OPERATIONS AT A GLANCE',w/2,22,9,'#9cb6a4');
 if(!visible.length){
  text(completed?'Capture complete':'No matching kernel work',w/2,(top+bottom)/2,15,'#e1e9d7');
  text(completed?'The recorded step has ended.':'Scrub, play, or choose an operation.',w/2,(top+bottom)/2+23,11);
 }else{
  const cols=visible.length===1?1:2,rows=Math.ceil(visible.length/cols);
  const cardW=Math.min(300,(w-pad*2-gap*(cols-1))/cols),cardH=Math.min(mini?102:155,(bottom-top-gap*(rows-1))/rows);
  const x0=(w-cols*cardW-gap*(cols-1))/2,y0=top+(bottom-top-rows*cardH-gap*(rows-1))/2;
  visible.forEach((family,i)=>{
   const x=x0+(i%cols)*(cardW+gap),y=y0+Math.floor(i/cols)*(cardH+gap),color=colors[family.category];
   // A single workshop stands for every matching launch in this operation family.
   rect(x,y,cardW,cardH,'#233e35','#476553');
   c.fillStyle=color;c.fillRect(x+12,y,cardW-24,3);
   const compact=cardH<120;
   const narrow=cardW<175;
   text(operationNames[family.category],x+12,y+22,narrow?11:compact?11:13,color,'left');
   if(!compact)text(operationActions[family.category],x+12,y+39,narrow?8:10,'#b6ccbd','left');
   const scale=Math.min((cardW-24)/160,(cardH-(compact?52:76))/54,1.3);
   c.save();c.translate(x+(cardW-160*scale)/2,y+(compact?29:49));c.scale(scale,scale);drawAction(c,family.category,clock,color);c.restore();
   text(`${num(family.count)} launch${family.count===1?'':'es'}`,x+12,y+cardH-12,compact?9:11,'#dce8d5','left');
   hits.push({x:x+cardW/2,y:y+cardH/2,w:cardW,h:cardH,event:family.representative.event,category:family.category});
  });
 }
 // Static support buildings: activity counts replace flying dispatch/memory crates.
 const footerY=h-(mini?28:47),labelSize=mini?9:10;
 text(`Host: ${num(dispatch)} launch calls`,pad,footerY,labelSize,'#cbbb8f','left');
 text(`Copy / set: ${num(memory.length)} records`,w-pad,footerY,labelSize,'#9fc4d6','right');
 if(!mini)text('Top 4 families by kernel time · illustrative diagrams',w/2,h-24,w<360?8:9,'#8fae9b');
 else if(families.length>4)text(`+ ${families.length-4} more families · ${num(families.slice(4).reduce((n,f)=>n+f.count,0))} launches`,w/2,h-8,9);
 return{hits,families};
}
