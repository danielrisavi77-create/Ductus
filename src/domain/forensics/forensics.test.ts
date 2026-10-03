import{describe,expect,it}from"vitest";
import{createForensicEvent,type ForensicEvent}from"./ledger";
import{appendToHashChain,canonicalize,verifyHashChain}from"./integrity";
const fakeHash=async(s:string)=>"h:"+s;
const ev=(sequence:number,text:string):ForensicEvent=>createForensicEvent({schemaVersion:1,id:"e"+sequence,documentId:"doc",sequence,revision:0,occurredAt:`2026-09-29T09:00:0${Math.min(sequence,9)}Z`,actorId:"student",actorRole:"student",payload:{kind:"insert-text",nodeId:"n1",offset:sequence-1,text}});
describe("Forensic Writing Ledger",()=>{
 it("preserves exact inserted text and sequence",()=>expect(ev(1,"č")).toMatchObject({sequence:1,payload:{kind:"insert-text",text:"č"}}));
 it("canonicalization is stable across object key order",()=>expect(canonicalize({b:2,a:1})).toBe(canonicalize({a:1,b:2})));
 it("builds and verifies an append-only hash chain",async()=>{const a=await appendToHashChain(ev(1,"a"),"GENESIS",fakeHash);const b=await appendToHashChain(ev(2,"b"),a.eventHash,fakeHash);expect(await verifyHashChain([a,b],"GENESIS",fakeHash)).toEqual({valid:true});});
 it("detects tampering with an earlier event",async()=>{const a=await appendToHashChain(ev(1,"a"),"GENESIS",fakeHash);const b=await appendToHashChain(ev(2,"b"),a.eventHash,fakeHash);const tampered={...a,event:{...a.event,payload:{kind:"insert-text" as const,nodeId:"n1",offset:0,text:"X"}}};expect(await verifyHashChain([tampered,b],"GENESIS",fakeHash)).toEqual({valid:false,sequence:1});});
 it("rejects authoring mutations attributed to mentor",()=>expect(()=>createForensicEvent({...ev(1,"a"),actorRole:"mentor"})).toThrow("student actor"));
 it("rejects sequence gaps even when hashes otherwise chain",async()=>{const a=await appendToHashChain(ev(1,"a"),"GENESIS",fakeHash);const three={...ev(2,"b"),sequence:3,id:"e3"};const b=await appendToHashChain(three,a.eventHash,fakeHash);expect(await verifyHashChain([a,b],"GENESIS",fakeHash)).toEqual({valid:false,sequence:3});});
 it("canonicalizer rejects undefined instead of hashing an ambiguous representation",()=>expect(()=>canonicalize({a:undefined})).toThrow("unsupported"));
});
