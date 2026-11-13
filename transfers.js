import {clamp} from './core.js';

// An educational tile cycle, shared with the operation animation. These fractions
// are neither measured traffic nor an estimate of occupied GPU/DRAM capacity.
export function transferProgress(group,time){
 const phase=((Math.max(0,time)/5500)%1),stage=Math.floor(phase*3),u=phase*3-stage;
 const category=group?.category;
 const known=['add','multiply','matmul','reduction','copy','gdn','fill'].includes(category)||
  (category==='triton'&&group.name.includes('_assemble_'))||
  (category==='elementwise'&&group.name.includes('exp_kernel'));
 if(!known)return{known:false,gpu:null,dram:null,phase:'unknown',label:'Transfer pattern unavailable',gpuNote:'Not recorded',dramNote:'Not recorded'};
 if(category==='fill'){
  const written=clamp((phase-1/3)*1.5/.9,0,1);
  return{known:true,gpu:null,dram:written,phase:stage===0?'compute':'store',label:stage===0?'Prepare fill value':'GPU → DRAM · write',gpuNote:'Scalar ready',dramNote:'Output written'};
 }
 return{known:true,gpu:stage===0?clamp(u/.9,0,1):1,dram:stage===2?clamp(u/.9,0,1):0,phase:['load','compute','store'][stage],
  label:['DRAM → GPU · read','GPU · compute','GPU → DRAM · write'][stage],gpuNote:'Inputs loaded',dramNote:'Output written'};
}
