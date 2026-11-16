"""Read-only trace normalization. Standard library only; all replay times are integer ns."""
from __future__ import annotations
import argparse, ast, bisect, collections, csv, gzip, hashlib, json, math, re, shutil, sqlite3, statistics, subprocess
from decimal import Decimal
from pathlib import Path

# Publication layout: result artifacts may be placed under results/ at the repo root.
ROOT = Path(__file__).resolve().parent.parent
APP = ROOT
FRESH = ROOT / 'results/fresh_compare_20261111T152943Z_Eghzhe'
EVENT_FIELDS = ['start_ns','duration_ns','group','stream','correlation','api_start_ns','api_duration_ns','operator','device','context','process','grid_id']
COLORS = {'add':'#eeae53','fill':'#bd91e8','matmul':'#58cfb2','reduction':'#f17870','copy':'#78bcea','triton':'#e1e86b','gdn':'#f192b9','multiply':'#77c7cc','elementwise':'#94b78c','other':'#8f9aa9'}

def classify(name):
    """Conservative implementation-name classification; never confuse a CPU aten name with a kernel."""
    n=name.lower()
    if '_assemble_fwd' in n or '_assemble_bwd' in n: return 'triton'
    if n.startswith('triton') or 'triton_' in n: return 'triton'
    if 'trsm' in n or 'triangular_solve' in n: return 'gdn'
    if any(x in n for x in ('gemm','gemv','matmul','mma_kernel')): return 'matmul'
    if any(x in n for x in ('cudafunctor_add','addfunctor','aten::add','add_kernel')): return 'add'
    if any(x in n for x in ('fill_functor','fillfunctor','fill_kernel','aten::fill','memset')): return 'fill'
    if any(x in n for x in ('reduce','reduction','cumsum','scan')): return 'reduction'
    if any(x in n for x in ('copy','memcpy','cast_kernel')): return 'copy'
    if any(x in n for x in ('mulfunctor','multiply','mul_kernel','aten::mul')): return 'multiply'
    if any(x in n for x in ('elementwise','vectorized','unrolled','exp_kernel','triu_tril')): return 'elementwise'
    return 'other'

def dtype(name):
    if re.search(r'bfloat16|bf16',name,re.I): return 'BF16 (signature; may include FP32 arithmetic)'
    if re.search(r'\bfloat\b|s1688gemm|trsm.*If|_assemble_',name): return 'FP32 (signature)'
    if re.search(r'\bhalf\b|f16|fp16',name,re.I): return 'FP16 / mixed (signature)'
    if 'double' in name: return 'FP64 (signature)'
    return None

def union_intervals(intervals):
    out=[]
    for a,b in sorted(intervals):
        if b<a: raise ValueError('Negative event duration')
        if out and a<=out[-1][1]: out[-1][1]=max(out[-1][1],b)
        else: out.append([a,b])
    return out

def gaps_in(intervals, start, end):
    gaps=[]; cursor=start
    for a,b in union_intervals(intervals):
        a=max(start,a); b=min(end,b)
        if a>cursor: gaps.append([cursor,a])
        cursor=max(cursor,b)
    if cursor<end: gaps.append([cursor,end])
    return gaps

def improvement(before,after):
    if before is None or after is None: return {'speedup':None,'reduction_pct':None,'saved':None}
    return {'speedup':before/after if after else None,'reduction_pct':100*(before-after)/before if before else None,'saved':before-after}

def brief(name,cat):
    if '_assemble_fwd' in name: return 'GDN · fused assembly forward'
    if '_assemble_bwd' in name: return 'GDN · fused assembly backward'
    if cat=='gdn': return 'GDN · triangular solve'
    d='BF16' if 'BF16' in (dtype(name) or '') else 'FP32' if 'FP32' in (dtype(name) or '') else ''
    if cat in ('add','fill','multiply','reduction','copy','matmul'): return f'{d} {cat}'.strip()
    if 'exp_kernel' in name: return 'FP32 exponential'
    if 'triu_tril' in name: return 'Triangular mask'
    if name.startswith('triton_'): return name[:66]
    return name if len(name)<64 else (name.split('<')[0].split('::')[-1][:58])

