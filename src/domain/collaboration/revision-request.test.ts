import { describe, expect, it } from "vitest";
import { createTextAnchor } from "./anchor";
import { acceptForRevision, createRevisionRequest, markRereviewRequired, requestClarification, shareResponseForReview, submitStudentResponse, type RevisionRequestState } from "./revision-request";
import { newNodeId } from "../document";
const nodeId=newNodeId(()=>"11111111-1111-4111-8111-111111111111");
const quote="važna tvrdnja";
const target=createTextAnchor({nodeId,nodeText:quote,start:0,end:quote.length});
const initial=():RevisionRequestState=>({request:createRevisionRequest({id:"r1",documentId:"d1",createdBy:"mentor",requestedRevision:2,target,instruction:"Preciziraj tvrdnju."}),response:null});
const response={requestId:"r1",authorId:"student",responseRevision:3,explanation:"Dodao sam izvor i ublažio tvrdnju."};

describe("RevisionRequest workflow",()=>{
 it("follows the happy path without skipping states",()=>{
  const a=submitStudentResponse(initial(),response); expect(a.ok).toBe(true); if(!a.ok)return;
  const b=shareResponseForReview(a.value); expect(b.ok).toBe(true); if(!b.ok)return;
  const c=acceptForRevision(b.value); expect(c.ok).toBe(true); if(!c.ok)return;
  expect(c.value.request.status).toBe("ACCEPTED_FOR_REVISION");
  const d=markRereviewRequired(c.value); expect(d.ok).toBe(true); if(d.ok)expect(d.value.request.status).toBe("REREVIEW_REQUIRED");
 });
 it("cannot accept an unshared response",()=>{const a=submitStudentResponse(initial(),response);if(!a.ok)return;expect(acceptForRevision(a.value)).toEqual({ok:false,reason:"wrong-state"});});
 it("cannot share before a student response",()=>{expect(shareResponseForReview(initial())).toEqual({ok:false,reason:"wrong-state"});});
 it("rejects an empty explanation",()=>{expect(submitStudentResponse(initial(),{...response,explanation:"   "})).toEqual({ok:false,reason:"empty-explanation"});});
 it("rejects a response revision older than the request basis",()=>{expect(submitStudentResponse(initial(),{...response,responseRevision:1})).toEqual({ok:false,reason:"invalid-revision"});});
 it("supports clarification and a new student response",()=>{
  const a=submitStudentResponse(initial(),response);if(!a.ok)return;const b=shareResponseForReview(a.value);if(!b.ok)return;
  const c=requestClarification(b.value);expect(c.ok).toBe(true);if(!c.ok)return;
  const d=submitStudentResponse(c.value,{...response,responseRevision:4,explanation:"Dodatno sam obrazložio."});
  expect(d.ok).toBe(true);if(d.ok)expect(d.value.request.status).toBe("STUDENT_RESPONDED");
 });
 it("cannot mark rereview before an accepted review",()=>{expect(markRereviewRequired(initial())).toEqual({ok:false,reason:"wrong-state"});});
});
