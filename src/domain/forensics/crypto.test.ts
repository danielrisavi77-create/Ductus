import{existsSync,readdirSync,readFileSync}from"node:fs";import{join}from"node:path";import{describe,expect,it}from"vitest";import{buildProvenanceRoots,merkleRoot}from"./crypto";
const h=async(s:string)=>"H("+s+")";
describe("hierarchical provenance roots",()=>{
 it("duplicates the odd Merkle leaf deterministically",async()=>{const a=await merkleRoot(["a","b","c"],h);const b=await merkleRoot(["a","b","c"],h);expect(a).toBe(b);});
 it("changes project root when any event hash changes",async()=>{const base={eventHashes:["e1","e2","e3"],chunkSize:2,sessionId:"s1",revision:4,documentHash:"doc",projectId:"p"};const a=await buildProvenanceRoots(base,h);const b=await buildProvenanceRoots({...base,eventHashes:["e1","CHANGED","e3"]},h);expect(a.projectRoot).not.toBe(b.projectRoot);});
 it("binds the revision root to the canonical document hash",async()=>{const base={eventHashes:["e1"],chunkSize:100,sessionId:"s1",revision:4,documentHash:"doc-a",projectId:"p"};const a=await buildProvenanceRoots(base,h);const b=await buildProvenanceRoots({...base,documentHash:"doc-b"},h);expect(a.revisionRoot).not.toBe(b.revisionRoot);});
 it("chains project roots across revisions",async()=>{const a=await buildProvenanceRoots({eventHashes:["e1"],chunkSize:100,sessionId:"s1",revision:1,documentHash:"d1",projectId:"p"},h);const b=await buildProvenanceRoots({eventHashes:["e2"],chunkSize:100,sessionId:"s2",revision:2,documentHash:"d2",projectId:"p",previousProjectRoot:a.projectRoot},h);expect(b.projectRoot).not.toBe(a.projectRoot);});
});

describe("the deprecated legacy Merkle tree (DAN-302)",()=>{
 it("is weak: an odd level duplicates its last leaf, so [a,b,c] and [a,b,c,c] share a root",async()=>{
  expect(await merkleRoot(["a","b","c"],h)).toBe(await merkleRoot(["a","b","c","c"],h));
 });
 it("has no caller outside src/domain/forensics/crypto*",()=>{
  const root=process.cwd();const users:string[]=[];
  const walk=(dir:string):void=>{for(const entry of readdirSync(join(root,dir),{withFileTypes:true})){
   const path=`${dir}/${entry.name}`;
   if(entry.isDirectory()){if(entry.name!=="node_modules"&&!entry.name.startsWith("."))walk(path);continue;}
   if(!/\.(ts|tsx|mts|js|mjs)$/.test(entry.name)||path.startsWith("src/domain/forensics/crypto"))continue;
   if(/\b(merkleRoot|buildProvenanceRoots)\b/.test(readFileSync(join(root,path),"utf8")))users.push(path);
  }};
  for(const dir of["src","app","scripts","e2e"])if(existsSync(join(root,dir)))walk(dir);
  expect(users).toEqual([]);
 });
});