def semantics(g, node4=False):
    cat=g['category']; name=g['name']; d=g['dtype'] or ''
    common={
      'add': ('A + αB → output', 'Each element reads two operands, adds the scaled second operand, then writes the result. In-place and out-of-place CPU operations can launch the same implementation. Low arithmetic per logical byte is a structural property, not proof of a bandwidth bottleneck.'),
      'fill': ('value → destination', 'Writes a scalar throughout a destination buffer. No tensor input needs loading. The kernel name alone does not reveal the value, buffer shape, allocation purpose, or its consumers.'),
      'matmul': ('A × B → C', 'Output tiles contain dot products of input rows and columns. Work crews illustrate tiled multiply-accumulate. Tensor dimensions and the precise math mode are unavailable unless captured in operator metadata.'),
      'reduction': ('many values → fewer values', 'Combines input elements into smaller outputs. The exact reducer and axes are shown only when recoverable from metadata; sums in the animation are a representative example.'),
      'copy': ('source → destination', 'Moves or converts elements. Copy kernels execute on the GPU; CUDA memcpy activity is listed separately. Byte counts cannot be inferred reliably from the launch grid.'),
      'multiply': ('A × B → output', 'Elementwise multiplication. Scalar factors and broadcasting depend on operator inputs, which Nsight Systems does not record here.'),
      'gdn': ('M U = RHS → U', 'Batched triangular solve used by GDN. The source builds a unit lower-triangular system, solves for updates U, and applies the recurrent state updates. Assembly and solve remain separate kernels.'),
      'triton': ('fused program → output', 'A Triton program executes several generated operations. The name is preserved; the exact computation is unavailable without its generated source. This is not automatically one of the custom GDN kernels.'),
      'elementwise': ('elements → transformed elements', 'Elementwise work inferred from the implementation name. The visualization is generic unless the precise function is identifiable.'),
      'other': ('dispatch → execute → complete', 'Implementation name and measured execution are available. Exact computation could not be recovered; the machine animation intentionally has no invented arithmetic.')
    }
    formula,explanation=common[cat]
    s={'formula':formula,'explanation':explanation,'source':None,'source_line':None,'shape_context':None,'logical_bytes':None,'fill_value':None,'alpha':None,'evidence':'Implementation signature; animation values and workers are illustrative.', 'dependency':'Preceding/following events show temporal order only. Buffer dependencies and overwrite relationships are unavailable.'}
    if node4 and cat=='gdn': s.update(source='exact_gdn.py',source_line=43)
    if node4 and cat in ('add','fill') and g['grid']==[32768,1,1] and g['block']==[128,1,1] and ('vectorized_elementwise_kernel' in name):
        item=2 if 'BF16' in d else 4
        s.update(source='exact_gdn.py',source_line=101,shape_context=[4096,64,128],logical_bytes=4096*64*128*item*(3 if cat=='add' else 1),fill_value=0 if cat=='fill' else None,alpha=1 if cat=='add' else None,
          evidence='Family attribution from separate historical PyTorch source_trace_16k/trace.json: matching signatures + launch configuration and aten::add_/fill_ inside SliceBackward0. Not a per-launch join to this Nsight capture.',
          explanation=('Accumulates a full segment-sized slice gradient into its parent gradient. ' if cat=='add' else 'Zero-initializes a full segment-sized slice-gradient buffer before the chunk gradient is placed in its slice. ')+
          'Historical operator inputs are [4096, 64, 128]. Repeated chunk slicing in the original GDN causes large SliceBackward gradients. Stage A uses torch.split, eliminating these four large add/fill groups before custom Triton fusion.',
          dependency='Historical SliceBackward attribution establishes initialization and gradient accumulation at the family level; fresh per-buffer producer/consumer identities are not recorded.')
    if node4 and '_assemble_' in name:
        bwd='_bwd' in name
        s.update(source='fusion_trial/gdn_triton_fusion.py',source_line=37 if bwd else 12,shape_context=[64,64,64],
          formula='dM → mask → dKK, dRatio, dBeta' if bwd else 'I + tril(β · KK · Ratio, −1) → M',
          explanation=('Masks the upstream gradient, computes gradients for KK and Ratio, and reduces contributions into beta gradients in one launch.' if bwd else 'Multiplies beta, the key-key matrix and decay ratios, applies a strict lower-triangle mask, and writes the identity diagonal in one launch.')+' This fuses matrix assembly only. Batched GEMMs, ratio construction and triangular solve remain separate.',
          evidence='Custom source inspected; H=64, C=64 follows this captured workload and source. Shapes are source context, not Nsight tensor arguments.')
    if 'exp_kernel' in name: s.update(formula='exp(x) → output',explanation='Elementwise exponential, identified by exp_kernel_cuda. Node4 uses exponentials in decay ratios and streaming cross entropy; this launch has no captured CPU stack to choose between them.')
    if 'triu_tril' in name: s.update(formula='matrix → triangular mask',explanation='Retains a triangular portion of a matrix and masks the rest. The diagonal offset is unavailable in this capture.')
    return s

