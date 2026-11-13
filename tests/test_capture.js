import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {prepare,upperBound} from '../core.js';
import {dataFlowModel,sequenceSize} from '../dataflow.js';
import {captureRows} from '../capture.js';
let passed=0;
const check=(v,label)=>{if(!v)throw Error(label);passed++;};
const root=Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_path();
const [,raw]=Gio.File.new_for_path(root+'/data/original.json').load_contents(null);
const data=prepare(JSON.parse(new TextDecoder().decode(raw)));
const rows=captureRows(data),indices=rows.flatMap(r=>r.indices);
check(indices.length===116186&&new Set(indices).size===116186,'Every recorded launch appears exactly once across overview rows');
check(rows.length===10,'All ten operation types are visible together');
for(const time of [0,data.duration_ns/2,data.duration_ns]){
 const done=rows.reduce((n,r)=>n+upperBound(r.ends,time),0);
 check(done===data.events.filter(e=>e[0]+e[1]<=time).length,'Completion counts match actual event ends');
}
const chosen=data.groups.find(g=>g.category==='add').first_event,e=data.events[chosen];
for(const time of [e[0]+e[1],e[0]+e[1]+1,data.duration_ns]){
 const n=dataFlowModel(data,chosen,time).nodes.find(n=>n.event===chosen);
 check(n.status==='done'&&n.transfer.gpu===1&&n.transfer.dram===1,'Completed input and output persist at later times');
}
const model=dataFlowModel(data,chosen,e[0]);
check(model.nodes.length===sequenceSize,'Expanded sequence contains eighteen individual launches');
check(model.nodes.every(n=>n.start>=e[0]?n.transfer.dram==null||n.transfer.dram===0:true),'Upcoming kernels have no completed output');
const last=dataFlowModel(data,data.events.length-1,data.duration_ns);
check(last.nextPage==null&&last.next==null&&last.nodes.at(-1).event===data.events.length-1,'Final partial page ends at the actual capture boundary');
check(dataFlowModel(data,0,0).previousPage==null,'No page before the first launch');

const groups=[{id:0,name:'add',category:'add',count:4},{id:1,name:'opaque',category:'other',count:1}];
// Stream 1 has an overlapping pair. Stream 2 is concurrent with stream 1.
const events=[[0,10,0,1,null,-2,1,null,0],[2,5,0,2,null,0,1,null,0],[5,10,0,1,null,0,1,null,0],[15,5,0,1,null,0,1,null,0],[20,2,1,null,null,null,null,null,null]];
const synthetic=prepare({schema_version:1,duration_ns:30,events,groups,stats:{kernel_count:5,kernel_sum_ns:32}});
const sr=captureRows(synthetic);
check(sr.length===3&&sr.flatMap(r=>r.indices).length===5,'Multiple streams and unknown identities remain represented');
const overlap=dataFlowModel(synthetic,2,6);
check(!overlap.edges.some(e=>e.to===2),'Overlapping same-stream kernels do not invent a prerequisite');
check(overlap.nodes.filter(n=>n.status==='running').length===2,'Overlapping kernels can run together');
check(overlap.nodes.find(n=>n.event===3).status==='waiting','Submitted successor waits for the actual previous kernel');
check(overlap.edges.find(e=>e.to===3).from===2,'Prerequisite never crosses into another stream');
check(dataFlowModel(synthetic,4,30).edges.length===0,'Unknown stream identity never invents dependencies');
check(dataFlowModel(synthetic,4,30).nodes[0].transfer.dram===null,'Unknown transfer remains unknown after completion');
check(captureRows(prepare({schema_version:1,duration_ns:1,events:[],groups:[],stats:{kernel_count:0,kernel_sum_ns:0}})).length===0,'Empty captures are supported');
print(`PASS: ${passed} whole-capture, persistence, and multi-stream checks`);
