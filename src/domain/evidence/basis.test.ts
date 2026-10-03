import { describe,expect,it } from "vitest";
import { newNodeId } from "../document";
import { createTextAnchor } from "../collaboration";
import { createClaimRevision,createEvidenceBasis,evaluateEvidenceBasis,type ClaimId,type SourceId,type EvidenceBasisId } from "./basis";
const N=newNodeId(()=>"11111111-1111-4111-8111-111111111111");
const claimText="Rezultati pokazuju povezanost.";
const anchor=createTextAnchor({nodeId:N,nodeText:claimText,start:0,end:claimText.length,contextLength:0});
const basis=()=>createEvidenceBasis({
 id:"eb1" as EvidenceBasisId,
 claim:createClaimRevision({claimId:"c1" as ClaimId,documentRevision:3,target:anchor,text:claimText}),
 source:{sourceId:"s1" as SourceId,version:"v1",title:"Izvor",locatorLabel:"str. 42"},
 excerpt:{sourceId:"s1" as SourceId,sourceVersion:"v1",locator:"42",text:"Sažeti relevantni izvadak.",kind:"summary"},
 reviewedAt:"2026-09-28T12:00:00Z"
});
describe("EvidenceBasis",()=>{
 it("is valid for the reviewed formulation and source version",()=>expect(evaluateEvidenceBasis(basis(),N,claimText,"v1")).toEqual({status:"VALID",resolution:"exact"}));
 it("stays valid if the same claim merely moves",()=>expect(evaluateEvidenceBasis(basis(),N,"Uvod. "+claimText,"v1")).toEqual({status:"VALID",resolution:"moved"}));
 it("requires recheck when the claim is no longer resolvable",()=>expect(evaluateEvidenceBasis(basis(),N,"Rezultati dokazuju uzročnost.","v1")).toEqual({status:"RECHECK_REQUIRED",reason:"claim-missing"}));
 it("requires recheck when the source version changes",()=>expect(evaluateEvidenceBasis(basis(),N,claimText,"v2")).toEqual({status:"RECHECK_REQUIRED",reason:"source-version-changed"}));
 it("refuses an excerpt from another source version",()=>expect(()=>createEvidenceBasis({...basis(),excerpt:{...basis().excerpt,sourceVersion:"v2"}})).toThrow("source version"));
 it("refuses a claim whose text differs from its anchor",()=>expect(()=>createClaimRevision({claimId:"c1" as ClaimId,documentRevision:3,target:anchor,text:"drugo"})).toThrow("anchor quote"));
});