def finalize(data,node4=False):
    groups=data['groups']; events=data['events']; duration=data['duration_ns']
    events.sort(key=lambda e:(e[0],e[8],e[3]))
    for g in groups: g.update(count=0,total_ns=0,min_ns=None,max_ns=0,first_event=None)
    for i,e in enumerate(events):
        if e[1]<0 or e[0]<0 or e[0]+e[1]>duration: raise ValueError('Event outside selected interval')
        g=groups[e[2]];g['count']+=1;g['total_ns']+=e[1];g['min_ns']=min(g['min_ns'] if g['min_ns'] is not None else e[1],e[1]);g['max_ns']=max(g['max_ns'],e[1]);
        if g['first_event'] is None:g['first_event']=i
    total=sum(e[1] for e in events)
    for g in groups:
        g.update(avg_ns=g['total_ns']/g['count'] if g['count'] else 0,pct=100*g['total_ns']/total if total else 0)
        g['semantics']=semantics(g,node4)
    intervals=[(e[0],e[0]+e[1]) for e in events]
    union=union_intervals(intervals)
    memory=data.get('memory',[])
    activity=intervals+[(e['start_ns'],e['start_ns']+e['duration_ns']) for e in memory]
    gaps=gaps_in(activity,0,duration)
    cat=collections.defaultdict(lambda:{'count':0,'total_ns':0})
    for g in groups: cat[g['category']]['count']+=g['count'];cat[g['category']]['total_ns']+=g['total_ns']
    data['stats']={'kernel_count':len(events),'kernel_sum_ns':total,'kernel_union_ns':sum(b-a for a,b in union),'kernel_span_ns':max((e[0]+e[1] for e in events),default=0)-min((e[0] for e in events),default=0),'capture_ns':duration,'no_activity_ns':sum(b-a for a,b in gaps),'max_gap_ns':max((b-a for a,b in gaps),default=0),'launch_api_sum_ns':data.pop('launch_api_sum_ns',None),'launch_api_count':data.pop('launch_api_count',None),'categories':dict(cat),'memory_activity_count':len(memory),'memory_activity_bytes':sum(e.get('bytes') or 0 for e in memory)}
    data['gaps']=sorted(gaps,key=lambda x:x[1]-x[0],reverse=True)[:150]
    issues=[]
    for g in sorted(groups,key=lambda g:g['total_ns'],reverse=True)[:14]:
        if g['category'] in ('add','fill','reduction','copy') or g['avg_ns']>=100000 or g['count']>=1000:
            issues.append({'kind':'measured','group':g['id'],'title':f"{g['label']} · {g['count']:,} launches",'cost_ns':g['total_ns'],'detail':f"{g['total_ns']/1e6:.3f} ms summed GPU time ({g['pct']:.2f}%). Mean {g['avg_ns']/1000:.2f} µs. This is measured cost, not automatically avoidable work.",'hypothesis':'Consider reducing intermediate work only after confirming data dependencies and correctness.'})
    short=[g for g in groups if g['count']>=500 and g['avg_ns']<10000]
    if short:
        g=max(short,key=lambda g:g['count']);issues.append({'kind':'hypothesis','group':g['id'],'title':'Frequent short production orders','cost_ns':g['total_ns'],'detail':f"{g['count']:,} launches average {g['avg_ns']/1000:.2f} µs in this signature. Host API timing is separate and can overlap execution.",'hypothesis':'Fusion or batching might help; short duration alone does not establish launch-bound execution.'})
    if gaps:
        a,b=max(gaps,key=lambda x:x[1]-x[0]);issues.append({'kind':'measured','range':[a,b],'title':'Largest interval without captured GPU activity','cost_ns':b-a,'detail':f'{(b-a)/1e6:.3f} ms without kernels, copies or memsets in this capture. Other processes and untraced engines are not observed.','hypothesis':'Could reflect host work, synchronization or scheduling. No CPU cause is established.'})
    data['issues']=sorted(issues,key=lambda x:x['cost_ns'],reverse=True)
    data['schema_version']=1;data['event_fields']=EVENT_FIELDS
    return data

