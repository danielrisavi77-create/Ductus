import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// F-011 part B: GitHub CLI calls that must not run from an agent session. The
// Safety Net rulebook ductus-gh blocks the admin merge and every way to print
// the token; .claude/settings.json denies writes through `gh api` to commit
// statuses, rulesets and branch protection, which a token rule cannot see
// because the endpoint is a path, not a fixed token.
const root = fileURLToPath(new URL("../../", import.meta.url));
const bin = fileURLToPath(new URL("../../node_modules/cc-safety-net/dist/bin/cc-safety-net.js", import.meta.url));
const read = (file) => JSON.parse(fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"));
const rulebook = read(".cc-safety-net/rules/ductus-gh/rulebook.json");
const settings = read(".claude/settings.json");

function decide(tool_name, command) {
  const event = { hook_event_name: "PreToolUse", cwd: root, tool_name, tool_input: { command } };
  const result = spawnSync(process.execPath, [bin, "hook", "--coding-cli"], { input: JSON.stringify(event), encoding: "utf8", cwd: root });
  assert.equal(result.status, 0);
  if (!result.stdout.trim()) return "allowed";
  const output = JSON.parse(result.stdout).hookSpecificOutput;
  return /Rule: (\S+)/.exec(output.permissionDecisionReason)?.[1] ?? output.permissionDecision;
}

test("the project rule list loads the gh rulebook next to the git one", () => {
  assert.deepEqual(read(".cc-safety-net/rules/rule.json").rules, ["ductus-rules", "ductus-gh"]);
});

for (const tool of ["Bash", "PowerShell"]) {
  test(`ductus-gh rulebook cases hold for the ${tool} tool`, () => {
    for (const { command, expect, rule } of rulebook.tests) {
      const expected = expect === "blocked" ? `custom.ductus-gh/${rule}` : "allowed";
      assert.equal(decide(tool, command), expected, command);
    }
  });
}

test("every gh rule has a blocked case and the rulebook has allowed controls", () => {
  for (const { name } of rulebook.rules) {
    assert.ok(rulebook.tests.some((t) => t.expect === "blocked" && t.rule === name), name);
  }
  assert.ok(rulebook.tests.filter((t) => t.expect === "allowed").length >= 4);
});

// Claude Code permission rules: `Tool(pattern)`, where `*` matches any run of
// characters and everything else is literal. This mirrors that reading to
// check the patterns below; Claude Code itself is the enforcer.
function globMatch(pattern, text) {
  const [first, ...rest] = pattern.split("*");
  if (rest.length === 0) return text === first;
  if (!text.startsWith(first)) return false;
  const last = rest.pop();
  let at = first.length;
  for (const part of rest) {
    const found = text.indexOf(part, at);
    if (found === -1) return false;
    at = found + part.length;
  }
  return text.length - last.length >= at && text.endsWith(last);
}

function denied(tool, command) {
  const prefix = `${tool}(`;
  return settings.permissions.deny.some(
    (rule) => rule.startsWith(prefix) && rule.endsWith(")") && globMatch(rule.slice(prefix.length, -1), command),
  );
}

const SHA = "a".repeat(40);
const API_WRITES = [
  `gh api -X POST repos/o/r/statuses/${SHA} -f state=success -f context=x`,
  `gh api repos/o/r/statuses/${SHA} -f state=success -f context=x`,
  `gh api repos/o/r/statuses/${SHA} -X POST -F state=success`,
  `gh api --method POST repos/o/r/statuses/${SHA} --input body.json`,
  `gh api repos/o/r/statuses/${SHA} --raw-field state=success`,
  `gh api --method=POST repos/o/r/statuses/${SHA}`,
  `gh api -XPOST repos/o/r/statuses/${SHA}`,
  "gh api -X PUT repos/o/r/rulesets/7 --input ruleset.json",
  "gh api -X DELETE repos/o/r/rulesets/7",
  "gh api repos/o/r/rulesets -f name=x -f enforcement=disabled",
  "gh api -X PUT repos/o/r/branches/main/protection --input p.json",
  "gh api -X DELETE repos/o/r/branches/main/protection",
  "gh api -X PATCH repos/o/r/branches/main/protection/required_status_checks -F strict=false",
  "gh api repos/o/r/branches/main/protection/enforce_admins -X DELETE",
  "gh api --method PATCH repos/o/r/branches/main/protection/required_pull_request_reviews --input r.json",
  // -i is gh api's only boolean shorthand, so it is the only flag that can
  // lead a cluster such as -iX, -if or -iF.
  "gh api -iX DELETE repos/o/r/rulesets/7",
  "gh api repos/o/r/rulesets/7 -iX DELETE",
  "gh api -iX DELETE repos/o/r/branches/main/protection",
  `gh api repos/o/r/statuses/${SHA} -if state=success`,
  `gh api -iF state=success repos/o/r/statuses/${SHA}`,
  "gh api -iiX PUT repos/o/r/branches/main/protection --input p.json",
  // GraphQL mutations on branch protection rules and rulesets.
  "gh api graphql -f query='mutation { deleteBranchProtectionRule(input: {branchProtectionRuleId: \"x\"}) { clientMutationId } }'",
  "gh api -f query='mutation { updateBranchProtectionRule(input: {branchProtectionRuleId: \"x\"}) { clientMutationId } }' graphql",
  "gh api graphql -F query=@m.graphql -f q='createRepositoryRuleset'",
  "gh api graphql -f query='mutation { deleteRepositoryRuleset(input: {repositoryRulesetId: \"x\"}) { clientMutationId } }'",
];
const ROUTINE = [
  "gh api repos/o/r/pulls/7",
  `gh api repos/o/r/commits/${SHA}/status --jq .state`,
  "gh api repos/o/r/pulls/7/comments --paginate",
  "gh api graphql -f query='query { viewer { login } }'",
  "gh api -X POST repos/o/r/issues/7/comments -f body=x",
  "gh pr merge 7 --squash",
  "gh pr checks 7",
  "git -c core.quotePath=false status",
];

for (const tool of ["Bash", "PowerShell"]) {
  test(`settings.json denies gh api writes to statuses, rulesets and branch protection (${tool})`, () => {
    for (const command of API_WRITES) assert.ok(denied(tool, command), `${tool}: ${command}`);
  });

  test(`settings.json keeps routine gh and git -c commands open (${tool})`, () => {
    for (const command of ROUTINE) assert.ok(!denied(tool, command), `${tool}: ${command}`);
    // Plain GET of the guarded endpoints stays open; docs/SESSIONS.md 4a names
    // the explicit -X GET form as a false block.
    assert.ok(!denied(tool, "gh api repos/o/r/rulesets"));
    assert.ok(!denied(tool, "gh api repos/o/r/branches/main/protection"));
    assert.ok(denied(tool, "gh api -X GET repos/o/r/rulesets"));
    // The -i rule also blocks a read with --include on these endpoints, and
    // the GraphQL rule a typed read of a ruleset; docs/SESSIONS.md 4a names both.
    assert.ok(denied(tool, "gh api --include repos/o/r/rulesets"));
    assert.ok(!denied(tool, "gh api graphql -f query='query { repository(owner: \"o\", name: \"r\") { branchProtectionRules(first: 5) { nodes { pattern } } } }'"));
  });

  test(`settings.json repeats the rulebook's admin merge and token denies (${tool})`, () => {
    for (const command of ["gh pr merge 7 --admin", "gh pr merge --admin 7 --squash", "gh auth token", "gh auth status -t", "gh auth status --show-token"]) {
      assert.ok(denied(tool, command), `${tool}: ${command}`);
    }
    for (const command of ["gh pr merge 7 --squash", "gh auth status"]) assert.ok(!denied(tool, command), `${tool}: ${command}`);
  });
}
