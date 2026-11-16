#!/usr/bin/env python3
"""Capture actual operator tensor/storage dependencies + same-run kernel timing.

Requires PyTorch on the execution host. Example (diagnostic smoke workload):
 python capture_tensor_graph.py --out /tmp/node4-tensors -- \
   /home/elizabeth/node4_spark_v2/node4_fidelity_v2_trace.py --smoke --device cuda --out-dir /tmp/node4-tensor-smoke
Do not pass --profile to the target (the outer profiler owns this capture).
Eager operators are visible; compiled/custom opaque calls need their own buffer
instrumentation. No production driver, stream, or model configuration is changed.
"""
import argparse,bisect,collections,hashlib,json,runpy,sys,uuid,weakref
from pathlib import Path

class DependencyTracker:
 """Versioned storage hazards; tensor identities never come from shape matching."""
 def __init__(self):self.writer={};self.readers=collections.defaultdict(set);self.producer={};self.nodes=[];self.edges=[]
 def record(self,label,inputs,outputs,writes,metadata=None):
  ident='op'+str(len(self.nodes));edges={};reads={d['storage'] for d in inputs};write_set=set(writes)|{d['storage'] for d in outputs if d['storage'] not in reads};input_by={d['tensor']:d for d in inputs}
  def edge(src,kind,tensor):
   if src and src!=ident:edges[(src,kind,tensor)]=dict(from_id=src,to_id=ident,kind=kind,tensor=tensor,evidence='Same-run tensor identity' if kind=='tensor' else 'Conservative whole-storage alias/mutation hazard; not an exact byte-range dependency')
  for d in inputs:
   storage=d['storage'];edge(self.producer.get(d['tensor']),'tensor',d['tensor']);edge(self.writer.get(storage),'storage_read',storage)
  for storage in write_set:
   edge(self.writer.get(storage),'storage_write',storage)
   for reader in self.readers[storage]:edge(reader,'storage_antidependency',storage)
  self.edges.extend(edges.values())
  for storage in reads:self.readers[storage].add(ident)
  for storage in write_set:self.writer[storage]=ident;self.readers[storage].clear()
  for d in outputs:self.producer[d['tensor']]=ident
  self.nodes.append(dict(id=ident,label=label,kind='runtime_operator',inputs=[d['tensor'] for d in inputs],outputs=[d['tensor'] for d in outputs],input_metadata=inputs,output_metadata=outputs,duration_ns=None,**(metadata or {})))
  return ident

