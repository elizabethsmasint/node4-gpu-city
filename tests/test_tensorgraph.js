import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {tensorModel,tensorReachable,tensorCandidates} from '../tensorgraph.js';
const [,raw]=Gio.File.new_for_path(GLib.get_current_dir()+'/data/tensor-dependencies.json').load_contents(null),bundle=JSON.parse(new TextDecoder().decode(raw));let checks=0;function check(v,label){if(!v)throw Error(label);checks++;}
for(const graph of bundle.graphs){const model=tensorModel(graph);check(model.nodes.size===graph.nodes.length,'Every tensor graph node is retained');check(model.positions.size===model.nodes.size,'All source and compiler nodes have positions');check(graph.nodes.every(n=>n.duration_ns===null),'No invented source/compiled duration');}
const graph=bundle.graphs.find(g=>g.kind==='compiler'&&g.nodes.filter(n=>n.kind==='compiled_kernel').length===3),m=tensorModel(graph),kernels=graph.nodes.filter(n=>n.kind==='compiled_kernel');
check(tensorReachable(m,kernels[1].id,'in').has(kernels[0].id),'Reduction result is a real prerequisite');
check(!tensorReachable(m,kernels[2].id,'in').has(kernels[0].id),'Wrapper order does not create a tensor edge to the independent branch');
check(tensorCandidates(m,kernels[0].id).some(n=>n.id===kernels[2].id),'Independent input-gradient branch is inspectable as an overlap candidate');
const before=JSON.stringify([...m.positions]);for(const n of graph.nodes)n.duration_ns=9999999;check(before===JSON.stringify([...tensorModel(graph).positions]),'Durations do not determine tensor graph geometry');
let rejected=false;try{tensorModel({nodes:[{id:'a'},{id:'b'}],edges:[{from_id:'a',to_id:'b'},{from_id:'b',to_id:'a'}]});}catch{rejected=true;}check(rejected,'Versioned dependency cycles are rejected');
print(`PASS: ${checks} tensor producer/consumer, candidate independence and source evidence checks`);
