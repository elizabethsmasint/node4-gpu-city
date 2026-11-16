#!/usr/bin/env python3
"""Read source with ast; never import or execute model/compiler code."""
import argparse,ast,hashlib,json,re
from pathlib import Path

def sha(text):return hashlib.sha256(text.encode()).hexdigest()
class SourceGraph:
 def __init__(self,path,scope):
  self.path=path;self.text=path.read_text();self.scope=scope;self.nodes=[];self.edges=[];self.names={};self.counter=0
 def node(self,label,inputs,expr=None,kind='operation',outputs=None):
  ident='s'+str(len(self.nodes));inputs=list(dict.fromkeys(inputs));n=dict(id=ident,label=label,kind=kind,inputs=inputs,outputs=outputs or [ident],duration_ns=None,source_line=getattr(expr,'lineno',None),expression=ast.get_source_segment(self.text,expr) if expr else label,category='matmul' if 'bmm' in label or 'Linear' in label else 'other',evidence='Source expression / SSA tensor-value dependency; no runtime launch attribution.')
  self.nodes.append(n)
  for inp in inputs:self.edges.append(dict(from_id=inp,to_id=ident,tensor=self.nodes[int(inp[1:])]['outputs'][0],kind='tensor',evidence=f'Source value consumed by expression at line {n["source_line"]}'))
  return ident
 def external(self,name,kind='input'):
  if name not in self.names:self.names[name]=self.node(name,[],kind=kind,outputs=[name])
  return self.names[name]
 def expr(self,x):
  if x is None or isinstance(x,ast.Constant):return []
  if isinstance(x,ast.Name):return [self.names[x.id]] if x.id in self.names else []
  if isinstance(x,ast.Attribute):
   if x.attr in ('shape','device','dtype','h','kd','inner','chunk_size'):return [] # metadata, not device tensor readiness
   name=ast.unparse(x)
   if name.startswith('self.'):return [self.external(name,'parameter')]
   return self.expr(x.value)
  if isinstance(x,ast.Call):
   name=ast.unparse(x.func);inputs=[]
   tensor_methods={'float','to','reshape','view','transpose','permute','contiguous','unsqueeze','squeeze','chunk','split','tril','clamp_min','log','cumsum','exp','sigmoid','square','mean'}
   method=isinstance(x.func,ast.Attribute) and (any(isinstance(n,ast.Call) for n in ast.walk(x.func.value)) or x.func.attr in tensor_methods or not name.startswith(('torch.','F.','self.')))
   # Namespace prefixes on a chained expression do not turn its receiver into
   # a module: self.gateup(x).chunk must retain the gateup(x) tensor producer.
   if method:inputs+=self.expr(x.func.value)
   if name.startswith('self.') and not method:inputs+=[self.external(name+' parameters','parameter')]
   for arg in x.args:inputs+=self.expr(arg)
   for arg in x.keywords:inputs+=self.expr(arg.value)
   if name=='record_function':return []
   label=x.func.attr if method else name
   return [self.node(label,inputs,x)]
  if isinstance(x,ast.BinOp):return [self.node({ast.Add:'add',ast.Sub:'subtract',ast.Mult:'multiply',ast.Div:'divide',ast.Pow:'power'}.get(type(x.op),type(x.op).__name__),self.expr(x.left)+self.expr(x.right),x)]
  if isinstance(x,ast.UnaryOp):return self.expr(x.operand)
  if isinstance(x,ast.Subscript):
   inputs=self.expr(x.value)
   return [self.node('view / slice',inputs,x)] if inputs else []
  if isinstance(x,(ast.Tuple,ast.List)):return [v for e in x.elts for v in self.expr(e)]
  return []
 def assign(self,target,values):
  if isinstance(target,ast.Name):
   if len(values)==1:self.names[target.id]=values[0];self.nodes[int(values[0][1:])]['outputs']=[target.id]
  elif isinstance(target,(ast.Tuple,ast.List)):
   for i,t in enumerate(target.elts):
    if len(values)==len(target.elts):self.assign(t,[values[i]])
    elif len(values)==1:self.assign(t,[self.node('select output '+str(i),values,target,kind='view')])
 def statements(self,body):
  for stmt in body:
   if isinstance(stmt,ast.Assign):
    values=self.expr(stmt.value)
    for target in stmt.targets:self.assign(target,values)
   elif isinstance(stmt,ast.With):self.statements(stmt.body)
   elif isinstance(stmt,ast.Return):
    xs=stmt.value.elts if isinstance(stmt.value,ast.Tuple) else [stmt.value]
    for i,x in enumerate(xs):self.node('Return '+ast.unparse(x),self.expr(x),stmt,kind='output',outputs=['return_'+str(i)])
   elif isinstance(stmt,ast.Expr) and isinstance(stmt.value,ast.Constant):pass
   else:raise ValueError('Unsupported control flow at '+str(getattr(stmt,'lineno','?')))
 def build(self):
  tree=ast.parse(self.text);parts=self.scope.split('.')
  if len(parts)==1:fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==parts[0])
  else:cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name==parts[0]);fn=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name==parts[1])
  for arg in fn.args.args:
   if arg.arg!='self':self.external(arg.arg)
  self.statements(fn.body)
  return dict(id=self.scope,label={'_chunk_delta_exact_impl':'GDN chunk forward · source values','FFN.forward':'Dense FFN forward · source values','Block.forward':'Residual block forward · source values'}.get(self.scope,self.scope),kind='source',scope='Single source function; operation/value graph, not measured individual CUDA launches or the full training step.',source_file=self.path.name,source_sha256=sha(self.text),source=self.text,nodes=self.nodes,edges=self.edges,limits=['Metadata-only shape/device/dtype access is excluded from tensor-readiness edges.','Operation calls may map to zero, one or many kernels; runtime durations are unavailable.','Opaque module calls may have internal dependencies not expanded here.','Unconnected branches are candidates for overlap investigation, not measured concurrency or proven speedup.'])

