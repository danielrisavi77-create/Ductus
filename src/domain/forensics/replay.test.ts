import{describe,expect,it}from"vitest";
import{createForensicEvent,type ForensicEvent}from"./ledger";
import{replayUntil}from"./replay";
const e=(sequence:number,ms:number,payload:ForensicEvent["payload"]):ForensicEvent=>createForensicEvent({schemaVersion:1,id:"e"+sequence,documentId:"d",sequence,revision:0,occurredAt:new Date(Date.UTC(2026,8,29,9,0,0,ms)).toISOString(),actorId:"student",actorRole:"student",payload});
describe("Replay",()=>{
 it("reconstructs exact text from insert/delete/paste operations",()=>{const events=[e(1,0,{kind:"insert-text",nodeId:"n",offset:0,text:"A"}),e(2,100,{kind:"insert-text",nodeId:"n",offset:1,text:"B"}),e(3,200,{kind:"paste",nodeId:"n",offset:2,text:" XYZ"}),e(4,300,{kind:"delete",nodeId:"n",start:1,end:2,deletedTextHash:"h"})];expect(replayUntil({nodes:[{id:"n",text:""}]},events,4).nodes[0].text).toBe("A XYZ");});
 it("rejects out-of-bounds replay offsets",()=>expect(()=>replayUntil({nodes:[{id:"n",text:"a"}]},[e(1,0,{kind:"insert-text",nodeId:"n",offset:9,text:"x"})],1)).toThrow("invalid offset"));
 it("refuses undo and redo it cannot resolve instead of keeping undone text",()=>{const events=[e(1,0,{kind:"insert-text",nodeId:"n",offset:0,text:"A"}),e(2,100,{kind:"undo",transactionId:"t1"})];expect(()=>replayUntil({nodes:[{id:"n",text:""}]},events,2)).toThrow("undo requires");});
 it("refuses to replay to a sequence whose trailing events are missing",()=>expect(()=>replayUntil({nodes:[{id:"n",text:""}]},[e(1,0,{kind:"insert-text",nodeId:"n",offset:0,text:"A"})],2)).toThrow("missing events"));
});
