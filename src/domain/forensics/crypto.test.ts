import{describe,expect,it}from"vitest";import{buildProvenanceRoots,merkleRoot}from"./crypto";
const h=async(s:string)=>"H("+s+")";
describe("hierarchical provenance roots",()=>{
 it("duplicates the odd Merkle leaf deterministically",async()=>{const a=await merkleRoot(["a","b","c"],h);const b=await merkleRoot(["a","b","c"],h);expect(a).toBe(b);});
 it("changes project root when any event hash changes",async()=>{const base={eventHashes:["e1","e2","e3"],chunkSize:2,sessionId:"s1",revision:4,documentHash:"doc",projectId:"p"};const a=await buildProvenanceRoots(base,h);const b=await buildProvenanceRoots({...base,eventHashes:["e1","CHANGED","e3"]},h);expect(a.projectRoot).not.toBe(b.projectRoot);});
 it("binds the revision root to the canonical document hash",async()=>{const base={eventHashes:["e1"],chunkSize:100,sessionId:"s1",revision:4,documentHash:"doc-a",projectId:"p"};const a=await buildProvenanceRoots(base,h);const b=await buildProvenanceRoots({...base,documentHash:"doc-b"},h);expect(a.revisionRoot).not.toBe(b.revisionRoot);});
 it("chains project roots across revisions",async()=>{const a=await buildProvenanceRoots({eventHashes:["e1"],chunkSize:100,sessionId:"s1",revision:1,documentHash:"d1",projectId:"p"},h);const b=await buildProvenanceRoots({eventHashes:["e2"],chunkSize:100,sessionId:"s2",revision:2,documentHash:"d2",projectId:"p",previousProjectRoot:a.projectRoot},h);expect(b.projectRoot).not.toBe(a.projectRoot);});
});
