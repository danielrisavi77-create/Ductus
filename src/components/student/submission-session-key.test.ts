import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Review 6386405994 on #653 (as CommentPanel, F-088): the submission rendered
 * under another session without a reload starts from nothing. Read from the
 * source like session-mark-coverage.test.ts, as rendering the page needs a
 * request: the exported component only keys the stateful one by the session.
 */
const source = readFileSync(join(process.cwd(), "src/components/student/Submission.tsx"), "utf8");

describe("the submission is keyed by its session", () => {
  it("renders the stateful submission keyed by the session tag", () => {
    expect(source).toMatch(
      /export default function Submission\([^)]*\)[^{]*\{\s*return <SessionSubmission key=\{session\.tag\} assignmentId=\{assignmentId\} session=\{session\} \/>;\s*\}/,
    );
  });

  it("keeps every piece of state inside the keyed component", () => {
    const wrapper = source.slice(source.indexOf("export default function Submission"), source.indexOf("function SessionSubmission"));
    expect(wrapper).not.toMatch(/use(State|Ref|Effect|LayoutEffect|Callback)\(/);
    expect(source.slice(source.indexOf("function SessionSubmission"))).toMatch(/useState\(/);
  });
});