def compiled_graph(path):
 text=path.read_text();tree=ast.parse(text);kernels={}
 for n in ast.walk(tree):
  if isinstance(n,ast.Assign) and isinstance(n.value,ast.Call) and ast.unparse(n.value.func)=='async_compile.triton':
   code=n.value.args[1].value;kt=ast.parse(code);fn=next(f for f in kt.body if isinstance(f,ast.FunctionDef) and f.name==n.value.args[0].value);args=[a.arg for a in fn.args.args];reads=set();writes=set()
   for call in ast.walk(fn):
    if isinstance(call,ast.Call) and ast.unparse(call.func) in ('tl.load','tl.store'):
     used={x.id for x in ast.walk(call.args[0]) if isinstance(x,ast.Name)}&set(args)
     (reads if ast.unparse(call.func)=='tl.load' else writes).update(used)
   kernels[n.targets[0].id]=dict(args=args,reads=reads,writes=writes)
 calls=[n for n in ast.walk(tree) if isinstance(n,ast.FunctionDef) and n.name=='call']
 if not calls:return None
 fn=calls[0];nodes=[];edges=[];producer={};versions={};shapes={};aliases={}
 def resource(name):
  if name not in producer:
   ident='input:'+name;nodes.append(dict(id=ident,label=name,kind='input',inputs=[],outputs=[name],duration_ns=None,shape=shapes.get(name)));producer[name]=ident
  return producer[name]
 for stmt in ast.walk(fn):
  if isinstance(stmt,ast.Call) and ast.unparse(stmt.func)=='assert_size_stride' and isinstance(stmt.args[0],ast.Name):shapes[stmt.args[0].id]=ast.unparse(stmt.args[1])
 for stmt in sorted((n for n in ast.walk(fn) if isinstance(n,(ast.Assign,ast.Expr))),key=lambda n:n.lineno):
  if isinstance(stmt,ast.Assign) and isinstance(stmt.value,ast.Call) and ast.unparse(stmt.value.func)=='reinterpret_tensor' and isinstance(stmt.targets[0],ast.Name):aliases[stmt.targets[0].id]=ast.unparse(stmt.value.args[0]);continue
  call=stmt.value
  if not isinstance(call,ast.Call) or not isinstance(call.func,ast.Attribute) or call.func.attr!='run':continue
  name=ast.unparse(call.func.value)
  if name not in kernels:continue
  kernel=kernels[name];actual=dict(zip(kernel['args'],[ast.unparse(a) for a in call.args]));reads=[actual[a] for a in kernel['args'] if a in kernel['reads']];writes=[actual[a] for a in kernel['args'] if a in kernel['writes']];ident='kernel:'+str(len(nodes));inputs=[]
  for name_ in reads:
   name_=aliases.get(name_,name_);src=resource(name_);inputs.append(name_);edges.append(dict(from_id=src,to_id=ident,tensor=name_,kind='tensor',evidence='Compiler wrapper argument bound to pointer used by tl.load; last writer established from tl.store.'))
  nodes.append(dict(id=ident,label=name,kind='compiled_kernel',inputs=reads,outputs=writes,duration_ns=None,source_line=stmt.lineno,expression=ast.get_source_segment(text,stmt),category='triton',evidence='Saved compiler wrapper and parsed Triton pointer loads/stores. No per-launch runtime join.'))
  for out in writes:producer[aliases.get(out,out)]=ident
 if not any(n['kind']=='compiled_kernel' for n in nodes):return None
 return dict(id='compiler:'+path.stem,label='Compiled '+('RMSNorm backward' if sum(n['kind']=='compiled_kernel' for n in nodes)>1 else 'RMSNorm forward'),kind='compiler',scope='Saved Original compiler fragment; buffer producer/consumer relationships, not a whole-step graph or a per-launch timing join.',source_file=str(path),source_sha256=sha(text),source=text,nodes=nodes,edges=edges,limits=['Only parsed Triton tl.load/tl.store arguments are included. No inferred edges from call order.','Shared input reads do not create dependencies between independent kernels.','Other eager operators and model regions are outside this compiler fragment.','Kernel duration and a measured critical path require same-run launch attribution.'])

def main():
 p=argparse.ArgumentParser();p.add_argument('--source-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();root=a.source_root
 graphs=[SourceGraph(root/'exact_gdn.py','_chunk_delta_exact_impl').build(),SourceGraph(root/'prometheus_spark_proxy.py','FFN.forward').build(),SourceGraph(root/'prometheus_spark_proxy.py','Block.forward').build()]
 cache=root/'results/fresh_compare_20261111T152943Z_Eghzhe/original/cache/inductor'
 for path in sorted(cache.glob('*/*.py')):
  if 'def call(self, args):' not in path.read_text():continue
  graph=compiled_graph(path)
  if graph:graphs.append(graph)
 result=dict(schema_version=1,kind='tensor_dependencies',graphs=graphs,default='_chunk_delta_exact_impl',provenance='AST-derived SSA tensor values and saved compiler buffer reads/writes; no timestamp adjacency edges.')
 a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(result,separators=(',',':')))
 print([(g['label'],len(g['nodes']),len(g['edges'])) for g in graphs])
if __name__=='__main__':main()