def attach_kernels(graph,trace):
 """Join unique explicit op markers -> same-thread CPU ops -> correlation IDs.
 Kernel start proximity is never a join key. No one-to-one op/kernel assumption.
 """
 events=trace['traceEvents'];ranges={};nodes={n['id']:n for n in graph['nodes']}
 for e in events:
  if e.get('ph')=='X' and e.get('name','').startswith('gpu_city_tensor:'):
   ident=e['name'].split(':',1)[1]
   if ident in nodes:ranges.setdefault(ident,[]).append(e)
 marker_index={};cpu_index={}
 def index(items):
  items.sort(key=lambda pair:pair[1]['ts']);starts=[e['ts'] for ident,e in items];maximum=float('-inf');ends=[]
  for ident,e in items:maximum=max(maximum,e['ts']+e.get('dur',0));ends.append(maximum)
  return items,starts,ends
 for ident,rs in ranges.items():
  if len(rs)==1:marker_index.setdefault((rs[0].get('pid'),rs[0].get('tid')),[]).append((ident,rs[0]))
 for e in events:
  if e.get('ph')=='X' and e.get('cat')=='cpu_op':cpu_index.setdefault((e.get('pid'),e.get('tid')),[]).append((None,e))
 marker_index={key:index(items) for key,items in marker_index.items()};cpu_index={key:index(items) for key,items in cpu_index.items()}
 def containing(idx,event):
  if idx is None:return []
  items,starts,ends=idx;start=event['ts'];end=start+event.get('dur',0);lo=bisect.bisect_left(ends,end);hi=bisect.bisect_right(starts,start)
  return [(ident,e) for ident,e in items[lo:hi] if e['ts']<=start and end<=e['ts']+e.get('dur',0)]
 external={};runtime={};kernel_count=0
 for e in events:
  if e.get('ph')!='X' or e.get('cat')!='cpu_op':continue
  ext=e.get('args',{}).get('External id')
  if ext is None:continue
  candidates=containing(marker_index.get((e.get('pid'),e.get('tid'))),e)
  if len(candidates)==1:external.setdefault((e.get('pid'),ext),set()).add(candidates[0][0])
 # Some dispatcher versions profile the ATen call outside the Python dispatch
 # callback. Match its unique enclosing same-name CPU operator to the marker.
 for ident,rs in ranges.items():
  if len(rs)!=1:continue
  marker=rs[0];candidates=[e for unused,e in containing(cpu_index.get((marker.get('pid'),marker.get('tid'))),marker) if e.get('name')==nodes[ident].get('operator_name')]
  if len(candidates)==1:
   ext=candidates[0].get('args',{}).get('External id')
   if ext is not None:external.setdefault((candidates[0].get('pid'),ext),set()).add(ident)
 for e in events:
  args=e.get('args',{});corr=args.get('correlation');ext=args.get('External id')
  if e.get('cat') in ('cuda_runtime','cuda_driver') and corr is not None:
   owners=external.get((e.get('pid'),ext),set());runtime.setdefault((e.get('pid'),corr),set()).update(owners if len(owners)==1 else {'unattributed'})
 by_correlation=collections.defaultdict(set)
 for (pid,corr),owners in runtime.items():by_correlation[corr].update(owners)
 for e in events:
  if e.get('cat')!='kernel' or e.get('ph')!='X':continue
  kernel_count+=1;args=e.get('args',{});ext=args.get('External id');owners=external.get((e.get('pid'),ext),set())
  if len(owners)!=1:
   # Kineto GPU pid can differ from the CPU pid. Resolve correlation only when
   # it is unique across all captured processes; ambiguity remains unassigned.
   owners=by_correlation.get(args.get('correlation'),set())
  if len(owners)==1 and next(iter(owners)) in nodes:
   n=nodes[next(iter(owners))];n.setdefault('kernels',[]).append(dict(name=e['name'],start_us=e['ts'],duration_ns=round(e['dur']*1000),stream=args.get('stream'),correlation=args.get('correlation')))
 for n in nodes.values():
  if n.get('kernels'):n['duration_ns']=sum(k['duration_ns'] for k in n['kernels']);n['timing_scope']='Summed durations of explicitly joined GPU kernels, not CPU time or guaranteed saving.'
 graph['kernel_attribution']=dict(total=kernel_count,joined=sum(len(n.get('kernels',[])) for n in nodes.values()),method='Unique explicit same-run marker / CPU operator External id / CUDA correlation; ambiguous associations omitted.')
 return graph

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',type=Path,required=True);parser.add_argument('target',nargs=argparse.REMAINDER);a=parser.parse_args();target=a.target[1:] if a.target[:1]==['--'] else a.target
 if not target:parser.error('provide -- target.py [arguments]')
 if '--profile' in target:parser.error('remove target --profile: this tool owns the profiler')
 try:
  import torch
  from torch.utils._python_dispatch import TorchDispatchMode
  from torch.utils._pytree import tree_flatten
 except ImportError as e:parser.exit(2,'PyTorch is required on the execution host: '+str(e)+'\n')
 a.out.mkdir(parents=True,exist_ok=True)
 for name in ['tensor-graph.json','trace.json','capture.json']:
  if (a.out/name).exists():parser.error('refusing to overwrite '+str(a.out/name))
 tracker=DependencyTracker();storages={};tensor_ids={};logical_versions=collections.defaultdict(int);serial=0;capture_id=str(uuid.uuid4())
 def descriptor(t):
  nonlocal serial
  storage=t.untyped_storage();key=(str(t.device),storage._cdata);entry=storages.get(key)
  if entry is None or entry[0]() is None:serial+=1;entry=(weakref.ref(storage),'storage'+str(serial));storages[key]=entry
  key_t=id(t);entry_t=tensor_ids.get(key_t)
  if entry_t is None or entry_t[0]() is not t:serial+=1;entry_t=(weakref.ref(t),'tensor'+str(serial));tensor_ids[key_t]=entry_t
  try:native_version=t._version
  except RuntimeError:native_version=None
  return dict(tensor=entry_t[1]+'@v'+str(logical_versions[entry[1]]),storage=entry[1],shape=list(t.shape),stride=list(t.stride()),offset=t.storage_offset(),dtype=str(t.dtype),device=str(t.device),version=logical_versions[entry[1]],native_version=native_version)
 class Capture(TorchDispatchMode):
  def __torch_dispatch__(self,func,types,args=(),kwargs=None):
   kwargs=kwargs or {};flat,_=tree_flatten((args,kwargs));inputs=[descriptor(t) for t in flat if isinstance(t,torch.Tensor)];writes=set()
   for i,arg in enumerate(func._schema.arguments):
    if arg.alias_info is not None and arg.alias_info.is_write:
     val=args[i] if i<len(args) else kwargs.get(arg.name);ts,_=tree_flatten(val)
     writes.update(descriptor(t)['storage'] for t in ts if isinstance(t,torch.Tensor))
   ident='op'+str(len(tracker.nodes))
   with torch.profiler.record_function('gpu_city_tensor:'+ident):out=func(*args,**kwargs)
   for storage in writes:logical_versions[storage]+=1
   values,_=tree_flatten(out);outputs=[descriptor(t) for t in values if isinstance(t,torch.Tensor)]
   tracker.record(str(func),inputs,outputs,writes,dict(operator_schema=str(func._schema),operator_name=func._schema.name))
   return out
 activities=[torch.profiler.ProfilerActivity.CPU]
 if torch.cuda.is_available():activities.append(torch.profiler.ProfilerActivity.CUDA)
 old_argv=sys.argv;old_path=sys.path[:];sys.argv=target;sys.path.insert(0,str(Path(target[0]).resolve().parent))
 try:
  with torch.profiler.profile(activities=activities,record_shapes=True,with_stack=True) as prof:
   with Capture():runpy.run_path(target[0],run_name='__main__')
   if torch.cuda.is_available():torch.cuda.synchronize()
 finally:sys.argv=old_argv;sys.path[:]=old_path
 prof.export_chrome_trace(str(a.out/'trace.json'))
 graph=dict(id=capture_id,trace_sha256=hashlib.sha256((a.out/'trace.json').read_bytes()).hexdigest(),label='Captured tensor dependencies',kind='runtime',scope='Instrumented diagnostic execution; eager/operator coverage only, no whole-step completeness guarantee.',nodes=tracker.nodes,edges=tracker.edges,limits=['Whole-storage hazards are conservative and can include disjoint views.','Compiled/custom opaque kernels require explicit buffer instrumentation.','Storage lifetime ambiguity or external inputs remains unknown; no edges from equal shapes.','Missing graph paths alone do not prove safe overlap: side effects, resources and stream scheduling require validation.'])
 attach_kernels(graph,json.loads((a.out/'trace.json').read_text()))
 (a.out/'tensor-graph.json').write_text(json.dumps(dict(schema_version=1,kind='tensor_dependencies',default=capture_id,graphs=[graph]),separators=(',',':')))
 (a.out/'capture.json').write_text(json.dumps(dict(capture_id=capture_id,trace_sha256=graph['trace_sha256'],torch_version=torch.__version__,target=target,device='cuda' if torch.cuda.is_available() else 'cpu',kernel_attribution=graph['kernel_attribution']),indent=2))
 print(json.dumps(graph['kernel_attribution']));print('Open tensor-graph.json with the dashboard Tensor dependencies loader.')
if __name__=='__main__':main()
