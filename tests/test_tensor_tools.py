import importlib.util,json,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def module(name):
 spec=importlib.util.spec_from_file_location(name,ROOT/'tools'/f'{name}.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
capture=module('capture_tensor_graph');build=module('build_tensor_sources')
class TensorTests(unittest.TestCase):
 def test_shared_reads_independent_and_mutation_hazards(self):
  t=capture.DependencyTracker();d=lambda tensor,storage:dict(tensor=tensor,storage=storage)
  t.record('produce',[],[d('a@v0','A')],[])
  t.record('left',[d('a@v0','A')],[d('b@v0','B')],[])
  t.record('right',[d('a@v0','A')],[d('c@v0','C')],[])
  self.assertFalse(any(e['from_id']=='op1' and e['to_id']=='op2' for e in t.edges))
  t.record('inplace',[d('a@v0','A')],[d('a@v1','A')],['A'])
  self.assertTrue(all(any(e['from_id']==p and e['to_id']=='op3' for e in t.edges) for p in ['op0','op1','op2']))
  t.record('consume new version',[d('a@v1','A')],[],[])
  self.assertTrue(any(e['from_id']=='op3' and e['to_id']=='op4' and e['kind']=='tensor' for e in t.edges))
 def test_alias_and_equal_shapes_do_not_confuse_identity(self):
  t=capture.DependencyTracker();a=dict(tensor='a',storage='A',shape=[8]);b=dict(tensor='b',storage='B',shape=[8]);view=dict(tensor='view',storage='A',shape=[4])
  t.record('a',[],[a],[]);t.record('b',[],[b],[]);t.record('view',[a],[view],[]);t.record('read alias',[view],[],[])
  self.assertFalse(any(e['from_id']=='op0' and e['to_id']=='op1' for e in t.edges));self.assertTrue(any(e['from_id']=='op2' and e['to_id']=='op3' for e in t.edges))
 def test_kernel_join_exact_same_run_and_ambiguity(self):
  graph=dict(nodes=[dict(id='op0',operator_name='aten::add')]);events=[dict(ph='X',cat='cpu_op',name='aten::add',pid=1,tid=1,ts=0,dur=10,args={'External id':42}),dict(ph='X',cat='user_annotation',name='gpu_city_tensor:op0',pid=1,tid=1,ts=1,dur=8),dict(ph='X',cat='cuda_runtime',name='cudaLaunchKernel',pid=1,tid=1,ts=4,dur=1,args={'External id':42,'correlation':7}),dict(ph='X',cat='kernel',name='add',pid=0,tid=7,ts=12,dur=2,args={'correlation':7})]
  result=capture.attach_kernels(graph,dict(traceEvents=events));self.assertEqual(result['kernel_attribution']['joined'],1);self.assertEqual(result['nodes'][0]['duration_ns'],2000)
  events[1]['name']='another run marker';graph=dict(nodes=[dict(id='op0',operator_name='aten::add')]);self.assertEqual(capture.attach_kernels(graph,dict(traceEvents=events))['kernel_attribution']['joined'],0)
 def test_kernel_correlation_ambiguity_is_not_joined(self):
  graph=dict(nodes=[dict(id='op0',operator_name='aten::add')]);events=[dict(ph='X',cat='cpu_op',name='aten::add',pid=1,tid=1,ts=0,dur=10,args={'External id':42}),dict(ph='X',cat='user_annotation',name='gpu_city_tensor:op0',pid=1,tid=1,ts=1,dur=8),dict(ph='X',cat='cuda_runtime',name='launch',pid=1,tid=1,ts=4,dur=1,args={'External id':42,'correlation':7}),dict(ph='X',cat='cuda_runtime',name='untracked launch',pid=2,tid=1,ts=4,dur=1,args={'External id':42,'correlation':7}),dict(ph='X',cat='kernel',name='add',pid=0,tid=7,ts=12,dur=2,args={'correlation':7})]
  self.assertEqual(capture.attach_kernels(graph,dict(traceEvents=events))['kernel_attribution']['joined'],0)
 def test_source_snapshots_have_valid_hashes(self):
  import hashlib
  for graph in json.loads((ROOT/'data/tensor-dependencies.json').read_text())['graphs']:
   self.assertEqual(hashlib.sha256(graph['source'].encode()).hexdigest(),graph['source_sha256'])
 def test_source_branches_and_ssa_versions(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'example.py';p.write_text('def f(x):\n a=x.float()\n b=x.square()\n x=a+b\n return x\n')
   g=build.SourceGraph(p,'f').build();nodes=g['nodes'];a=next(n for n in nodes if n['outputs']==['a']);b=next(n for n in nodes if n['outputs']==['b'])
   self.assertFalse(any(e['from_id']==a['id'] and e['to_id']==b['id'] for e in g['edges']));self.assertTrue(all(n['duration_ns'] is None for n in nodes))
 def test_chained_module_receiver_is_not_lost(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'example.py';p.write_text('class FFN:\n def forward(self,x):\n  a,b=self.gateup(x).chunk(2,-1)\n  return a*b\n')
   g=build.SourceGraph(p,'FFN.forward').build();gate=next(n for n in g['nodes'] if n['label']=='self.gateup');chunk=next(n for n in g['nodes'] if n['label']=='chunk')
   self.assertTrue(any(e['from_id']==gate['id'] and e['to_id']==chunk['id'] for e in g['edges']));self.assertTrue(any(e['to_id']==gate['id'] and e['tensor']=='x' for e in g['edges']))
 def test_compiler_dataflow_not_call_order(self):
  bundle=json.loads((ROOT/'data/tensor-dependencies.json').read_text());g=next(g for g in bundle['graphs'] if g['kind']=='compiler' and len([n for n in g['nodes'] if n['kind']=='compiled_kernel'])==3);ks=[n for n in g['nodes'] if n['kind']=='compiled_kernel']
  self.assertTrue(any(e['from_id']==ks[0]['id'] and e['to_id']==ks[1]['id'] and e['tensor']=='buf0' for e in g['edges']))
  self.assertFalse(any(e['from_id'] in [ks[0]['id'],ks[1]['id']] and e['to_id']==ks[2]['id'] for e in g['edges']))
  self.assertTrue(set(ks[0]['inputs'])&set(ks[2]['inputs']))
if __name__=='__main__':unittest.main()
