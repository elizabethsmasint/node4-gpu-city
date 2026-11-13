import {colors,clamp} from './core.js';
import {drawOverview} from './overview.js';
import {drawFlow} from './flow.js';
import {transferProgress} from './transfers.js';
export function fitCanvas(canvas){const r=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);const w=Math.max(1,r.width),h=Math.max(1,r.height);if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return{ctx,w,h};}
const mix=(a,b,t)=>a+(b-a)*t;
export class City{
 constructor(canvas,{mini=false,detail='overview'}={}){this.canvas=canvas;this.mini=mini;this.detail=detail;this.hits=[];this.lastOrders=[];this.families=[];}
 draw(orders,clock,{smCount=48,completed=false,dispatch=0,memory=[],exact=false,flow=null,selected=null,matches}={}){
  const {ctx:c,w,h}=fitCanvas(this.canvas);c.clearRect(0,0,w,h);this.hits=[];this.lastOrders=orders;
  if(flow){this.flow=flow;this.families=[];this.hits=drawFlow(c,w,h,flow,clock,{detail:this.detail,selected,matches}).hits;return;}this.flow=null;
  if(this.detail==='overview'){const overview=drawOverview(c,w,h,orders,clock,{mini:this.mini,completed,dispatch,memory,exact});this.hits=overview.hits;this.families=overview.families;return;}
  const scale=Math.min(w/850,h/(this.mini?490:570));const ox=w*.5,oy=h*.22;
  const iso=(x,y,z=0)=>[ox+(x-y)*23*scale,oy+(x+y)*11.5*scale-z*scale];
  const poly=(p,fill,stroke)=>{c.beginPath();p.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=.7*scale;c.stroke();}};
  const tile=(x,y,ww,hh,fill,stroke)=>poly([iso(x,y),iso(x+ww,y),iso(x+ww,y+hh),iso(x,y+hh)],fill,stroke);
  const line=(a,b,color,width=1)=>{c.beginPath();c.moveTo(...a);c.lineTo(...b);c.strokeStyle=color;c.lineWidth=width*scale;c.stroke();};
  const box=(x,y,ww,hh,z,top='#71957c',front='#3b6558',side='#517f65')=>{poly([iso(x,y+hh),iso(x+ww,y+hh),iso(x+ww,y+hh,z),iso(x,y+hh,z)],front);poly([iso(x+ww,y),iso(x+ww,y+hh),iso(x+ww,y+hh,z),iso(x+ww,y,z)],side);poly([iso(x,y,z),iso(x+ww,y,z),iso(x+ww,y+hh,z),iso(x,y+hh,z)],top,'#182f2b55');};
  const text=(s,x,y,size=7,color='#b2c5a7')=>{const p=iso(x,y);c.fillStyle=color;c.font=`${size*scale}px ui-monospace,monospace`;c.textAlign='center';c.fillText(s,p[0],p[1]);};
  const dot=(x,y,r,col)=>{c.beginPath();c.arc(x,y,r*scale,0,Math.PI*2);c.fillStyle=col;c.fill();};
  // Floating industrial district, with muted roads and individual plots.
  box(-2,-2,18,17,5,'#2c493b','#142b26','#1e382c');
  for(let y=-2;y<15;y++)for(let x=-2;x<16;x++)tile(x,y,1,1,(x+y)%2?'#2d4939':'#304c3c','#35503f');
  tile(-1,-.3,16,1,'#263c32');tile(-1,10,16,1.3,'#20382f');tile(-1,-1,1,14,'#20382f');tile(12.9,-1,1,13,'#20382f');
  for(let y=0;y<6;y++)tile(.1,y*1.65+.9,12.5,.45,'#253c33');
  // Rail ties and double conveyor spines.
  for(let side of [-.6,13.25]){line(iso(side,0),iso(side,12),'#68745b',.8);line(iso(side+.16,0),iso(side+.16,12),'#536951',.6);for(let y=0;y<12;y+=.45)line(iso(side-.12,y),iso(side+.3,y),'#637557',.6);}
  for(let x=.4;x<13;x+=.45)line(iso(x,10.2),iso(x+.18,10.9),'#62735b',.7);
  line(iso(0,10.3),iso(13,10.3),'#a6a36a',1);line(iso(0,10.8),iso(13,10.8),'#596f4c',1);
  // Corner foliage softens a working industrial world.
  for(let i=0;i<42;i++){const x=i%2?-1.6:14.7+(i%3)*.23,y=-1+(i*.37)%14;const p=iso(x,y);line(p,iso(x,y,6),'#716b49',1.3);dot(...iso(x,y,9),2.7,i%3?'#4c6a42':'#627e49');dot(...iso(x-.1,y,13),2.2,'#66834b');}
  const activeCount=orders.length?Math.min(smCount,Math.max(1,orders.reduce((s,o)=>s+(o.group.grid?.reduce((a,b)=>a*b,1)||8),0))):0;
  // Illustrative round-robin assignment. Never used as a measured occupancy metric.
  for(let row=0;row<6;row++)for(let col=0;col<8;col++){
   const i=row*8+col;if(i>=smCount)continue;const x=.45+col*1.55,y=.15+row*1.65,active=i<activeCount,order=active?orders[i%orders.length]:null,color=order?colors[order.group.category]:'#607b60';
   tile(x-.13,y-.1,1.35,1.3,'#3b5743','#526348');
   box(x,y,1.02,.8,15,active?'#749a75':'#506c55',active?'#456852':'#354e3e',active?'#597c59':'#405c46');
   // Roof, metal ridges, loading dock, shared-memory local storage.
   box(x+.07,y+.1,.85,.42,21,active?'#93b682':'#67845e','#4b7152','#587854');
   for(let k=0;k<4;k++)line(iso(x+.15+k*.18,y+.1,21.5),iso(x+.15+k*.18,y+.52,21.5),'#324e3f',.8);
   box(x+.67,y+.65,.23,.22,7,'#b7af72','#5d6844','#7a8154');
   for(let k=0;k<3;k++){const p=iso(x+.19+k*.25,y+.805,8);c.fillStyle=active?color:'#69826c';c.fillRect(p[0]-1*scale,p[1]-1.5*scale,2.5*scale,3*scale);}
   const p=iso(x+.48,y+.4,24);dot(p[0],p[1],active?2.4:1.4,color);
   if(active){
    c.globalAlpha=.18;dot(p[0],p[1],7+Math.sin(clock*4+i)*2,color);c.globalAlpha=1;
    // Visible machinery rotates while an order is active.
    const gear=iso(x+.48,y+.4,23),rot=clock*3+i;c.strokeStyle=color;c.lineWidth=1.3*scale;c.beginPath();c.arc(...gear,3.7*scale,0,Math.PI*2);c.stroke();for(let k=0;k<3;k++){const a=rot+k*Math.PI/3;line([gear[0]+Math.cos(a)*3*scale,gear[1]+Math.sin(a)*2*scale],[gear[0]-Math.cos(a)*3*scale,gear[1]-Math.sin(a)*2*scale],color,.8);}
    // 32 worker-like agents per factory, one representative warp; not actual thread residency.
    for(let k=0;k<32;k++){const q=(k/32+clock*.22+i*.031)%1;const wx=x-.04+(k%8)*.142+Math.sin(q*Math.PI*2)*.10,wy=y+.9+Math.floor(k/8)*.055+Math.cos(q*Math.PI*2)*.045;const a=iso(wx,wy);c.fillStyle=k%4?color:'#d8d5a0';c.fillRect(a[0]-.7*scale,a[1]-2.3*scale,1.4*scale,2.6*scale);c.fillStyle='#f0dfaf';c.fillRect(a[0]-.7*scale,a[1]-3.2*scale,1.4*scale,1*scale);}
    // Crates travel from a distribution spine into a loading dock and back.
    for(let k=0;k<(order.group.category==='fill'?1:3);k++){const q=(clock*.35+k*.33+i*.077)%1;const a=iso(x+.45,10.45),b=iso(x+.45,y+1.1);const stage=order.group.category==='fill'||k===2?1-q:q;const xx=mix(a[0],b[0],stage),yy=mix(a[1],b[1],stage);c.fillStyle=color;c.fillRect(xx-1.6*scale,yy-1.4*scale,3.2*scale,2.8*scale);}
   }else{for(let k=0;k<6;k++){const p=iso(x+.12+k*.12,y+1);c.fillStyle='#74856a';c.fillRect(p[0],p[1]-2*scale,1*scale,2*scale);}}
   if(!this.mini){const p=iso(x+.47,y+1.48);c.font=`${5.7*scale}px ui-monospace,monospace`;c.textAlign='center';c.fillStyle=active?'#adc6a0':'#6e8a71';c.fillText(String(i).padStart(2,'0'),p[0],p[1]);}
   const center=iso(x+.5,y+.5,10);this.hits.push({x:center[0],y:center[1],r:24*scale,event:order?.event,sm:i});
  }
  // Global-memory warehouse, central L2 distribution and order dispatch office.
  box(2,11.4,3.8,2.1,30,'#9aaa70','#566c49','#738458');
  box(2.15,11.55,3.5,1.65,35,'#b3bc80','#6d8356','#7d925f');
  for(let k=0;k<8;k++)line(iso(2.3+k*.4,11.5,35),iso(2.3+k*.4,13.2,35),'#7b8c5c',1.4);
  for(let k=0;k<4;k++)box(2.2+k*.75,13.5,.4,.4,5,'#c0a66a','#7d704a','#a58a54');
  text('GLOBAL MEMORY',3.8,14.8,8,'#d3d6ad');
  box(7,11.7,2.5,1.4,24,'#89a98e','#476e5e','#658671');box(7.2,11.9,2.1,.9,30,'#adc3a0','#60876c','#7ca082');text('L2 DISTRIBUTION',8.25,14.25,7.5,'#b7d2b4');
  box(-1.1,-1.6,2.1,.9,22,'#c5aa73','#7e6c46','#9e8a53');box(-.4,-1.45,.65,.6,33,'#d7bb7c','#8b7951','#ae9560');text('DISPATCH',-.2,-2.15,7,'#e1cea0');
  if(dispatch>0){for(let k=0;k<8;k++){const q=(clock*.5+k/8)%1;const a=iso(0,-.7,24),b=iso(12,-.7,8);const xx=mix(a[0],b[0],q),yy=mix(a[1],b[1],q);c.fillStyle='#d8c281';c.fillRect(xx-2*scale,yy-1*scale,4*scale,2*scale);}}
  // Memory activity gets its own animation, even when no kernel is executing.
  if(memory.length||orders.length){for(let k=0;k<12;k++){const q=(clock*.25+k/12)%1;const a=iso(5.7,12.1,5),b=iso(7.1,12.1,5);const xx=mix(a[0],b[0],q),yy=mix(a[1],b[1],q);c.fillStyle=memory.length?'#78bcea':'#b7b67e';c.fillRect(xx-2*scale,yy-2*scale,4*scale,4*scale);}}
  if(completed){c.fillStyle='#172e2abb';c.fillRect(0,h*.38,w,45);c.textAlign='center';c.fillStyle='#d8e3b3';c.font='12px ui-monospace,monospace';c.fillText('CAPTURE COMPLETE',w/2,h*.38+28);}
 }
 hit(x,y){return this.hits.filter(h=>h.event!=null).sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y)).find(h=>h.w?Math.abs(h.x-x)<=h.w/2&&Math.abs(h.y-y)<=h.h/2:Math.hypot(h.x-x,h.y-y)<h.r);}
}

