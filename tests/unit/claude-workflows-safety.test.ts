import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// This test guards the two optional Claude workflows against accidental
// reintroduction of automatic paid AI runs or unpinned external code.
// It does not authenticate the external Claude GitHub App or inspect secrets.
const mention = readFileSync(new URL("../../.github/workflows/claude.yml", import.meta.url), "utf8");
const manual = readFileSync(new URL("../../.github/workflows/claude-code-review.yml", import.meta.url), "utf8");

describe("Claude workflow owner-only security contract", () => {
  it("pins every external action to a full immutable SHA", () => {
    for (const yaml of [mention, manual]) {
      const actions = [...yaml.matchAll(/^\s+uses:\s*(\S+)/gm)].map((match) => match[1]);
      expect(actions).toHaveLength(2);
      for (const action of actions) {
        expect(action).toMatch(/^[a-z0-9_-]+\/[a-z0-9_-]+@[a-f0-9]{40}$/i);
      }
      expect(yaml).toMatch(/persist-credentials:\s*false/);
      expect(yaml).toMatch(/contents:\s*read/);
      expect(yaml).not.toMatch(/contents:\s*write/);
    }
  });

  it("never triggers Claude review on ordinary pull requests", () => {
    expect(manual).toMatch(/^\s+workflow_dispatch:\s*$/m);
    expect(manual).toMatch(/github\.actor == github\.repository_owner/);
    expect(manual).not.toMatch(/^\s+(?:pull_request|pull_request_target):/m);
    expect(manual).toMatch(/Only same-repository pull requests may be reviewed/);
    expect(manual).toMatch(/CLAUDE_CODE_OAUTH_TOKEN must be configured/);
    expect(manual).not.toMatch(/plugin_marketplaces:/);
  });

  it("restricts mention-triggered runs to the actual GitHub owner", () => {
    expect(mention).toMatch(/^\s+issue_comment:\s*$/m);
    expect(mention).toMatch(/github\.event\.comment\.user\.login == github\.repository_owner/);
    expect(mention).toMatch(/contains\(github\.event\.comment\.body, '@claude'\)/);
    expect(mention).not.toMatch(/^\s+(?:pull_request|issues|pull_request_review|pull_request_review_comment):/m);
    expect(mention).toMatch(/CLAUDE_CODE_OAUTH_TOKEN is not configured/);
  });
});
