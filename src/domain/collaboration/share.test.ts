import { describe, expect, it } from "vitest";
import { canRecipientReadRevision, createSharePackage, revokeSharePackage, type SharePackageId } from "./share";

const ID = "share-001" as SharePackageId;
const base = () => createSharePackage({
  id: ID, documentId: "doc-1", ownerId: "student-1", recipientId: "mentor-1",
  scope: { revision: 3, visibility: "review" }, createdAt: "2026-09-28T12:00:00.000Z",
});

describe("SharePackage", () => {
  it("allows only the named recipient to read the pinned revision", () => {
    const pkg=base();
    expect(canRecipientReadRevision(pkg,"mentor-1",3)).toEqual({allowed:true,revision:3,visibility:"review"});
    expect(canRecipientReadRevision(pkg,"mentor-2",3)).toEqual({allowed:false,reason:"not-recipient"});
  });
  it("does not expose a newer private revision", () => {
    expect(canRecipientReadRevision(base(),"mentor-1",4)).toEqual({allowed:false,reason:"revision-not-shared"});
  });
  it("does not substitute an older revision either", () => {
    expect(canRecipientReadRevision(base(),"mentor-1",2)).toEqual({allowed:false,reason:"revision-not-shared"});
  });
  it("revocation denies future reads while preserving the package record", () => {
    const revoked=revokeSharePackage(base(),"2026-09-28T13:00:00.000Z");
    expect(revoked.scope.revision).toBe(3);
    expect(revoked.revokedAt).toBe("2026-09-28T13:00:00.000Z");
    expect(canRecipientReadRevision(revoked,"mentor-1",3)).toEqual({allowed:false,reason:"revoked"});
  });
  it("is idempotent when already revoked", () => {
    const once=revokeSharePackage(base(),"2026-09-28T13:00:00.000Z");
    expect(revokeSharePackage(once,"2026-09-28T14:00:00.000Z")).toEqual(once);
  });
  it("rejects invalid package inputs", () => {
    expect(()=>createSharePackage({id:"" as SharePackageId,documentId:"doc-1",ownerId:"s",recipientId:"m",scope:{revision:3,visibility:"review"},createdAt:"2026-09-28T12:00:00Z"})).toThrow("identifier");
    expect(()=>createSharePackage({id:ID,documentId:"doc-1",ownerId:"same",recipientId:"same",scope:{revision:3,visibility:"review"},createdAt:"2026-09-28T12:00:00Z"})).toThrow("recipient");
    expect(()=>createSharePackage({id:ID,documentId:"doc-1",ownerId:"s",recipientId:"m",scope:{revision:-1,visibility:"review"},createdAt:"2026-09-28T12:00:00Z"})).toThrow("revision");
  });
});
