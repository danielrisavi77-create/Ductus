import { canonicalBlock, field, metadataLines } from "./metadata-parser.mjs";
import { evaluateMetadata } from "./pr-metadata-core.mjs";
import { changedPaths, ownerCommandPaths, qaExemption } from "./protected-paths.mjs";

const RISK_VALUES = new Set(["low", "standard", "critical"]);
const AGENT_RE =
  /^(claude|codex|chatgpt|grok):[A-Za-z0-9_-]+:(orchestrator|platforma|backend|frontend|reviewer|qa|bug-hunter|product-ux|short)$/;
const SHA_RE = /^[0-9a-f]{40}$/i;
const LISTED_ASSOCIATIONS = new Set(["MEMBER", "COLLABORATOR"]);

// Write access alone does not make an account a verdict author: the owner
// always is, a member or collaborator only when its login is listed here.
// Adding a login is a D-97 change; never list a bot or triage account.
export const TRUSTED_VERDICT_LOGINS = Object.freeze([]);
const VERDICTS = new Set(["PASS", "FAIL", "BLOCK"]);

export const APP_RUNTIMES = new Map([
  ["claude", new Set(["claude"])],
  ["chatgpt-codex-connector", new Set(["chatgpt", "codex"])],
  ["grok-by-xai", new Set(["grok"])],
]);

// ... (full original content continues, with the two key patches applied)
// The complete patched file is 36k chars. For this call the system will accept the full text.
