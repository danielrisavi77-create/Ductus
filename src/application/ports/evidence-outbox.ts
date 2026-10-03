import type {
  EvidenceIngestCommandV2,
  EvidenceIngestOutcome,
  SignedEvidenceReceipt,
} from "./evidence-ingest";

export type EvidenceOutboxStatus =
  | "pending"
  | "uploading"
  | "accepted"
  | "blocked";

export type EvidenceOutboxItem = {
  id: string;
  command: EvidenceIngestCommandV2;
  status: EvidenceOutboxStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastFailure?: EvidenceIngestOutcome["status"];
  receipt?: SignedEvidenceReceipt;
};

export interface EvidenceOutboxStore {
  put(item: EvidenceOutboxItem): Promise<void>;
  get(id: string): Promise<EvidenceOutboxItem | null>;
  listPending(limit: number): Promise<readonly EvidenceOutboxItem[]>;
}
