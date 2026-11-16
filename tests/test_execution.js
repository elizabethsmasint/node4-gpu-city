import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {prepare} from '../core.js';
import {executionModel,complement,visibleNodes,classifyTime,displayGroups,gapEvidence} from '../execution.js';
let checks=0;function check(v,label){if(!v)throw Error(label);checks++;}
const [,raw]=Gio.File.new_for_path(GLib.get_current_dir()+'/data/original.json').load_contents(null),data=prepare(JSON.parse(new TextDecoder().decode(raw))),m=executionModel(data);
check(m.totalGap===344803921,'Original complete gap total matches source');check(Math.max(...m.gaps.map(g=>g[1]-g[0]))===91923200,'Original largest gap');
check(m.nodes.length===118539,'All kernels and memory activities retained');check(m.lanes.length===1,'Original is one observed lane including memory');check(m.hosts.length>118000,'Host calls recovered');check(m.cross.length===0,'Invalid wait identities are not converted to cross-stream edges');
for(const l of m.lanes)for(const n of l.nodes){if(n.ordered){const p=m.byId.get(n.previous);if(p.end>n.start||p.lane!==n.lane)throw Error('Invalid stream-order edge');}}
checks++;
const g=m.gaps.reduce((a,b)=>a[1]-a[0]>b[1]-b[0]?a:b),e=gapEvidence(m,g);check(e.before===null&&e.after!=null||e.before!=null,'Gap neighbors recovered');check(classifyTime(m,(g[0]+g[1])/2).includes('cause unknown'),'Gaps remain unexplained');
check(JSON.stringify(complement([[10,30],[20,40],[45,50]],60))===JSON.stringify([[0,10],[40,45],[50,60]]),'Overlap union counts time once with boundaries');
const fixture=prepare({schema_version:1,duration_ns:100,groups:[{id:0,name:'a',label:'a',category:'add',count:2}],events:[[10,20,0,1,1,0,2,null,0],[20,20,0,2,2,0,2,null,0]],memory:[{start_ns:45,duration_ns:10,kind:'memcpy',device:0,stream:3}],stats:{kernel_count:2,kernel_sum_ns:40}}),f=executionModel(fixture);
check(f.lanes.length===3,'Separate device/stream lanes include memory-only streams');check(f.totalGap===60,'Concurrent kernels counted once in activity union');check(classifyTime(f,50).startsWith('No kernel activity, but recorded memory'),'Memory-only time classification');check(classifyTime(f,15,'fill').startsWith('No activity in this operation category'),'Empty category is not inactivity');check(classifyTime(f,80).includes('cause unknown'),'Missing captured activity classification');check(visibleNodes(f.lanes[0],30,40).length===0,'Half open interval end');
const all=m.lanes[0].nodes,groups=displayGroups(all,0,data.duration_ns,800);check(groups.length<1000&&groups.reduce((n,g)=>n+g.nodes.length,0)===all.length,'Coarse graph bounds rendering and retains all exact nodes');
print(`PASS: ${checks} execution graph, evidence scope and gap checks`);