def read_nsys(path, start_ns=None,end_ns=None,sync_pair=None,label=None,node4=False):
    path=Path(path);db=sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
    tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if 'CUPTI_ACTIVITY_KIND_KERNEL' not in tables: raise ValueError('No CUPTI_ACTIVITY_KIND_KERNEL table. Export an Nsight Systems CUDA capture to SQLite.')
    strings=dict(db.execute('SELECT id,value FROM StringIds'))
    apis=[]
    for table in ('CUPTI_ACTIVITY_KIND_RUNTIME','CUPTI_ACTIVITY_KIND_DRIVER'):
        if table in tables:
            for row in db.execute('SELECT * FROM '+table):
                r=dict(row);r['name']=strings.get(r.get('nameId'),'Unknown API');apis.append(r)
    sync=sorted([r for r in apis if r['name'].startswith('cudaDeviceSynchronize')],key=lambda r:r['start'])
    boundary='Explicit interval'
    if sync_pair is not None:
        try:start_ns,end_ns=sync[sync_pair[0]]['end'],sync[sync_pair[1]]['end']
        except IndexError:raise ValueError('Synchronization pair indices are out of range')
        boundary=f'Synchronization ends {sync_pair[0]} → {sync_pair[1]} (zero indexed)'
    if start_ns is None and end_ns is None:
        if len(sync)==2:start_ns,end_ns=sync[0]['end'],sync[1]['end'];boundary='Two synchronization boundaries; complete captured step'
        else:raise ValueError(f'Found {len(sync)} synchronization boundaries. Select --sync-pair i j or explicit --start-ns / --end-ns; refusing to silently include warmup.')
    if start_ns is None or end_ns is None or end_ns<=start_ns:raise ValueError('Both interval bounds are required and end must exceed start')
    apis=[r for r in apis if start_ns<=r['start'] and r['end']<=end_ns]
    launch=[r for r in apis if re.search(r'(?:cuda|cu)Launch',r['name'])]
    api_by=collections.defaultdict(list)
    for r in launch: api_by[r.get('correlationId')].append(r)
    groups=[];by_key={};events=[]
    for row in db.execute('SELECT * FROM CUPTI_ACTIVITY_KIND_KERNEL WHERE start>=? AND end<=? ORDER BY start',(start_ns,end_ns)):
        r=dict(row);name=strings.get(r.get('demangledName'),strings.get(r.get('shortName'),'Unknown kernel'))
        grid=[r.get('grid'+x) for x in 'XYZ'];block=[r.get('block'+x) for x in 'XYZ']
        mangled=strings.get(r.get('mangledName'));key=(mangled or name,*grid,*block,r.get('staticSharedMemory'),r.get('dynamicSharedMemory'),r.get('registersPerThread'))
        if key not in by_key:
            gid=len(groups);by_key[key]=gid;cat=classify(name)
            groups.append({'id':gid,'name':name,'mangled':mangled,'label':brief(name,cat),'category':cat,'dtype':dtype(name),'grid':grid,'block':block,'registers_per_thread':r.get('registersPerThread'),'static_shared_bytes':r.get('staticSharedMemory'),'dynamic_shared_bytes':r.get('dynamicSharedMemory'),'shapes':None,'fingerprint':hashlib.sha256(repr(key).encode()).hexdigest()[:12]})
        candidates=api_by.get(r.get('correlationId'),[])
        # correlation IDs may repeat across processes; globalTid encodes PID in high bits.
        candidates=[a for a in candidates if r.get('globalPid') is None or a.get('globalTid') is None or a['globalTid']//(1<<24)==r['globalPid']//(1<<24)]
        a=candidates[0] if len(candidates)==1 else None
        events.append([r['start']-start_ns,r['end']-r['start'],by_key[key],r.get('streamId'),r.get('correlationId'),a['start']-start_ns if a else None,a['end']-a['start'] if a else None,None,r.get('deviceId',0),r.get('contextId'),r.get('globalPid'),r.get('gridId')])
    if not events:
        db.close();raise ValueError('No kernel events inside the selected interval')
    memory=[]
    for table,kind in [('CUPTI_ACTIVITY_KIND_MEMCPY','memcpy'),('CUPTI_ACTIVITY_KIND_MEMSET','memset')]:
        if table in tables:
            for row in db.execute('SELECT * FROM '+table+' WHERE start>=? AND end<=? ORDER BY start',(start_ns,end_ns)):
                r=dict(row);memory.append({'kind':kind,'start_ns':r['start']-start_ns,'duration_ns':r['end']-r['start'],'bytes':r.get('bytes'),'value':r.get('value'),'copy_kind':r.get('copyKind'),'stream':r.get('streamId'),'device':r.get('deviceId',0),'context':r.get('contextId'),'process':r.get('globalPid'),'correlation':r.get('correlationId')})
    # Retain calls overlapping the interval, including boundary synchronization.
    # API start is an observed lower bound on submission; API return is not the
    # submission instant (GPU execution can start while a call is still running).
    host_names=[];host_events=[]
    all_apis=[]
    for table in ('CUPTI_ACTIVITY_KIND_RUNTIME','CUPTI_ACTIVITY_KIND_DRIVER'):
        if table in tables:
            for row in db.execute('SELECT * FROM '+table+' WHERE start<=? AND end>=? ORDER BY start',(end_ns,start_ns)):
                r=dict(row);name=strings.get(r.get('nameId'),'Unknown API')
                if not re.search(r'Launch|Memcpy|Memset|Synchronize|WaitEvent|EventRecord',name):continue
                if name not in host_names:host_names.append(name)
                host_events.append([r['start']-start_ns,r['end']-r['start'],host_names.index(name),r.get('correlationId'),r.get('globalTid'),r.get('returnValue')])
    host_events.sort(key=lambda a:a[0])
    synchronization=[];cuda_events=[]
    for table,target in [('CUPTI_ACTIVITY_KIND_SYNCHRONIZATION',synchronization),('CUPTI_ACTIVITY_KIND_CUDA_EVENT',cuda_events)]:
        if table in tables:
            for row in db.execute('SELECT * FROM '+table):
                r=dict(row)
                if 'start' in r:
                    if r['end']<start_ns or r['start']>end_ns:continue
                    r['start_ns']=r.pop('start')-start_ns;r['duration_ns']=r.pop('end')-start_ns-r['start_ns']
                elif r.get('timestamp',0):r['timestamp_ns']=r['timestamp']-start_ns
                target.append(r)
    # Only explicit event identities with a measured device completion can
    # establish an event-record -> stream-wait link. Invalid sentinels never join.
    cross_dependencies=[]
    for wait in synchronization:
        if wait.get('syncType')!=2 or wait.get('eventSyncId') in (None,4294967295) or wait.get('eventId') in (None,4294967295):continue
        matches=[r for r in cuda_events if r.get('eventSyncId')==wait.get('eventSyncId') and r.get('eventId')==wait.get('eventId') and r.get('contextId')==wait.get('contextId') and r.get('globalPid')==wait.get('globalPid') and r.get('deviceId')==wait.get('deviceId') and r.get('timestamp',0)>0]
        if len(matches)==1:
            r=matches[0];t=r['timestamp_ns'];end=wait['start_ns']+wait['duration_ns']
            if 0<=t<=end<=end_ns-start_ns:
                cross_dependencies.append({'from_stream':r['streamId'],'to_stream':wait['streamId'],'device':r['deviceId'],'context':r.get('contextId'),'process':r.get('globalPid'),'from_ns':t,'to_ns':end,'event_id':r['eventId'],'event_sync_id':r['eventSyncId'],'evidence':'Recorded CUDA event completion matched by device/context/process/eventId/eventSyncId to stream wait completion; not a tensor dependency.'})
    evidence={'host_fields':['start_ns','duration_ns','name','correlation','global_tid','return_value'],'host_names':host_names,'host_events':host_events,'synchronization':synchronization,'cuda_events':cuda_events,'cross_dependencies':cross_dependencies,'dependency_note':'Stream order and correlated host API starts are observed constraints. Missing event completion timestamps or invalid event identities cannot establish cross-stream edges. CPU scheduling, buffer identities, per-warp stalls and full causal CPU/GPU dependencies are unavailable.'}
    hardware=[]
    if 'TARGET_INFO_GPU' in tables:
        for row in db.execute('SELECT * FROM TARGET_INFO_GPU'):
            r=dict(row);hardware.append({k:r.get(k) for k in ['id','name','smCount','l2CacheSize','threadsPerWarp','totalMemory']})
    db.close()
    return finalize({'label':label or path.stem,'format':'Nsight Systems SQLite','source':str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else path.name,'source_sha256':file_hash(path),'origin_ns':str(start_ns),'duration_ns':end_ns-start_ns,'boundary':boundary,'groups':groups,'events':events,'memory':memory,'execution_evidence':evidence,'hardware':hardware,'operators':[],'launch_api_sum_ns':sum(a['end']-a['start'] for a in launch),'launch_api_count':len(launch),'phases':[],'phase_note':'Model forward/backward phase ranges are not recorded by NVTX in this Nsight capture. No boundaries have been invented.'},node4)

def file_hash(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()

def iter_trace(path):
    """Streaming Chrome traceEvents reader; Decimal preserves microsecond timestamp precision."""
    opener=gzip.open if str(path).endswith('.gz') else open
    decoder=json.JSONDecoder(parse_float=Decimal)
    with opener(path,'rt') as f:
        buf='';pos=0;found=False;eof=False
        while not found:
            part=f.read(1024*1024)
            if not part:raise ValueError('Missing traceEvents array')
            buf+=part;m=re.search(r'"traceEvents"\s*:\s*\[',buf)
            if m:pos=m.end();found=True
            elif len(buf)>8*1024*1024:raise ValueError('Trace header exceeds 8 MiB')
        while True:
            while pos<len(buf) and buf[pos] in ' \n\r\t,':pos+=1
            if pos<len(buf) and buf[pos]==']':return
            try:event,end=decoder.raw_decode(buf,pos)
            except json.JSONDecodeError:
                if eof:raise ValueError('Truncated traceEvents array')
                buf=buf[pos:];pos=0;part=f.read(1024*1024);buf+=part;eof=not part;continue
            yield event;pos=end

def trace_hardware(path):
    """Read optional PyTorch header without materializing the large events array."""
    opener=gzip.open if str(path).endswith('.gz') else open
    with opener(path,'rt') as f:
        buf=''
        while len(buf)<8*1024*1024:
            part=f.read(65536)
            if not part:break
            buf+=part;m=re.search(r'"traceEvents"\s*:',buf)
            if m:
                try:header=json.loads(buf[:m.start()].rstrip().rstrip(',')+'}')
                except json.JSONDecodeError:return []
                return [{'id':p.get('id'),'name':p.get('name'),'smCount':p.get('numSms'),'l2CacheSize':p.get('l2CacheSize'),'threadsPerWarp':p.get('warpSize'),'totalMemory':p.get('totalGlobalMem')} for p in header.get('deviceProperties',[])]
    return []

def us_ns(value):return int(Decimal(str(value))*1000)

def read_pytorch(path,label=None,start_ns=None,end_ns=None):
    # Keep only the fields needed for operators, GPU events and launch correlation.
    ops={};kernels=[];memory=[];apis={};phases=[]
    for e in iter_trace(path):
        if e.get('ph')!='X' or 'dur' not in e or 'ts' not in e:continue
        a=e.get('args',{});cat=e.get('cat','');ts=us_ns(e['ts']);dur=us_ns(e['dur'])
        if cat in ('kernel','gpu_kernel'):
            kernels.append((ts,dur,e.get('name','Unknown kernel'),a))
        elif cat in ('gpu_memcpy','gpu_memset'):
            memory.append({'kind':'memset' if cat=='gpu_memset' else 'memcpy','start_ns':ts,'duration_ns':dur,'bytes':a.get('bytes'),'value':None,'stream':a.get('stream'),'device':a.get('device',0)})
        elif cat in ('cuda_runtime','cuda_driver') and 'Launch' in e.get('name',''):
            apis[a.get('correlation')]=(ts,dur,a.get('External id'))
        elif cat=='cpu_op' and a.get('External id') is not None:
            ops[a['External id']]={'name':e['name'],'shapes':a.get('Input Dims'),'types':a.get('Input type'),'concrete_inputs':a.get('Concrete Inputs'),'stack':a.get('Call stack'),'start_ns':ts,'duration_ns':dur}
        elif cat=='user_annotation':phases.append({'name':e['name'],'start_ns':ts,'duration_ns':dur})
    if not kernels:raise ValueError('No GPU kernel events in Chrome/PyTorch trace')
    explicit_bounds=start_ns is not None or end_ns is not None
    start_ns=min(k[0] for k in kernels) if start_ns is None else start_ns
    end_ns=max(k[0]+k[1] for k in kernels) if end_ns is None else end_ns
    groups=[];by={};events=[];operators=[];op_by={}
    for ts,dur,name,a in kernels:
        if ts<start_ns or ts+dur>end_ns:continue
        grid=a.get('grid');block=a.get('block');sh=a.get('shared memory');regs=a.get('registers per thread')
        key=(name,str(grid),str(block),sh,regs)
        if key not in by:
            gid=len(groups);by[key]=gid;cat=classify(name)
            groups.append({'id':gid,'name':name,'mangled':None,'label':brief(name,cat),'category':cat,'dtype':dtype(name),'grid':grid,'block':block,'registers_per_thread':regs,'static_shared_bytes':None,'dynamic_shared_bytes':None,'shared_bytes':sh,'shapes':None,'fingerprint':hashlib.sha256(repr(key).encode()).hexdigest()[:12]})
        api=apis.get(a.get('correlation'));external=a.get('External id',api[2] if api else None);op=ops.get(external);oi=None
        if op:
            if external not in op_by:
                op_by[external]=len(operators);operators.append(op)
            oi=op_by[external]
        events.append([ts-start_ns,dur,by[key],a.get('stream'),a.get('correlation'),api[0]-start_ns if api else None,api[1] if api else None,oi,a.get('device',0)])
    for op in operators:op['start_ns']-=start_ns
    memory=[dict(m,start_ns=m['start_ns']-start_ns) for m in memory if start_ns<=m['start_ns'] and m['start_ns']+m['duration_ns']<=end_ns]
    phases=[dict(p,start_ns=p['start_ns']-start_ns) for p in phases if p['start_ns']<end_ns and p['start_ns']+p['duration_ns']>start_ns]
    return finalize({'label':label or Path(path).stem,'format':'PyTorch / Chrome JSON','source':str(path),'source_sha256':file_hash(path),'origin_ns':str(start_ns),'duration_ns':end_ns-start_ns,'boundary':'Explicit interval' if explicit_bounds else 'Complete recorded GPU span (not automatically a single step)','groups':groups,'events':events,'memory':memory,'operators':operators,'hardware':trace_hardware(path),'launch_api_sum_ns':sum(a[1] for a in apis.values() if start_ns<=a[0] and a[0]+a[1]<=end_ns),'launch_api_count':sum(1 for a in apis.values() if start_ns<=a[0] and a[0]+a[1]<=end_ns),'phases':phases,'phase_note':'CPU annotation ranges; GPU work can continue after their CPU scopes end.'})

def write_data(data,path):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    content=json.dumps(data,separators=(',',':'),ensure_ascii=False,default=lambda x:float(x) if isinstance(x,Decimal) else str(x)).encode()
    path.write_bytes(content)
    with gzip.GzipFile(str(path)+'.gz','wb',mtime=0) as f:f.write(content)

def benchmarks(mode):
    means=[];paths=[];n=0
    for repeat in [1,2,3]:
        p=FRESH/'repeats'/f'{repeat}_{mode}'/'steps.csv'
        with p.open() as f:
            rows=[r for r in csv.DictReader(f) if r['warmup'].lower()=='false']
        means.append(statistics.mean(float(r['seconds'])*1000 for r in rows));n+=len(rows);paths.append(str(p.relative_to(ROOT)))
    return {'step_ms':statistics.mean(means),'run_mean_sd_ms':statistics.stdev(means),'runs':len(means),'steps':n,'sources':paths,'note':'Independent unprofiled benchmark runs, not the replay capture wall timer.'}

def build(include_historical=True,include_source=False):
    summary=json.loads((FRESH/'measured_summary.json').read_text());samples=json.loads((FRESH/'verified_counter_samples.json').read_text())
    catalog={'datasets':[],'comparison':[],'colors':COLORS,'provenance':str(FRESH.relative_to(ROOT)),'notes':['Stage A removes the four large grid-32768 add/fill groups. Triton subsequently fuses matrix assembly and its backward.','Unprofiled step wall means, summed kernel time and capture elapsed time are distinct measurements.','Physical SM assignment, warp motion, occupancy, stalls, transaction routes and tensor values are illustrative.','This is the measured 16,384-token Node4 surrogate, not omitted proprietary/distributed production kernels.']}
    for mode,label in [('original','Original Node4'),('optimized','PyTorch optimized · Stage A'),('fused','PyTorch + Triton fusion')]:
        data=read_nsys(FRESH/mode/'gpu_timeline.sqlite',label=label,node4=True)
        expected=summary['captures'][mode]
        assert data['stats']['kernel_count']==expected['n']
        assert data['stats']['kernel_sum_ns']==round(expected['kernel_ms']*1e6)
        data['id']=mode;data['cohort']='fresh-20261111';data['benchmark']=benchmarks(mode)
        for g in data['groups']:
            for sample in samples:
                if sample['mode']==mode and sample['kernel_mangled']==g['mangled'] and list(ast.literal_eval(sample['grid']))==g['grid'] and list(ast.literal_eval(sample['block']))==g['block'] and sample['staticSharedMemory']==g['static_shared_bytes'] and sample['dynamicSharedMemory']==g['dynamic_shared_bytes']:
                    g['counter_sample']={k:sample[k] for k in ['L2_bytes','FP32_FLOPs','duration_s','raw_csv','sample_id','sha256']};g['counter_sample']['note']='Separate exactly matched representative NCU replay sample. Not per-launch traffic in this timeline; do not multiply by launch count.'
        write_data(data,APP/'data'/f'{mode}.json')
        row={k:data[k] for k in ['id','label','cohort','source','stats','benchmark','duration_ns','boundary','source_sha256']};row['url']=f'data/{mode}.json';catalog['datasets'].append(row)
        catalog['comparison'].append(row)
        print(mode,data['stats']['kernel_count'],f"{data['stats']['kernel_sum_ns']/1e6:.6f} ms",flush=True)
    if include_historical:
        data=read_nsys(ROOT/'results/nsys_16k/gpu_timeline.sqlite',sync_pair=(2,3),label='Historical original · separate capture',node4=True)
        assert data['stats']['kernel_count']==116201 and data['stats']['kernel_sum_ns']==6401736768
        data.update(id='historical',cohort='historical',benchmark=None)
        write_data(data,APP/'data/historical.json')
        catalog['datasets'].append({k:data[k] for k in ['id','label','cohort','source','stats','duration_ns']}|{'url':'data/historical.json'})
        print('historical',data['stats']['kernel_count'],flush=True)
    if include_source:
        print('Reading historical PyTorch trace (streaming JSON)…',flush=True)
        data=read_pytorch(ROOT/'results/source_trace_16k/trace.json',label='Historical PyTorch · operator shapes')
        data.update(id='source-trace',cohort='source-attribution',benchmark=None)
        write_data(data,APP/'data/source-trace.json')
        catalog['datasets'].append({k:data[k] for k in ['id','label','cohort','source','stats','duration_ns']}|{'url':'data/source-trace.json'})
        print('source-trace',data['stats']['kernel_count'],flush=True)
    catalog['improvements']={}
    for a,b in [('original','optimized'),('optimized','fused'),('original','fused')]:
        x=next(d for d in catalog['comparison'] if d['id']==a);y=next(d for d in catalog['comparison'] if d['id']==b)
        catalog['improvements'][a+'→'+b]={'step':improvement(x['benchmark']['step_ms'],y['benchmark']['step_ms']),'kernels':improvement(x['stats']['kernel_sum_ns'],y['stats']['kernel_sum_ns']),'launches':improvement(x['stats']['kernel_count'],y['stats']['kernel_count'])}
    sources=['exact_gdn.py','fusion_trial/exact_gdn_before_triton.py','fusion_trial/gdn_triton_fusion.py','fusion_trial/exact_gdn.py','streaming_ce.py','fusion_trial/streaming_ce.py','node4_fidelity_v2.py',str((FRESH/'REPORT.md').relative_to(ROOT))]
    snippets={p:(ROOT/p).read_text() for p in sources};write_data(snippets,APP/'data/sources.json')
    write_data(catalog,APP/'data/catalog.json')
    return catalog

def main():
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='command',required=True)
    b=sub.add_parser('build');b.add_argument('--no-historical',action='store_true');b.add_argument('--include-source',action='store_true')
    c=sub.add_parser('convert');c.add_argument('input',type=Path);c.add_argument('--output',type=Path,required=True);c.add_argument('--label');c.add_argument('--start-ns',type=int);c.add_argument('--end-ns',type=int);c.add_argument('--sync-pair',nargs=2,type=int)
    a=p.parse_args()
    if a.command=='build':build(not a.no_historical,a.include_source);return
    path=a.input
    if path.suffix=='.nsys-rep':
        if not shutil.which('nsys'):p.error('nsys export is required for .nsys-rep; supply an existing SQLite export instead')
        target=a.output.with_suffix('.sqlite')
        if target.exists():p.error(f'Refusing to overwrite existing export {target}')
        subprocess.run(['nsys','export','--type','sqlite','--output',str(target),str(path)],check=True);path=target
    data=read_nsys(path,a.start_ns,a.end_ns,a.sync_pair,a.label) if path.suffix in ('.sqlite','.db') else read_pytorch(path,a.label,a.start_ns,a.end_ns)
    data.update(id='imported',cohort=None,benchmark=None);write_data(data,a.output);print(f"Saved {len(data['events']):,} kernel launches to {a.output}")

if __name__=='__main__':main()
