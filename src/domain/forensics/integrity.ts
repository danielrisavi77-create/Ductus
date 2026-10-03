import type{ForensicEvent}from"./ledger";
export type CanonicalEventEnvelope={event:ForensicEvent;previousHash:string;eventHash:string};
export type HashFn=(canonical:string)=>Promise<string>;

export function canonicalize(value:unknown):string{
 if(value===undefined||typeof value==="function"||typeof value==="symbol"||typeof value==="bigint")throw new Error("canonicalize: unsupported value");
 if(typeof value==="number"&&!Number.isFinite(value))throw new Error("canonicalize: non-finite number");
 if(value===null||typeof value!=="object")return JSON.stringify(value);
 if(Array.isArray(value))return"["+value.map(canonicalize).join(",")+"]";
 const proto=Object.getPrototypeOf(value);if(proto!==Object.prototype&&proto!==null)throw new Error("canonicalize: non-plain object");
 const obj=value as Record<string,unknown>;return"{"+Object.keys(obj).sort().map(k=>JSON.stringify(k)+":"+canonicalize(obj[k])).join(",")+"}";
}
export async function appendToHashChain(event:ForensicEvent,previousHash:string,hash:HashFn):Promise<CanonicalEventEnvelope>{
 if(!previousHash)throw new Error("appendToHashChain: previous hash required");
 const eventHash=await hash(canonicalize({previousHash,event}));
 return{event:structuredClone(event),previousHash,eventHash};
}
export async function verifyHashChain(chain:readonly CanonicalEventEnvelope[],genesisHash:string,hash:HashFn):Promise<{valid:true}|{valid:false;sequence:number}>{
 let previous=genesisHash,expectedSequence=1,documentId:string|null=null;
 for(const item of chain){
  const e=item.event;
  if(e.sequence!==expectedSequence)return{valid:false,sequence:e.sequence};
  if(documentId===null)documentId=e.documentId;else if(e.documentId!==documentId)return{valid:false,sequence:e.sequence};
  if(item.previousHash!==previous)return{valid:false,sequence:e.sequence};
  const expected=await hash(canonicalize({previousHash:previous,event:e}));if(expected!==item.eventHash)return{valid:false,sequence:e.sequence};
  previous=item.eventHash;expectedSequence++;
 }
 return{valid:true};
}
