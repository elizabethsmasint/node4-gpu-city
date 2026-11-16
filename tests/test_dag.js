import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {prepare} from '../core.js';
import {dependencyDag,collapseDag,layoutDag,repeatedPattern} from '../dag.js';
let checks=0;function check(value,label){if(!value)throw Error(label);checks++;}
const [,raw]=Gio.File.new_for_path(GLib.get_current_dir()+'/data/original.json').load_contents(null),data=prepare(JSON.parse(new TextDecoder().decode(raw))),dag=dependencyDag(data),view=collapseDag(dag),layout=layoutDag(view);
check(dag.nodes.size===118539,'Every launch and memory activity remains in DAG');
check(dag.edges.length===dag.execution.nodes.filter(n=>n.ordered).length,'Original edges use only established stream order');
check([...dag.nodes.values()].every(n=>n.out.length<=1&&n.in.length<=1),'Original has no invented branches or merges');
check(view.nodes.reduce((n,v)=>n+v.members.length,0)===dag.nodes.size,'Collapsing preserves all source nodes exactly once');
check(view.nodes.length<5000,'Large capture collapses to a bounded graph');
check(view.nodes.some(n=>n.pattern),'Real repeated signature sequences can collapse independently of page boundaries');
check(layout.positions.size===view.nodes.length,'Every collapsed graph node is laid out');
const visible=view.nodes.find(n=>n.members.length>1),expanded=collapseDag(dag,new Set([visible.id]));
check(visible.members.every(n=>expanded.bySource.get(n.id).members.length===1),'Expanding a sequence reveals every individual activity');
for(const e of view.edges){const a=layout.positions.get(e.from),b=layout.positions.get(e.to);if(a.component!==b.component||a.rank>=b.rank)throw Error('Invalid layered direction');}checks++;
function fixture(withCross){return prepare({schema_version:1,duration_ns:100,groups:[{id:0,name:'a',label:'A',category:'add',count:4}],events:[[0,10,0,1,10,0,1,null,0,1,123],[2,2,0,2,11,0,1,null,0,1,123],[14,2,0,1,12,0,1,null,0,1,123],[22,3,0,2,13,0,1,null,0,1,123]],memory:[],stats:{kernel_count:4,kernel_sum_ns:17},execution_evidence:{cross_dependencies:withCross?[{from_stream:1,to_stream:2,device:0,context:1,process:123,from_ns:12,to_ns:20,event_id:5,event_sync_id:3,evidence:'Explicit fixture event completion / wait join'}]:[]}});}
const branched=dependencyDag(fixture(true));
check(branched.nodes.get('event0').out.length===2,'Explicit event anchor produces a real dependency fork');
check(branched.nodes.get('wait0').in.length===2,'Recorded stream wait merges its stream and event constraints');
check(branched.edges.some(e=>e.kind==='event'&&e.from==='event0'&&e.to==='wait0'),'Resolved cross-stream event arrow preserved');
const bv=collapseDag(branched),bl=layoutDag(bv);
check(bv.bySource.get('event0').members.length===1&&bv.bySource.get('wait0').members.length===1,'Branch and merge anchors cannot collapse away');
const placement=JSON.stringify([...bl.positions]);for(const n of branched.nodes.values()){n.start*=1000;n.end*=1000;}
check(placement===JSON.stringify([...layoutDag(bv).positions]),'Time does not change graph positions or node dimensions');
const noCross=dependencyDag(fixture(false));check(noCross.edges.every(e=>noCross.nodes.get(e.from).stream===noCross.nodes.get(e.to).stream),'Nearby events never invent cross-stream arrows');
check(repeatedPattern([{kind:'kernel',group:1,label:'A'},{kind:'kernel',group:2,label:'B'},{kind:'kernel',group:1,label:'A'},{kind:'kernel',group:2,label:'B'}]).width===2,'Repeated sequences identify the actual signature pattern');
check(repeatedPattern([{kind:'kernel',group:1},{kind:'kernel',group:2},{kind:'kernel',group:3}])===null,'Generic serial sequence is not labeled repeated');
print(`PASS: ${checks} directed dependency topology, branching, collapse and time-independent layout checks`);
