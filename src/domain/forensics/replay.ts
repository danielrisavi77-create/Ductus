import type{ForensicEvent}from"./ledger";
export type ReplayNode={id:string;text:string};export type ReplayDocument={nodes:readonly ReplayNode[]};
function update(nodes:readonly ReplayNode[],id:string,fn:(text:string)=>string):ReplayNode[]{let found=false;const out=nodes.map(n=>{if(n.id!==id)return n;found=true;return{...n,text:fn(n.text)}});if(!found)throw new Error(`replay: missing node ${id}`);return out;}
function point(text:string,offset:number){if(!Number.isSafeInteger(offset)||offset<0||offset>text.length)throw new Error("replay: invalid offset");}
function range(text:string,start:number,end:number){if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>text.length)throw new Error("replay: invalid range");}
export function applyForensicEvent(doc:ReplayDocument,event:ForensicEvent):ReplayDocument{
 const p=event.payload;
 if(p.kind==="insert-text"||p.kind==="paste"){return{nodes:update(doc.nodes,p.nodeId,t=>{point(t,p.offset);return t.slice(0,p.offset)+p.text+t.slice(p.offset)})};}
 if(p.kind==="delete"||p.kind==="cut"){return{nodes:update(doc.nodes,p.nodeId,t=>{range(t,p.start,p.end);return t.slice(0,p.start)+t.slice(p.end)})};}
 if(p.kind==="replace"){return{nodes:update(doc.nodes,p.nodeId,t=>{range(t,p.start,p.end);return t.slice(0,p.start)+p.insertedText+t.slice(p.end)})};}
 if(p.kind==="paragraph-break"){return{nodes:update(doc.nodes,p.nodeId,t=>{point(t,p.offset);return t.slice(0,p.offset)+"\n"+t.slice(p.offset)})};}
 if(p.kind==="ai-accept")throw new Error("replay: ai-accept requires a resolved target transaction");
 return{nodes:doc.nodes.map(n=>({...n}))};
}
export function replayUntil(initial:ReplayDocument,events:readonly ForensicEvent[],sequence:number):ReplayDocument{
 if(!Number.isSafeInteger(sequence)||sequence<0)throw new Error("replayUntil: invalid sequence");
 const selected=events.filter(e=>e.sequence<=sequence).sort((a,b)=>a.sequence-b.sequence);
 for(let i=0;i<selected.length;i++)if(selected[i].sequence!==i+1)throw new Error("replayUntil: non-contiguous sequence");
 return selected.reduce(applyForensicEvent,initial);
}
