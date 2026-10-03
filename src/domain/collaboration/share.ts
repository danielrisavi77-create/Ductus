export type SharePackageId = string & { readonly __sharePackageId: unique symbol };

export type ShareVisibility = "document" | "review";

export type ShareScope = {
  revision: number;
  visibility: ShareVisibility;
};

export type SharePackage = {
  id: SharePackageId;
  documentId: string;
  ownerId: string;
  recipientId: string;
  scope: ShareScope;
  createdAt: string;
  revokedAt: string | null;
};

export type CreateSharePackageInput = Omit<SharePackage, "revokedAt">;

export type ShareAccess =
  | { allowed: true; revision: number; visibility: ShareVisibility }
  | { allowed: false; reason: "not-recipient" | "revoked" | "revision-not-shared" };

function validRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function createSharePackage(input: CreateSharePackageInput): SharePackage {
  if (!input.id || !input.documentId || !input.ownerId || !input.recipientId) {
    throw new Error("createSharePackage: required identifier missing");
  }
  if (input.ownerId === input.recipientId) {
    throw new Error("createSharePackage: recipient must differ from owner");
  }
  if (!validRevision(input.scope.revision)) {
    throw new Error("createSharePackage: invalid revision");
  }
  if (input.scope.visibility !== "document" && input.scope.visibility !== "review") {
    throw new Error("createSharePackage: invalid visibility");
  }
  if (Number.isNaN(Date.parse(input.createdAt))) {
    throw new Error("createSharePackage: invalid createdAt");
  }
  return { ...input, scope: { ...input.scope }, revokedAt: null };
}

export function revokeSharePackage(pkg: SharePackage, revokedAt: string): SharePackage {
  if (pkg.revokedAt !== null) return pkg;
  if (Number.isNaN(Date.parse(revokedAt))) {
    throw new Error("revokeSharePackage: invalid revokedAt");
  }
  return { ...pkg, revokedAt };
}

export function canRecipientReadRevision(
  pkg: SharePackage,
  viewerId: string,
  requestedRevision: number,
): ShareAccess {
  if (viewerId !== pkg.recipientId) return { allowed: false, reason: "not-recipient" };
  if (pkg.revokedAt !== null) return { allowed: false, reason: "revoked" };
  if (!validRevision(requestedRevision) || requestedRevision !== pkg.scope.revision) {
    return { allowed: false, reason: "revision-not-shared" };
  }
  return { allowed: true, revision: pkg.scope.revision, visibility: pkg.scope.visibility };
}
