import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";
import { NOTICE_TEMPLATE_VERSION } from "@/domain/notice/fingerprint";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

// DAN-306, A9: the static text of the S3 notice is not stored with an
// acknowledgment; its version (NOTICE_TEMPLATE_VERSION) is, inside the
// fingerprint. This pin fails on any change of that text, until the version
// is raised and the digest below is replaced in the same change.
const STATIC_KEYS = [
  "step", "dueAt", "notOpen", "pastDue", "toolsHeading", "noTools", "recordedHeading", "recorded",
  "notRecordedHeading", "notRecorded", "teacherHeading", "teacher", "teacherExtended", "retention", "note",
  "checkbox", "confirm", "notConsent",
] as const;
// Shown around the notice, not part of what is acknowledged: progress, errors
// and what follows the confirmation.
const TRANSIENT_KEYS = ["confirming", "errors", "confirmed", "openEditor"] as const;

const PINNED: Record<number, string> = {
  1: "663b3b73c7897d2b5f20e8121ba94be7fba3b6c7906b198c3faf8c519100846c",
};

function template(): JcsJsonValue {
  const s = t.student as unknown as Record<string, JcsJsonValue>;
  return {
    student: Object.fromEntries(STATIC_KEYS.map((key) => [key, s[key]])),
    tools: t.teacher.tools as unknown as JcsJsonValue,
    workTypes: t.teacher.assignment.workTypes as unknown as JcsJsonValue,
    wordMinimum: t.workspace.wordMinimum,
    wordMaximum: t.workspace.wordMaximum,
  };
}

describe("notice template pin (DAN-306, A9)", () => {
  it("the static notice text has the digest pinned for NOTICE_TEMPLATE_VERSION", () => {
    const digest = createHash("sha256").update(canonicalizeJcs(template()), "utf8").digest("hex");
    expect({ version: NOTICE_TEMPLATE_VERSION, digest }).toEqual({
      version: NOTICE_TEMPLATE_VERSION,
      digest: PINNED[NOTICE_TEMPLATE_VERSION],
    });
  });

  it("every student text the notice shows is pinned or listed as transient", () => {
    const source = readFileSync("src/components/student/AssignmentNotice.tsx", "utf8");
    const used = new Set([...source.matchAll(/(?<![\w.])s\.(\w+)/g)].map((match) => match[1]));
    expect([...used].sort()).toEqual([...STATIC_KEYS, ...TRANSIENT_KEYS].sort());
    expect(source).toContain("const tools = t.teacher.tools;");
    expect(source).toContain("t.teacher.assignment.workTypes");
    expect(source).toContain("wordRangeHr(");
    for (const key of STATIC_KEYS) expect(typeof (t.student as Record<string, unknown>)[key]).not.toBe("undefined");
  });
});