export class Operation{
 constructor(canvas){this.canvas=canvas;this.time=0;this.running=true;this.group=null;this.operator=null;}
 set(group,operator=null){this.group=group;this.operator=operator;this.time=0;}
 draw(dt){if(this.running)this.time+=dt;const{ctx:c,w,h}=fitCanvas(this.canvas);c.clearRect(0,0,w,h);if(!this.group)return'';
  const g=this.group,cat=g.category,color=colors[cat],phase=(this.time/5500)%1,stage=Math.floor(phase*3),u=phase*3-stage;
  const sx=w/280,sy=h/164;c.save();c.scale(sx,sy);
  const text=(s,x,y,size=9,col='#53634a')=>{c.fillStyle=col;c.font=`${size}px ui-monospace,monospace`;c.textAlign='center';c.fillText(s,x,y);};
  const rect=(x,y,ww,hh,fill,stroke)=>{c.fillStyle=fill;c.beginPath();c.roundRect(x,y,ww,hh,3);c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=.7;c.stroke();}};
  const tile=(x,y,values,active=false,cols=4)=>{for(let i=0;i<values.length;i++){const xx=x+(i%cols)*16,yy=y+Math.floor(i/cols)*17;rect(xx,yy,14,15,active&&i<Math.ceil(u*values.length)?color:'#fafbf4','#d0d9be');text(values[i],xx+7,yy+10,7);}};
  const arrow=(x,y,x2,y2,active)=>{c.strokeStyle=active?color:'#c4ceb5';c.lineWidth=active?2:1;c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.stroke();c.beginPath();c.moveTo(x2-4,y2-3);c.lineTo(x2,y2);c.lineTo(x2-4,y2+3);c.stroke();};
  const worker=(x,y)=>{rect(x-3,y-3,6,7,'#406c51');rect(x-3.5,y-7,7,4,'#d4aa59');c.fillStyle='#a98047';c.fillRect(x-2.5,y+4,2,3);c.fillRect(x+.5,y+4,2,3);};
  text(g.semantics?.formula??'dispatch → execute → complete',140,18,cat==='triton'?8:10,'#314c35');
  const a=[2,4,1,3,5,2,4,1],b=[1,3,2,1,2,3,1,4];
  if(cat==='add'||cat==='multiply'){
   text('TENSOR A',39,41,7);text('TENSOR B',39,105,7);text('OUTPUT',239,41,7);tile(8,47,a,stage===0);tile(8,111,b,stage===0);
   const recordedAlpha=this.operator?.name?.startsWith('aten::add')?Number(this.operator.concrete_inputs?.at(-1)):NaN,alpha=Number.isFinite(recordedAlpha)?recordedAlpha:g.semantics?.alpha??1;const out=a.map((v,i)=>cat==='add'?v+alpha*b[i]:v*b[i]);tile(208,47,stage===2?out:out.map(()=> '·'),stage===2);
   rect(108,61,62,43,stage===1?'#e5edcd':'#e1e7d5','#c3d0ac');text(cat==='add'?'+':'×',139,88,25,'#4d6c3e');text('PARALLEL LANES',139,127,6.5);
   arrow(74,64,107,74,stage===0);arrow(74,127,107,91,stage===0);arrow(172,81,205,65,stage===2);
   for(let i=0;i<4;i++){const xx=stage===0?mix(80,110,u):stage===2?mix(174,202,u):116+i*14;worker(xx,stage===0?65+i*15:stage===2?65+i*7:109+Math.sin(u*Math.PI*6+i)*3);}
   const lane=Math.min(7,Math.floor(u*8));if(stage===1)text(`${a[lane]} ${cat==='add'?'+':'×'} ${cat==='add'&&alpha!==1?alpha+'×':''}${b[lane]} = ${out[lane]}`,140,147,10,'#314c35');
   c.restore();return['1 / LOAD · read both input tiles','2 / COMPUTE · '+(cat==='add'?'add · α = '+alpha+(!Number.isFinite(recordedAlpha)&&g.semantics?.alpha==null?' (example)':''):'multiply corresponding elements'),'3 / STORE · write the output tile'][stage];
  }
  if(cat==='fill'){
   const recorded=this.operator?.name==='aten::fill_'?Number(this.operator.concrete_inputs?.at(-1)):NaN;const scalar=Number.isFinite(recorded)?recorded:g.semantics?.fill_value??'?';text('SCALAR',40,49,7);rect(18,58,44,39,color);text(scalar,40,84,20);text(scalar==='?'?'value unknown':Number.isFinite(recorded)?'recorded scalar':'0 in attributed family',43,113,6);
   text('DESTINATION BUFFER',190,45,7);const transfer=transferProgress(g,this.time),written=Math.min(24,Math.floor(transfer.dram*24));const values=Array.from({length:24},(_,i)=>i<written?scalar:'·');
   for(let i=0;i<24;i++){const x=125+(i%8)*17,y=56+Math.floor(i/8)*23;rect(x,y,15,20,i<written?'#dcc9ed':'#fbfcf6','#c9d2bd');text(values[i],x+7.5,y+13,9);}
   arrow(66,78,118,78,transfer.phase==='store');const p=Math.min(23,written);worker(132+(p%8)*17,48+Math.floor(p/8)*23);text('write → advance → write',188,146,8);c.restore();return transfer.phase==='compute'?'PREPARE · scalar fill value':`WRITE · ${written} / 24 representative elements initialized`;
  }
  if(cat==='matmul'){
   text('A · 2×4',43,43,7);text('B · 4×2',126,43,7);text('C · 2×2',233,43,7);tile(12,53,a,stage===0);tile(111,53,b,stage===0,2);tile(218,53,stage===2?[15,25,18,33]:['·','·','·','·'],stage===2,2);text('×',88,76,14);text('→',183,76,15);rect(12,132,255,21,'#dcebd9');text('C[0,0] = 2×1 + 4×2 + 1×2 + 3×1 = 15',140,146,7);for(let i=0;i<4;i++)worker(171+i*23,108+Math.sin(phase*18+i)*2);
   c.restore();return['LOAD · cooperative input tiles','COMPUTE · multiply and accumulate','STORE · output matrix tile'][stage];
  }
  if(cat==='reduction'){
   const isMax=/max/i.test(g.name),known=isMax||/sum/i.test(g.name);text(known?(isMax?'MAXIMUM':'SUM'):'REPRESENTATIVE SUM · REDUCER UNKNOWN',140,41,7);
   for(let i=0;i<8;i++){rect(12+i*33,55,25,22,'#f8f9ef','#d2dbbf');text(i+1,24+i*33,70,9);arrow(24+i*33,80,55+Math.floor(i/2)*57,102,stage===0);}
   for(let i=0;i<4;i++){rect(44+i*57,104,24,20,stage>0?color:'#e0e8d1');text(isMax?(i+1)*2:i*4+3,56+i*57,118,8);arrow(56+i*57,126,140,145,stage===1);}
   text(isMax?'8':'36',140,160,12);worker(140+Math.sin(phase*6)*30,100);c.restore();return['LOAD · collect representative values','COMBINE · partial reductions','STORE · reduced result'][stage];
  }
  if(cat==='triton'&&g.name.includes('_assemble_')){
   const bwd=g.name.includes('_bwd');text(bwd?'UPSTREAM GRADIENT':'β · KK · Ratio',48,50,8);tile(15,62,a,stage===0);text(bwd?'MASK + GRADIENTS':'MASK + IDENTITY',146,50,7);
   for(let y=0;y<4;y++)for(let x=0;x<4;x++){rect(111+x*16,59+y*16,14,14,y>x?color:'#f9fbef','#d0dbbb');text(y>x?'·':y===x&&!bwd?'1':'0',118+x*16,69+y*16,7);}
   arrow(81,90,106,90,stage<2);arrow(178,90,197,90,stage===2);text(bwd?'3 INPUT':'M',232,63,10);text(bwd?'GRADIENTS':'OUTPUT',232,79,7);for(let i=0;i<3;i++)rect(205,88+i*14,52,10,stage===2?color:'#dfe8cd');worker(139+Math.sin(phase*12)*13,140);c.restore();return['LOAD · inputs enter one fused production stage',bwd?'COMPUTE · mask, multiply and reduce':'COMPUTE · multiply, mask, set diagonal','STORE · fused outputs; solve stays separate'][stage];
  }
  if(cat==='copy'){
   text('SOURCE',47,44,8);text('DESTINATION',234,44,8);tile(16,54,a,stage===0);tile(202,54,stage===2?a:a.map(()=> '·'),stage===2);arrow(85,78,194,78,true);for(let i=0;i<5;i++){const q=(phase+i*.2)%1;rect(mix(85,188,q),66,9,11,color);worker(mix(85,188,q),108);}text('Logical transport / optional conversion',140,145,8);c.restore();return['LOAD · source elements','MOVE · representative data tiles','STORE · destination elements'][stage];
  }
  if(cat==='gdn'){
   text('LOWER TRIANGULAR M',78,43,7);for(let y=0;y<4;y++)for(let x=0;x<4;x++){rect(40+x*18,53+y*18,15,15,y>=x?color:'#e4e9db');text(y===x?'1':y>x?'·':'0',47+x*18,64+y*18,8);}arrow(118,90,169,90,stage>0);tile(180,60,a,stage===2);text('RHS → U',212,44,8);worker(145,100);text('Solve M U = RHS row by row',140,149,8);c.restore();return['LOAD · triangular matrix and right-hand side','SOLVE · propagate row dependencies','STORE · solved update'][stage];
  }
  if(cat==='elementwise'&&g.name.includes('exp_kernel')){
   text('INPUT x',45,44,8);text('exp(x)',231,44,8);tile(14,57,[0,1,-1,2],stage===0);tile(200,57,stage===2?['1','2.7','.37','7.4']:['·','·','·','·'],stage===2);arrow(82,70,106,70,stage===0);rect(109,52,63,42,stage===1?color:'#dce5d0');text('exp',140,78,15);arrow(175,70,197,70,stage===2);worker(141+Math.sin(phase*10)*12,115);text('exp(1) ≈ 2.71828',140,146,10);c.restore();return['LOAD · input elements','COMPUTE · elementwise exponential','STORE · transformed values'][stage];
  }
  // Unknown kernels get an execution machine, never a fictitious arithmetic formula.
  for(let i=0;i<3;i++){rect(23+i*85,62,65,46,i===stage?color:'#dce5d0','#bfcda9');text(['DISPATCH','EXECUTE','COMPLETE'][i],55+i*85,88,7);if(i<2)arrow(90+i*85,85,104+i*85,85,i===stage);worker(54+i*85,118+Math.sin(phase*12+i)*3);}
  text('Exact computation unavailable',140,148,8);c.restore();return['1 / SETUP · production order arrives','2 / EXECUTE · measured kernel interval','3 / COMPLETE · recorded end timestamp'][stage];
 }
}
