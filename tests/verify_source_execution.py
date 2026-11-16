#!/usr/bin/env python3
"""Compare every graph record and all activity gaps to the read-only SQLite source."""
import argparse,json,sqlite3,hashlib
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--source-root',type=Path,required=True);p.add_argument('--output',type=Path);a=p.parse_args()
web=Path(__file__).resolve().parents[1]
if (web/'web').is_dir():web=web/'web'
reports=[]
def merge(intervals):
 out=[]
 for x,y in sorted(intervals,key=lambda t:t[0]):
  if out and x<=out[-1][1]:out[-1][1]=max(out[-1][1],y)
  else:out.append([x,y])
 return out
for name in ['original','optimized','fused','historical']:
 d=json.loads((web/'data'/f'{name}.json').read_text());source=a.source_root/d['source'];c=sqlite3.connect(source.resolve().as_uri()+'?mode=ro',uri=True);c.row_factory=sqlite3.Row;origin=int(d['origin_ns']);end=origin+d['duration_ns'];strings=dict(c.execute('select id,value from StringIds'));intervals=[]
 assert hashlib.sha256(source.read_bytes()).hexdigest()==d['source_sha256']
 kernels=list(c.execute('select * from CUPTI_ACTIVITY_KIND_KERNEL where start>=? and end<=? order by start',(origin,end)))
 assert len(kernels)==len(d['events'])
 for r,e in zip(kernels,d['events']):
  assert e[0]==r['start']-origin and e[1]==r['end']-r['start'] and e[3]==r['streamId'] and e[4]==r['correlationId'] and e[8]==r['deviceId'] and e[9:12]==[r['contextId'],r['globalPid'],r['gridId']]
  assert d['groups'][e[2]]['name']==strings[r['demangledName']]
  intervals.append([e[0],e[0]+e[1]])
 memory=[]
 for table,kind in [('CUPTI_ACTIVITY_KIND_MEMCPY','memcpy'),('CUPTI_ACTIVITY_KIND_MEMSET','memset')]:
  for r in c.execute('select * from '+table+' where start>=? and end<=? order by start',(origin,end)):
   memory.append((kind,r['start']-origin,r['end']-r['start'],r['bytes'],r['deviceId'],r['streamId'],r['contextId'],r['globalPid'],r['correlationId']))
 assert memory==[(m['kind'],m['start_ns'],m['duration_ns'],m['bytes'],m['device'],m['stream'],m['context'],m['process'],m['correlation']) for m in d['memory']]
 intervals.extend((m[1],m[1]+m[2]) for m in memory)
 u=merge(intervals);gaps=[];cursor=0
 for x,y in u:
  if x>cursor:gaps.append([cursor,x])
  cursor=max(cursor,y)
 if cursor<d['duration_ns']:gaps.append([cursor,d['duration_ns']])
 total=sum(y-x for x,y in gaps);largest=max(y-x for x,y in gaps)
 assert total==d['stats']['no_activity_ns'] and largest==d['stats']['max_gap_ns']
 if name=='original':assert (total,largest)==(344803921,91923200)
 evidence=d['execution_evidence'];hosts=[]
 import re
 for table in ['CUPTI_ACTIVITY_KIND_RUNTIME','CUPTI_ACTIVITY_KIND_DRIVER']:
  if not c.execute('select 1 from sqlite_master where name=?',(table,)).fetchone():continue
  for r in c.execute('select * from '+table+' where start<=? and end>=?',(end,origin)):
   label=strings[r['nameId']]
   if re.search(r'Launch|Memcpy|Memset|Synchronize|WaitEvent|EventRecord',label):hosts.append([r['start']-origin,r['end']-r['start'],label,r['correlationId'],r['globalTid'],r['returnValue']])
 hosts.sort(key=lambda h:h[0]);assert hosts==[[h[0],h[1],evidence['host_names'][h[2]],*h[3:]] for h in evidence['host_events']]
 expected_sync=[]
 for r in c.execute('select * from CUPTI_ACTIVITY_KIND_SYNCHRONIZATION'):
  r=dict(r)
  if r['end']<origin or r['start']>end:continue
  r['start_ns']=r.pop('start')-origin;r['duration_ns']=r.pop('end')-origin-r['start_ns'];expected_sync.append(r)
 assert expected_sync==evidence['synchronization']
 assert evidence['cuda_events']==[dict(r) if not r['timestamp'] else dict(dict(r),timestamp_ns=r['timestamp']-origin) for r in c.execute('select * from CUPTI_ACTIVITY_KIND_CUDA_EVENT')]
 # This cohort has invalid sentinel wait identities and no device event timestamps.
 assert not evidence['cross_dependencies']
 lanes={}
 for r in kernels:lanes.setdefault((r['deviceId'],r['streamId'],r['contextId'],r['globalPid']),[]).append((r['start'],r['end']))
 overlaps=sum(sum(a[1]>b[0] for a,b in zip(ns,ns[1:])) for ns in lanes.values())
 reports.append(dict(dataset=name,kernels=len(kernels),memory=len(memory),host_calls=len(hosts),synchronization=len(expected_sync),kernel_lanes=len(lanes),adjacent_kernel_overlaps=overlaps,all_gap_count=len(gaps),no_activity_ns=total,max_gap_ns=largest,elapsed_ns=d['duration_ns'],kernel_sum_ns=sum(e[1] for e in d['events']),kernel_union_ns=sum(y-x for x,y in merge([(e[0],e[0]+e[1]) for e in d['events']])),source_sha256=d['source_sha256']))
 c.close()
result={'verified':'Every kernel identity/duration/stream, every memory record, relevant host API, synchronization record, CUDA event record, source hash and full activity-union gap totals','captures':reports}
print(json.dumps(result,indent=2))
if a.output:a.output.write_text(json.dumps(result,indent=2)+'\n')
