export const FORENSIC_EVENT_KINDS=[
 "insert-text","delete","replace","paste","cut","format","undo","redo",
 "paragraph-break","structure-change","citation-insert","source-attach",
 "ai-request","ai-response","ai-accept","ai-reject","checkpoint"
] as const;
export type ForensicEventKind=(typeof FORENSIC_EVENT_KINDS)[number];

export type ForensicPayload=
 | {kind:"insert-text";nodeId:string;offset:number;text:string}
 | {kind:"delete";nodeId:string;start:number;end:number;deletedTextHash:string}
 | {kind:"replace";nodeId:string;start:number;end:number;removedTextHash:string;insertedText:string}
 | {kind:"paste";nodeId:string;offset:number;text:string}
 | {kind:"cut";nodeId:string;start:number;end:number;cutTextHash:string}
 | {kind:"format";nodeId:string;start:number;end:number;mark:string;enabled:boolean}
 | {kind:"undo"|"redo";transactionId:string}
 | {kind:"paragraph-break";nodeId:string;offset:number}
 | {kind:"structure-change";nodeId:string;from:string;to:string}
 | {kind:"citation-insert";nodeId:string;offset:number;sourceId:string;locator?:string}
 | {kind:"source-attach";sourceId:string;contentHash:string}
 | {kind:"ai-request";interactionId:string;purpose:string;promptHash:string;contextHash:string}
 | {kind:"ai-response";interactionId:string;provider:string;model:string;responseHash:string}
 | {kind:"ai-accept";interactionId:string;responseStart:number;responseEnd:number;acceptedText:string}
 | {kind:"ai-reject";interactionId:string}
 | {kind:"checkpoint";canonicalDocumentHash:string};

export type ForensicEvent={
 schemaVersion:1;id:string;documentId:string;sequence:number;revision:number;
 occurredAt:string;actorId:string;actorRole:"student"|"mentor"|"system";
 payload:ForensicPayload;
};

export function createForensicEvent(input:ForensicEvent):ForensicEvent{
 if(input.schemaVersion!==1||!input.id||!input.documentId||!input.actorId)throw new Error("createForensicEvent: invalid identity");
 if(!Number.isSafeInteger(input.sequence)||input.sequence<1||!Number.isSafeInteger(input.revision)||input.revision<0)throw new Error("createForensicEvent: invalid sequence");
 if(Number.isNaN(Date.parse(input.occurredAt)))throw new Error("createForensicEvent: invalid timestamp");
 if(input.actorRole!=="student"&&["insert-text","delete","replace","paste","cut"].includes(input.payload.kind))throw new Error("createForensicEvent: authoring mutation requires student actor");
 return structuredClone(input);
}
