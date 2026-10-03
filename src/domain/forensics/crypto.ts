import{canonicalize,type HashFn}from"./integrity";
function hex(bytes:ArrayBuffer):string{return[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("");}
export const sha256WebCrypto:HashFn=async(canonical:string)=>{
 if(!globalThis.crypto?.subtle)throw new Error("sha256WebCrypto: Web Crypto unavailable");
 return hex(await globalThis.crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical)));
};
export async function merkleRoot(leaves:readonly string[],hash:HashFn):Promise<string>{
 if(leaves.length===0)return hash(canonicalize({kind:"empty-merkle"}));
 let level=[...leaves];
 while(level.length>1){const next:string[]=[];for(let i=0;i<level.length;i+=2){const left=level[i],right=level[i+1]??left;next.push(await hash(canonicalize({left,right})));}level=next;}
 return level[0];
}
export type ProvenanceRoots={chunkRoots:readonly string[];sessionRoot:string;revisionRoot:string;projectRoot:string};
export async function buildProvenanceRoots(input:{eventHashes:readonly string[];chunkSize:number;sessionId:string;revision:number;documentHash:string;projectId:string;previousProjectRoot?:string},hash:HashFn):Promise<ProvenanceRoots>{
 if(!Number.isSafeInteger(input.chunkSize)||input.chunkSize<1)throw new Error("buildProvenanceRoots: invalid chunkSize");
 const chunks:string[]=[];for(let i=0;i<input.eventHashes.length;i+=input.chunkSize)chunks.push(await merkleRoot(input.eventHashes.slice(i,i+input.chunkSize),hash));
 const sessionRoot=await hash(canonicalize({sessionId:input.sessionId,chunks}));
 const revisionRoot=await hash(canonicalize({revision:input.revision,documentHash:input.documentHash,sessionRoot}));
 const projectRoot=await hash(canonicalize({projectId:input.projectId,previousProjectRoot:input.previousProjectRoot??null,revisionRoot}));
 return{chunkRoots:chunks,sessionRoot,revisionRoot,projectRoot};
}
