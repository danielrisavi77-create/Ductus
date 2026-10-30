// The tooling run of the pre-push hook (DAN-361, plan #986). Test names carry the
// plan items; every path and name below is invented for the test.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLING_DOCS, changedAgainstMain, describe, explain, fileReadingTests, localImports, main, parseRawDiff, plan, pushesOnlyHead, toolingInventory } from "./pre-push-tests.mjs";

const change = (file, ...record) => {
  const [status, oldMode, mode] = record.length ? record : ["M", "100644", "100644"];
  return { file, status, oldMode, mode };
};
const added = (file) => change(file, "A", "000000", "100644");
const repository = fileURLToPath(new URL("../../", import.meta.url));
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)));
const zero = "0".repeat(40);

// One prepared repository, copied for each test: a fixture is many git processes.
let template;
after(() => { if (template) rmSync(template, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });

function fixture({ files } = {}) {
  const root = mkdtempSync(join(tmpdir(), "dan361-"));
  const git = (...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: root, stdio: "pipe", encoding: "utf8", env: gitEnv });
  const put = (file, source) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), source); };
  const base = {
    "scripts/engineering/a.mjs": "export const a = 1;\n",
    "scripts/engineering/a.test.mjs": "// synthetic node test\n",
    "scripts/orchestrator/b.test.mjs": "// synthetic node test\n",
    "src/a.ts": "export const x = 1;\n",
    "tests/property/forbidden-terms.property.test.ts": "// named consumer\n",
    "tests/unit/codeowners.test.ts": "// named computed importer\n",
    "tests/unit/pr-metadata-precheck.test.ts": "// named child-process consumer\n",
    "tests/unit/vitest-workers.test.ts": "// named description of this run\n",
    "tests/unit/dynamic.test.ts": 'import "./helper";\n',
    "tests/unit/helper.ts": 'import { pathToFileURL } from "node:url";\nawait import(pathToFileURL("scripts/engineering/a.mjs").href);\n',
    "tests/unit/disk.test.ts": 'import { readFileSync } from "node:fs";\n',
    "README.md": "# Synthetic docs\n",
    ...files,
  };
  if (template && !files) {
    cpSync(template, root, { recursive: true });
  } else {
    for (const [file, source] of Object.entries(base)) put(file, source);
    git("init", "-q", "-b", "main", "--template=");
    git("config", "user.name", "Synthetic fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "core.autocrlf", "false");
    git("add", ".");
    git("commit", "-qm", "fixture base");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "-q", "-b", "feature");
    if (!files) {
      template = mkdtempSync(join(tmpdir(), "dan361-template-"));
      cpSync(root, template, { recursive: true });
    }
  }
  const f = {
    root, put, git,
    // Retries: on Windows a git process killed for its output can still hold the directory.
    close: () => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
    head: () => git("rev-parse", "HEAD").trim(),
    commit: (...paths) => { git("add", ...(paths.length ? paths : ["."])); git("commit", "-qm", "fixture change"); },
    // Index entries: names a filesystem may refuse, and modes it cannot show.
    index: (path, mode = "100644", object = null) => {
      const sha = object ?? execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: root, input: "synthetic\n", encoding: "utf8", env: gitEnv }).trim();
      execFileSync("git", ["update-index", "-z", "--index-info"], { cwd: root, input: `${mode} ${sha}\t${path}\0`, env: gitEnv });
    },
    pushLine: () => `refs/heads/feature ${f.head()} refs/heads/feature ${zero}\n`,
    // The real selector over the real diff, with commands recorded and not run.
    decide: ({ env = gitEnv, lines = f.pushLine(), execute = () => ({ status: 0 }), platform = process.platform } = {}) => {
      const calls = [];
      const code = main(root, env, (command, args, options) => { calls.push([command, args]); return execute(command, args, options); }, typeof lines === "function" ? lines : () => lines, platform);
      const full = calls.length === 1 && calls[0][1].at(-1) === "test";
      const scoped = !full && calls[0]?.[0] !== process.execPath;
      return { code, calls, mode: full ? "full" : scoped ? "scoped" : "tooling" };
    },
    judged: () => plan(changedAgainstMain(root, gitEnv)?.files),
  };
  return f;
}

const withFixture = (body, options) => { const f = fixture(options); try { return body(f); } finally { f.close(); } };
const toolChange = (f) => { f.put("scripts/engineering/a.mjs", "export const a = 2;\n"); f.commit(); };

test("A-01: only the positive allowlist gets the tooling run", () => {
  for (const file of ["scripts/engineering/review-gate-core.mjs", "scripts/orchestrator/pr-ready.mjs", "scripts/engineering/pre-push-tooling.test.mjs", ...TOOLING_DOCS]) {
    assert.equal(plan([change(file)]), "tooling", file);
    assert.equal(plan([added(file)]), "tooling", file);
    assert.equal(plan([change(file)], { DUCTUS_PREPUSH_FULL: "1" }), "full", file);
  }
  assert.equal(plan([change("scripts/engineering/a.mjs"), change("docs/TESTING.md")]), "tooling");
});

test("unrecognized paths, metadata, statuses and mixed changes never get the exception", () => {
  for (const file of [
    // A-02, A-03: nesting and dot segments
    "scripts/engineering/nested/a.mjs", "scripts/orchestrator/a/b/c.mjs", "scripts/engineering/.a.mjs", "scripts/engineering/.cache/a.mjs", "scripts/.engineering/a.mjs",
    // A-04, D-03: agent instructions, any spelling
    "scripts/engineering/CLAUDE.md", "scripts/orchestrator/AGENTS.md", "scripts/engineering/GEMINI.local.md", "docs/CLAUDE-primjer.md", ".claude/skills/a/SKILL.md", ".agents/skills/a/SKILL.md",
    "CLAUDE.md", "AGENTS.md", "claude.md", "Agents.md", "gemini.MD", ".Claude/x.md",
    // A-05: other extensions
    "scripts/engineering/playwright-install.sh", "scripts/engineering/a.js", "scripts/engineering/a.cjs", "scripts/engineering/a.ts", "scripts/engineering/a.json",
    "scripts/engineering/a.yml", "scripts/engineering/a.mjs.orig", "scripts/engineering/a.mjs~", "scripts/engineering/a", "scripts/engineering/a.sql", "scripts/engineering/a.md",
    // A-06: neighbours
    "scripts/engineering-staro/a.mjs", "scripts/orchestrator2/a.mjs", "scripts/hooks/a.mjs", "scripts/demo/a.mjs", "scripts/db/a.mjs",
    // A-10, I-06, I-07: other documents
    "docs/AGENT_SYSTEM_V2.md", "docs/FREE-AI-PR-REVIEW.md", "docs/ISTRAZIVANJE-ALATA-2026-10-25.md", "docs/engineering/PLAN-TOKOVI-2026-10-25.md", "docs/new-unknown.md",
    "plugins/ductura-engineering/references/source-map.md", ".github/ISSUE_TEMPLATE/agent-task.md",
    // listed rule documents only under their exact name
    "state.md", "State.md", "STATE.MD", "docs/STATE.md", "scripts/engineering/STATE.md", "docs/decisions.md", "docs/DECISIONS.MD", "docs/sub/DECISIONS.md", "docs/DECISIONS.md.orig",
    "docs/sessions.md", "docs/orkestrator.md", "docs/Orkestrator-Sazetak.md", "docs/engineering_system.md", "docs/ENGINEERING_SYSTEM-sazetak.md", "docs/multi-account.md",
    ".github/pull_request_template.md", "e2e/README.md", "db/tests/README.md", "tests/unit/fixtures/a.md", "src/README.md", "app/README.md", "public/README.md",
    ".claude/rules/pravila-i-alati.md", ".claude/uloge/README.md",
    // A-11: path tricks
    "scripts/engineering/../a.mjs", "./scripts/engineering/a.mjs", "scripts/engineering//a.mjs", "/scripts/engineering/a.mjs", "scripts\\engineering\\a.mjs",
    // D-01, D-02: case
    "Scripts/engineering/a.mjs", "scripts/Engineering/a.mjs", "scripts/engineering/X.MJS", "scripts/engineering/a.Test.mjs", "scripts/engineering/Upper.mjs", "readme.md", "README.MD", "docs/testing.md",
    // E-01, E-04: spaces, homoglyphs, invisible characters
    "scripts/engineering/a b.mjs", "scripts/engineering/a.mjs ", " scripts/engineering/a.mjs", "docs/a\tb.md", "scripts/eng\u0456neering/a.mjs", "scripts/engineering/a\u200b.mjs", "scripts/engineering/\u202ea.mjs",
    // shell characters
    "scripts/engineering/a;m.mjs", "scripts/engineering/a%p.mjs",
    // A-07: configuration
    "lefthook.yml", "package.json", "pnpm-lock.yaml", ".nvmrc", "eslint.config.mjs", "tsconfig.json", "vitest.config.ts", ".github/workflows/ci.yml", ".github/CODEOWNERS", ".claude/settings.json",
  ]) {
    assert.equal(plan([change(file)]), "full", file);
    assert.equal(plan([change("scripts/engineering/a.mjs"), change(file)]), "full", file);
  }
  // B-05
  for (const status of ["D", "R", "C", "T", "U", "X", "R100", "C075", "", undefined]) {
    assert.equal(plan([{ ...change("scripts/engineering/a.mjs"), status }]), "full", String(status));
  }
  // C-01 to C-04, as data
  for (const [oldMode, mode, status] of [["100755", "100644", "M"], ["100644", "100755", "M"], ["100755", "100755", "M"], ["120000", "100644", "M"], ["100644", "120000", "M"],
    ["120000", "120000", "M"], ["160000", "160000", "M"], ["000000", "100755", "A"], ["000000", "120000", "A"], ["000000", "160000", "A"], [undefined, "100644", "M"], [undefined, undefined, "M"], ["100644", "100644", "A"]]) {
    assert.equal(plan([change("scripts/engineering/a.mjs", status, oldMode, mode)]), "full", `${status} ${oldMode} ${mode}`);
  }
  for (const unknown of [null, [], [null], [{}], Array(1)]) assert.equal(plan(unknown), "full");
  assert.match(explain([change("docs/new-unknown.md")]).reason, /reach/);
});

const RULE_DOCS = ["STATE.md", "docs/DECISIONS.md", "docs/SESSIONS.md", "docs/ORKESTRATOR.md", "docs/ORKESTRATOR-SAZETAK.md",
  "docs/ENGINEERING_SYSTEM.md", "docs/ENGINEERING_SYSTEM-SAZETAK.md", "docs/MULTI-ACCOUNT.md"];

test("A-10, I-07: a change of rule documents, as D-191 made it, runs tooling and anything else beside it runs everything", () => {
  for (const doc of RULE_DOCS) {
    assert.equal(plan([change(doc)]), "tooling", doc);
    assert.equal(plan([added(doc)]), "tooling", doc);
  }
  const d191 = ["docs/DECISIONS.md", "STATE.md", "docs/PROGRAM.md", "docs/PLAN-DEMO.md"];
  withFixture((f) => {
    for (const doc of d191) f.put(doc, "synthetic\n");
    f.commit();
    f.git("update-ref", "refs/remotes/origin/main", "HEAD");
    for (const doc of d191) f.put(doc, "changed synthetic\n");
    f.commit();
    const { mode, calls } = f.decide();
    assert.equal(mode, "tooling");
    assert.equal(calls.length, 3, "script tests, vitest --changed and the readers all run");
    for (const instructions of ["CLAUDE.md", "AGENTS.md", ".claude/rules/a.md", ".github/pull_request_template.md"]) {
      f.put(instructions, "synthetic\n");
      f.commit();
      assert.equal(f.decide().mode, "full", instructions);
      f.git("update-ref", "refs/remotes/origin/main", "HEAD");
      f.put("STATE.md", `changed for ${instructions}\n`);
      f.commit();
      assert.equal(f.decide().mode, "tooling", "the guard above caught the file, not a stale state");
    }
  });
});

test("A-08, H-04, H-05: a tool beside src/ runs everything, also through a merge or a stacked branch", () => {
  assert.equal(plan([change("scripts/engineering/a.mjs"), change("src/a.ts")]), "full");
  withFixture((f) => {
    f.put("docs/TESTING.md", "x\n");
    f.put("src/a.ts", "export const x = 2;\n");
    f.commit("src/a.ts");
    f.commit("docs/TESTING.md");
    assert.equal(f.judged(), "full");
    assert.equal(f.decide().mode, "full");
  });
  withFixture((f) => {
    f.git("checkout", "-q", "-b", "newer-main");
    f.put("src/a.ts", "export const x = 3;\n");
    f.commit();
    f.git("checkout", "-q", "feature");
    f.git("merge", "-q", "--no-ff", "--no-edit", "newer-main");
    toolChange(f);
    assert.equal(f.judged(), "full", "origin/main is stale, so the merged src/ change is still in the diff");
  });
});

test("A-09: a selector that always narrows fails its own test", () => {
  const dir = mkdtempSync(join(tmpdir(), "dan361-mutant-"));
  try {
    const here = join(dir, "scripts", "engineering");
    mkdirSync(here, { recursive: true });
    const selector = readFileSync(new URL("./pre-push-tests.mjs", import.meta.url), "utf8");
    const opening = "export function isToolingChange({ status, file, oldMode, mode }) {\n";
    assert.ok(selector.includes(opening));
    copyFileSync(fileURLToPath(import.meta.url), join(here, "pre-push-tooling.test.mjs"));
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = () => spawnSync(process.execPath, ["--test", "--test-name-pattern=never get the exception", join(here, "pre-push-tooling.test.mjs")], { encoding: "utf8", env });
    writeFileSync(join(here, "pre-push-tests.mjs"), selector);
    assert.equal(run().status, 0, "the unchanged copy passes, so the failure below is the mutation");
    writeFileSync(join(here, "pre-push-tests.mjs"), selector.replace(opening, `${opening}  return true;\n`));
    assert.notEqual(run().status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A-09: the selector and its neighbours are tooling, and the description of this run always joins", () => withFixture((f) => {
  f.put("scripts/engineering/pre-push-tests.mjs", "// synthetic\n");
  f.commit();
  const { mode, calls } = f.decide();
  assert.equal(mode, "tooling");
  assert.ok(calls[2][1].includes("tests/unit/vitest-workers.test.ts"));
  assert.ok(calls[2][1].includes("tests/property/forbidden-terms.property.test.ts"), "I-03");
}));

test("B-01 to B-04, D-04: deletions and renames in real git run everything, whatever the local config", () => {
  withFixture((f) => {
    f.git("rm", "-q", "scripts/engineering/a.mjs", "scripts/engineering/a.test.mjs");
    f.git("commit", "-qm", "gone");
    const { files } = changedAgainstMain(f.root, gitEnv);
    assert.equal(files.length, 2);
    for (const deleted of files) assert.equal(plan([deleted]), "full", deleted.file);
  });
  withFixture((f) => {
    f.put("scripts/hooks/x.mjs", "export const big = 'synthetic rename source';\n");
    f.commit();
    f.git("update-ref", "refs/remotes/origin/main", "HEAD");
    const moves = [["scripts/engineering/a.mjs", "scripts/engineering/moved.mjs"], ["scripts/hooks/x.mjs", "scripts/engineering/x.mjs"], ["README.md", ".claude/x.md"]];
    mkdirSync(join(f.root, ".claude"));
    for (const [from, to] of moves) f.git("mv", from, to);
    f.git("commit", "-qm", "moved");
    for (const setting of ["true", "copies", "false"]) {
      f.git("config", "diff.renames", setting);
      const { files } = changedAgainstMain(f.root, gitEnv);
      for (const [from, to] of moves) {
        const pair = files.filter((c) => c.file === from || c.file === to);
        assert.deepEqual(pair.map((c) => c.status).sort(), ["A", "D"], `${setting} ${from}`);
        assert.equal(plan(pair), "full", `${setting} ${from}`);
      }
    }
  });
  withFixture((f) => {
    f.git("config", "core.ignorecase", "true");
    f.git("update-index", "--force-remove", "README.md");
    f.index("readme.md");
    f.git("commit", "-qm", "case only");
    assert.equal(f.judged(), "full");
  });
});

test("B-06, K-01: a new failing node test fails the real command", () => withFixture((f) => {
  f.put("scripts/orchestrator/new.test.mjs", 'import test from "node:test";\ntest("synthetic failure", () => { throw new Error("synthetic"); });\n');
  f.commit();
  const execute = (command, args, options) => (command === process.execPath ? spawnSync(command, args, { ...options, stdio: "pipe", env: (() => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; })() }) : { status: 0 });
  const { code, calls } = f.decide({ execute });
  assert.notEqual(code, 0);
  assert.equal(calls.length, 1, "no later phase hides the failure");
}));

test("C-01: a mode change in real git runs everything, both ways and as the only change", () => {
  withFixture((f) => {
    f.git("update-index", "--chmod=+x", "scripts/engineering/a.mjs");
    f.git("commit", "-qm", "executable");
    assert.equal(f.judged(), "full", "100644 to 100755");
  });
  withFixture((f) => {
    f.git("update-index", "--chmod=+x", "scripts/engineering/a.mjs");
    f.git("commit", "-qm", "executable");
    f.git("update-ref", "refs/remotes/origin/main", "HEAD");
    f.git("update-index", "--chmod=-x", "scripts/engineering/a.mjs");
    f.git("commit", "-qm", "not executable");
    const changes = changedAgainstMain(f.root, gitEnv).files;
    assert.deepEqual(changes.map(({ status, oldMode, mode }) => [status, oldMode, mode]), [["M", "100755", "100644"]]);
    assert.equal(plan(changes), "full", "100755 to 100644");
  });
});

test("C-02 to C-05: symlinks and gitlinks are judged from git objects, whatever core.symlinks says", () => {
  for (const symlinks of ["true", "false"]) {
    withFixture((f) => {
      f.git("config", "core.symlinks", symlinks);
      f.index("scripts/engineering/link.mjs", "120000");
      f.index("docs/TESTING.md", "120000");
      f.index("scripts/engineering/a.mjs", "120000");
      f.index("scripts/engineering/vendor", "160000", f.head());
      f.git("commit", "-qm", "links");
      const { files } = changedAgainstMain(f.root, gitEnv);
      assert.equal(files.length, 4);
      for (const entry of files) assert.equal(plan([entry]), "full", `${symlinks} ${entry.file}`);
      f.git("update-ref", "refs/remotes/origin/main", "HEAD");
      const object = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: f.root, input: "other-target", encoding: "utf8", env: gitEnv }).trim();
      f.index("scripts/engineering/link.mjs", "120000", object);
      f.git("commit", "-qm", "retarget");
      assert.equal(f.judged(), "full", "target change only");
    });
  }
});

test("E-01 to E-04: unusual names reach the selector exactly as written and never narrow", () => {
  const nfc = "docs/odluka-\u010d.md";
  const names = ["scripts/engineering/a b.mjs", "docs/a\tb.md", "scripts/engineering/c.mjs ", "docs/TESTING.md\nscripts/engineering/y.mjs", nfc, nfc.normalize("NFD"),
    "scripts/eng\u0456neering/a.mjs", "scripts/engineering/a\u200b.mjs", "scripts/engineering/\u202ea.mjs"];
  withFixture((f) => {
    f.git("config", "core.protectNTFS", "false"); // Windows git refuses some of these names otherwise.
    for (const name of names) f.index(name);
    f.git("commit", "-qm", "unusual names");
    for (const quotePath of ["true", "false"]) {
      f.git("config", "core.quotePath", quotePath);
      const { files } = changedAgainstMain(f.root, gitEnv);
      assert.deepEqual(files.map((c) => c.file).sort(), [...names].sort());
      for (const entry of files) assert.equal(plan([entry]), "full", JSON.stringify(entry.file));
    }
  });
});

test("E-05: git output config changes neither the names nor the outcome", () => withFixture((f) => {
  toolChange(f);
  for (const [key, value] of [["color.ui", "always"], ["color.diff", "always"], ["diff.noprefix", "true"], ["diff.mnemonicPrefix", "true"], ["diff.relative", "true"], ["diff.external", "synthetic-missing-tool"]]) {
    f.git("config", key, value);
    assert.equal(f.decide().mode, "tooling", key);
    f.git("config", "--unset", key);
  }
}));

test("F-01: git missing from PATH runs everything", () => withFixture((f) => {
  toolChange(f);
  assert.equal(changedAgainstMain(f.root, { PATH: "" }), null);
  assert.equal(f.decide({ env: { PATH: "" } }).mode, "full");
}));

test("F-02, F-04: git output that outgrows the buffer ends with no status and runs everything", () => withFixture((f) => {
  const sha = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: f.root, input: "x\n", encoding: "utf8", env: gitEnv }).trim();
  let input = "";
  for (let i = 0; i < 50000; i += 1) input += `100644 ${sha}\tdocs/gen/${i}.md\0`;
  execFileSync("git", ["update-index", "-z", "--index-info"], { cwd: f.root, input, env: gitEnv, maxBuffer: 1 << 26 });
  f.git("commit", "-qm", "many");
  assert.equal(changedAgainstMain(f.root, gitEnv), null);
  assert.equal(f.judged(), "full");
}));

test("F-03: an incomplete or unknown raw record is no list of changes", () => {
  const meta = `:100644 100644 ${"a".repeat(40)} ${"b".repeat(40)} M`;
  assert.deepEqual(parseRawDiff(""), []);
  assert.deepEqual(parseRawDiff(`${meta}\0docs/TESTING.md\0`), [{ oldMode: "100644", mode: "100644", status: "M", file: "docs/TESTING.md" }]);
  for (const raw of [null, undefined, "truncated", `${meta}\0docs/TESTING.md`, `${meta}\0`, `${meta}\0\0`, `${meta}\tdocs/TESTING.md\0`, `:broken\0a\0`,
    `${meta.replace(" M", " R100")}\0a\0b\0`, `:100644 100644 ${"a".repeat(7)} ${"b".repeat(7)} M\0a\0`, `${meta}\0a\0:unfinished\0`]) {
    assert.equal(parseRawDiff(raw), null, String(raw));
  }
});

test("F-05: a conflicted merge or rebase runs everything, a detached HEAD is judged correctly, no commit is unknown", () => {
  for (const operation of ["merge", "rebase"]) {
    withFixture((f) => {
      f.git("checkout", "-q", "-b", "other");
      f.put("docs/TESTING.md", "theirs\n");
      f.commit();
      f.git("checkout", "-q", "feature");
      f.put("docs/TESTING.md", "ours\n");
      f.commit();
      const result = spawnSync("git", [operation, "other"], { cwd: f.root, env: gitEnv, encoding: "utf8" });
      assert.notEqual(result.status, 0);
      assert.equal(f.decide({ lines: `HEAD ${f.head()} refs/heads/feature ${zero}\n` }).mode, "full", operation);
    });
  }
  withFixture((f) => {
    toolChange(f);
    f.git("checkout", "-q", "--detach");
    assert.equal(f.decide({ lines: `HEAD ${f.head()} refs/heads/feature ${zero}\n` }).mode, "tooling");
  });
  const empty = mkdtempSync(join(tmpdir(), "dan361-empty-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: empty, env: gitEnv });
    assert.equal(changedAgainstMain(empty, gitEnv), null);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("F-06: a hook's GIT_DIR, GIT_WORK_TREE or GIT_INDEX_FILE never redirects the check", () => withFixture((f) => {
  toolChange(f);
  const clean = changedAgainstMain(f.root, gitEnv);
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "git_dir"]) {
    assert.deepEqual(changedAgainstMain(f.root, { ...gitEnv, [name]: join(f.root, "elsewhere") }), clean, name);
  }
}));

test("G-01, G-02: no net change runs everything", () => {
  withFixture((f) => assert.equal(f.decide().mode, "full"));
  withFixture((f) => { f.git("commit", "-q", "--allow-empty", "-m", "empty"); assert.equal(f.decide().mode, "full"); });
  withFixture((f) => {
    f.put("src/a.ts", "export const x = 2;\n");
    f.commit();
    f.git("revert", "--no-edit", "HEAD");
    assert.equal(f.decide().mode, "full");
  });
});

test("G-03, J-06: a missing or doubtful inventory runs everything, and a complete one runs all three phases", () => {
  withFixture((f) => {
    f.put("README.md", "# Changed synthetic docs\n");
    f.commit();
    assert.equal(f.decide().calls.length, 3);
  });
  for (const missing of ["scripts/orchestrator/b.test.mjs", "scripts/engineering/a.test.mjs", "tests/property", "src", "tests/unit/vitest-workers.test.ts"]) {
    withFixture((f) => {
      f.git("rm", "-rq", missing);
      f.git("commit", "-qm", "inventory hole");
      f.git("update-ref", "refs/remotes/origin/main", "HEAD");
      f.put("README.md", "# Changed synthetic docs\n");
      f.commit();
      assert.equal(f.decide().mode, "full", missing);
    });
  }
  // Ignored names: the working tree is clean, so only the inventory can see them.
  for (const name of ["scripts/engineering/a&b.test.mjs", "tests/unit/a b.test.ts"]) {
    withFixture((f) => {
      f.put("README.md", "# Changed synthetic docs\n");
      f.commit();
      f.put(name, 'import "node:fs";\n');
      writeFileSync(join(f.root, ".git", "info-exclude"), `${name.split("/").pop()}\n`);
      f.git("config", "core.excludesFile", join(f.root, ".git", "info-exclude"));
      assert.equal(f.decide().mode, "full", name);
    });
  }
});

test("G-04, K-03, K-04: only the --changed phase may select nothing, and script tests are a fixed list", () => withFixture((f) => {
  toolChange(f);
  const { calls } = f.decide();
  assert.equal(calls[0][0], process.execPath);
  assert.deepEqual(calls[0][1], ["--test", "scripts/engineering/a.test.mjs", "scripts/orchestrator/b.test.mjs"]);
  assert.ok(!calls[0][1].join(" ").includes("*"));
  assert.ok(calls[1][1].includes("--changed"));
  assert.ok(calls[1][1].includes("--passWithNoTests"));
  assert.ok(!calls[2][1].includes("--passWithNoTests"));
  for (const file of ["tests/unit/codeowners.test.ts", "tests/unit/pr-metadata-precheck.test.ts", "tests/unit/dynamic.test.ts", "tests/unit/disk.test.ts"]) assert.ok(calls[2][1].includes(file), file);
}));

test("K-03: a reader list too long for cmd.exe runs everything on Windows only", () => {
  const files = {};
  for (let i = 0; i < 200; i += 1) files[`tests/unit/a-rather-long-synthetic-file-name-to-fill-the-command-line-${i}.test.ts`] = 'import "node:fs";\n';
  withFixture((f) => {
    toolChange(f);
    assert.equal(f.decide({ platform: "win32" }).mode, "full");
    assert.equal(f.decide({ platform: "linux" }).mode, "tooling");
  }, { files });
});

test("H-01 to H-03: only a real, single remote-tracking base counts", () => {
  withFixture((f) => {
    toolChange(f);
    f.git("update-ref", "-d", "refs/remotes/origin/main");
    assert.equal(changedAgainstMain(f.root, gitEnv), null, "no origin/main");
    assert.equal(f.decide().mode, "full");
    f.git("update-ref", "refs/remotes/upstream/main", "main");
    assert.equal(f.decide().mode, "full", "another remote name");
    f.git("update-ref", "refs/heads/origin/main", "HEAD");
    f.git("update-ref", "refs/tags/origin/main", "HEAD");
    assert.equal(f.decide().mode, "full", "a branch or tag of that name is no base");
  });
  withFixture((f) => {
    f.put("src/a.ts", "export const x = 9;\n");
    f.commit();
    f.git("update-ref", "refs/heads/origin/main", "HEAD");
    f.git("update-ref", "refs/tags/origin/main", "HEAD");
    assert.equal(changedAgainstMain(f.root, gitEnv).files[0].file, "src/a.ts", "the real ref wins over both");
  });
  withFixture((f) => {
    toolChange(f);
    const shallow = mkdtempSync(join(tmpdir(), "dan361-shallow-"));
    try {
      execFileSync("git", ["clone", "-q", "--depth=1", "--no-single-branch", "--branch", "feature", `file://${f.root.replaceAll("\\", "/")}`, "."], { cwd: shallow, env: gitEnv, stdio: "pipe" });
      assert.equal(changedAgainstMain(shallow, gitEnv), null, "no merge base in a shallow clone");
    } finally {
      rmSync(shallow, { recursive: true, force: true });
    }
  });
});

test("H-03: more than one merge base runs everything", () => withFixture((f) => {
  f.git("checkout", "-q", "-b", "side", "main");
  f.put("docs/TESTING.md", "side\n");
  f.commit();
  f.git("checkout", "-q", "main");
  f.put("docs/PROGRAM.md", "main\n");
  f.commit();
  f.git("checkout", "-q", "feature");
  f.git("merge", "-q", "--no-edit", "main");
  f.git("merge", "-q", "--no-edit", "side");
  f.git("checkout", "-q", "main");
  f.git("merge", "-q", "--no-edit", "side");
  f.git("update-ref", "refs/remotes/origin/main", "main");
  f.git("checkout", "-q", "feature");
  assert.equal(f.git("merge-base", "--all", "HEAD", "refs/remotes/origin/main").trim().split("\n").length, 2);
  assert.equal(changedAgainstMain(f.root, gitEnv), null);
}));

test("H-06: the pre-push lines must prove one branch update of HEAD", () => {
  const head = "a".repeat(40);
  const other = "b".repeat(40);
  assert.ok(pushesOnlyHead(`refs/heads/x ${head} refs/heads/x ${other}\n`, head));
  assert.ok(pushesOnlyHead(`HEAD ${head} refs/heads/x ${zero}\r\n`, head));
  for (const lines of [null, undefined, "", "\n", `refs/heads/y ${other} refs/heads/y ${zero}\n`, `refs/heads/x ${head} refs/heads/x ${zero}\nrefs/heads/y ${other} refs/heads/y ${zero}\n`,
    `(delete) ${zero} refs/heads/x ${head}\n`, `refs/tags/v1 ${head} refs/tags/v1 ${zero}\n`, `refs/heads/x ${head} refs/tags/x ${zero}\n`, `refs/heads/x ${head} refs/heads/x\n`, `refs/heads/x ${head} refs/heads/x ${zero} extra\n`, "garbage\n"]) {
    assert.equal(pushesOnlyHead(lines, head), false, String(lines));
  }
  assert.equal(pushesOnlyHead(`refs/heads/x ${head} refs/heads/x ${zero}\n`, null), false);
  withFixture((f) => {
    toolChange(f);
    assert.equal(f.decide().mode, "tooling");
    const sha = f.head();
    f.git("branch", "other", "main");
    const otherSha = f.git("rev-parse", "other").trim();
    for (const lines of ["", null, () => { throw new Error("EOF"); }, `refs/heads/other ${otherSha} refs/heads/other ${zero}\n`, `refs/heads/feature ${sha} refs/heads/feature ${zero}\nrefs/heads/other ${otherSha} refs/heads/other ${zero}\n`,
      `(delete) ${zero} refs/heads/feature ${sha}\n`, `refs/tags/v1 ${sha} refs/tags/v1 ${zero}\n`]) {
      assert.equal(f.decide({ lines }).mode, "full", String(lines));
    }
  });
});

test("H-07: a working tree that differs from HEAD runs everything", () => {
  withFixture((f) => { toolChange(f); f.put("src/a.ts", "export const x = 5;\n"); assert.equal(f.decide().mode, "full"); });
  withFixture((f) => { toolChange(f); f.put("scripts/engineering/novi.test.mjs", "// untracked\n"); assert.equal(f.decide().mode, "full"); });
  withFixture((f) => { toolChange(f); f.put("src/a.ts", "export const x = 5;\n"); f.git("add", "src/a.ts"); assert.equal(f.decide().mode, "full"); });
});

test("I-04, I-05, J-03: every way to reach a file makes a test a reader of the tooling run", () => {
  const forms = {
    template: "await import(`node:fs`);", computed: "const name = 'x'; await import(name);", createrequire: 'import { createRequire } from "node:module";',
    require: "const load = require; load('x'); require(name);", worker: 'import { Worker } from "worker_threads";', workerNew: "new Worker(url);",
    readurl: 'import { readFileSync } from "fs"; readFileSync(new URL("../../scripts/x", import.meta.url));', star: 'import * as fs from "fs";',
    spawn: 'import { spawn } from "child_process"; spawn("node", ["scripts/engineering/x.mjs"]);', execa: 'import { execa } from "execa";', tinyexec: 'import { x } from "tinyexec";',
    glob: 'import { glob } from "glob";', globby: 'import { globby } from "globby";', fastglob: 'import fg from "fast-glob";', tinyglobby: 'import { glob } from "tinyglobby";',
    metaglob: 'const docs = import.meta.glob("../../docs/*.md");', raw: 'import text from "../../docs/TESTING.md?raw";', url: 'import where from "../../docs/TESTING.md?url";',
    builtin: 'process.getBuiltinModule("fs");', viComputed: "vi.mock(path);", viActual: "await vi.importActual(path);", readdir: 'import { readdirSync } from "node:fs"; readdirSync("docs");',
    invalid: "\uFFFD",
  };
  const files = {
    "tests/unit/plain.test.ts": 'import { it } from "vitest";\nimport { x } from "@/a";\n',
    "tests/unit/vi-pure.test.ts": 'import { vi } from "vitest";\nvi.mock("./pure-helper");\nvi.importActual("./pure-helper");\n',
    "tests/unit/pure-helper.ts": "export const pure = 1;\n",
    "tests/unit/vi-reads.test.ts": 'import { vi } from "vitest";\nvi.mock("./reads-helper");\n',
    "tests/unit/vi-typed.test.ts": 'import { vi } from "vitest";\nawait vi.importActual<Module>("./reads-helper");\n',
    "tests/unit/reads-helper.ts": 'import "node:fs";\n',
  };
  for (const [name, source] of Object.entries(forms)) files[`tests/unit/form-${name}.test.ts`] = `${source}\n`;
  withFixture((f) => {
    const found = fileReadingTests(f.root, undefined, undefined, true);
    for (const name of Object.keys(forms)) assert.ok(found.includes(`tests/unit/form-${name}.test.ts`), name);
    assert.ok(found.includes("tests/unit/vi-reads.test.ts"));
    assert.ok(found.includes("tests/unit/vi-typed.test.ts"));
    assert.ok(!found.includes("tests/unit/plain.test.ts"));
    assert.ok(!found.includes("tests/unit/vi-pure.test.ts"));
    // I-04: a test that starts reading a listed document joins with no list to update.
    f.put("tests/unit/new-reader.test.ts", 'import { readFileSync } from "node:fs";\nreadFileSync("docs/UX-EVAL.md");\n');
    assert.ok(fileReadingTests(f.root, undefined, undefined, true).includes("tests/unit/new-reader.test.ts"));
  }, { files });
});

test("J-05: an unreadable or invalid file counts as reading files, a directory that cannot be listed stops the inventory", () => withFixture((f) => {
  writeFileSync(join(f.root, "tests/unit/bad-utf8.test.ts"), Buffer.from([0xff, 0xfe, 0x00]));
  f.put("tests/unit/locked.test.ts", 'import "./locked";\n');
  f.put("tests/unit/locked.ts", "");
  const read = (file) => { if (file.endsWith("locked.ts")) throw new Error("EACCES"); return readFileSync(file, "utf8"); };
  const found = fileReadingTests(f.root, read, undefined, true);
  assert.ok(found.includes("tests/unit/bad-utf8.test.ts"));
  assert.ok(found.includes("tests/unit/locked.test.ts"));
  rmSync(join(f.root, "tests/property"), { recursive: true });
  assert.throws(() => fileReadingTests(f.root, undefined, undefined, true));
}));

// The readers of the listed documents and scripts in this repository today.
const knownConsumers = ["tests/unit/codeowners.test.ts", "tests/unit/pr-metadata-precheck.test.ts", "tests/unit/skill-copies.test.ts", "tests/unit/session-guc-scope.test.ts",
  "tests/unit/vitest-workers.test.ts", "src/domain/forensics/submission-receipt.test.ts", "src/domain/forensics/evidence-receipt-v2.test.ts"];

test("I-01 to I-03, J-01, J-02: the real inventory holds the known consumers of listed files", () => {
  const found = fileReadingTests(repository.replace(/[/\\]$/, ""), undefined, undefined, true);
  for (const file of knownConsumers) assert.ok(found.includes(file), file);
  // A consumer named in the code must stay a real file.
  const selector = readFileSync(new URL("./pre-push-tests.mjs", import.meta.url), "utf8");
  for (const [file] of selector.matchAll(/tests\/(?:unit|property)\/[\w.-]+\.test\.ts/g)) assert.ok(existsSync(join(repository, file)), file);
  assert.ok(existsSync(join(repository, "tests/property/forbidden-terms.property.test.ts")));
});

test("I-01: every script test, which is what reads the governance documents, is in the listing", () => {
  const onDisk = readdirSync(new URL("./", import.meta.url)).filter((name) => name.endsWith(".test.mjs"));
  for (const name of ["doc-summaries.test.mjs", "role-cards.test.mjs", "risk-floor.test.mjs", "review-gate-qa-exemption.test.mjs", "ci-docs-scope.test.mjs"]) assert.ok(onDisk.includes(name), name);
  assert.ok(readdirSync(new URL("../orchestrator/", import.meta.url)).includes("orchestrator-core.test.mjs"));
});

const importsOf = new Map();
function closure(start) {
  const seen = new Set([start]);
  const queue = [start];
  const isPlainFile = (rel) => { try { return statSync(join(repository, rel)).isFile(); } catch { return false; } };
  while (queue.length) {
    const file = queue.shift();
    if (!importsOf.has(file)) importsOf.set(file, localImports(file, readFileSync(join(repository, file), "utf8"), isPlainFile));
    for (const dep of importsOf.get(file)) {
      if (!seen.has(dep)) { seen.add(dep); queue.push(dep); }
    }
  }
  return seen;
}

function testFilesUnder(dir, name = /\.test\.mjs$/) {
  const out = [];
  for (const entry of readdirSync(join(repository, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...testFilesUnder(rel, name));
    else if (name.test(rel)) out.push(rel);
  }
  return out;
}

test("A-10, I-07: every test that reaches a rule document is in the set those documents select", () => {
  const { readers, scriptTests } = toolingInventory(repository.replace(/[/\\]$/, ""));
  const selected = new Set([...readers, ...scriptTests]);
  for (const file of ["doc-summaries", "role-cards", "risk-floor", "review-gate-qa-exemption", "ci-docs-scope", "safety-rules", "agent-hooks"]) {
    assert.ok(selected.has(`scripts/engineering/${file}.test.mjs`), file);
  }
  for (const file of ["preflight", "orchestrator-core"]) assert.ok(selected.has(`scripts/orchestrator/${file}.test.mjs`), file);
  for (const file of ["tests/unit/codeowners.test.ts", "tests/unit/pr-metadata-precheck.test.ts", "tests/unit/skill-copies.test.ts"]) assert.ok(selected.has(file), file);
  // Whatever names a rule document in code, in the test or in what it imports,
  // is selected; three sync tests cite STATE.md in comments only, and stay out.
  const names = RULE_DOCS.map((doc) => doc.split("/").pop());
  const namesInCode = (file) => readFileSync(join(repository, file), "utf8").split("\n")
    .some((line) => !/^\s*(?:\/\/|\/?\*)/.test(line) && names.some((name) => line.includes(name)));
  const vitest = ["src", "tests/unit", "tests/property"].flatMap((dir) => testFilesUnder(dir, /\.test\.tsx?$/));
  assert.ok(vitest.length > 100, "the walk found the vitest tests");
  const missed = vitest.filter((file) => !selected.has(file) && [...closure(file)].some(namesInCode));
  assert.deepEqual(missed, []);
});

test("J-04, L-02: no node test outside the two tool directories touches a listed path", () => {
  const packageScripts = JSON.parse(readFileSync(join(repository, "package.json"), "utf8")).scripts;
  const named = `${packageScripts["test:demo"]} ${packageScripts["test:fake-oidc"]}`.match(/\S+\.test\.mjs/g);
  assert.ok(named.length >= 7, "test:demo and test:fake-oidc are still the skipped steps");
  const outside = [...new Set([...named, ...testFilesUnder("scripts").filter((file) => !/^scripts\/(?:engineering|orchestrator)\/[^/]+$/.test(file)), ...testFilesUnder("db"), ...testFilesUnder("infra")])];
  const toolPaths = [/scripts\/(?:engineering|orchestrator)\//, /\.\.\/(?:engineering|orchestrator)\//];
  // A listed document as a whole path: a quote or a slash before it, a quote after it.
  const docMentions = [...TOOLING_DOCS].flatMap((doc) => [..."\"'`/"].flatMap((before) => [..."\"'`"].map((after) => `${before}${doc}${after}`)));
  for (const test of outside) {
    for (const file of closure(test)) {
      assert.ok(!/^scripts\/(?:engineering|orchestrator)\//.test(file), `${test} imports ${file}`);
      const source = readFileSync(join(repository, file), "utf8");
      for (const pattern of toolPaths) assert.doesNotMatch(source, pattern, `${file} (${test})`);
      for (const mention of docMentions) assert.ok(!source.includes(mention), `${file} (${test}) names ${mention}`);
    }
  }
});

// Documents CI still treats as "full" that the local run accepts. Each one's
// readers run here; CI runs everything regardless (orchestrator, #87 c.6523882827).
const LOCAL_ONLY_DOCS = new Set([
  "docs/ARCHITECTURE.md", "docs/BACKEND.md", "docs/DEMO-SUHI-PROLAZ.md", "docs/DEMO-TEACHER-BOOTSTRAP.md", "docs/DEMO-UP.md", "docs/FEATURES.md", "docs/FUNCTIONAL_ARCHITECTURE_V1.md",
  "docs/PLAN-DEMO.md", "docs/PRODUCT.md", "docs/PRODUCT_SPEC_V1.md", "docs/PROGRAM.md", "docs/REPOZITORIJI.md", "docs/SECURITY.md", "docs/TESTING.md", ...RULE_DOCS,
]);

test("L-01: a document CI runs in full is on the local list only by a written decision", async () => {
  const { classifyDiff } = await import("./ci-docs-scope.mjs");
  const record = (path) => `:100644 100644 ${"a".repeat(40)} ${"b".repeat(40)} M\0${path}\0`;
  for (const doc of TOOLING_DOCS) {
    assert.equal(classifyDiff(record(doc)) === "docs", !LOCAL_ONLY_DOCS.has(doc), doc);
  }
  assert.doesNotMatch(readFileSync(new URL("./pre-push-tests.mjs", import.meta.url), "utf8"), /from "\.\/ci-docs-scope/);
});

test("L-03: the scoped run stays as it was: no stdin, no stricter reading, a mode change still scoped", () => {
  const files = { "tests/unit/computed.test.ts": "await import(name);\n" };
  withFixture((f) => {
    f.put("src/a.ts", "export const x = 2;\n");
    f.commit();
    const lines = () => { throw new Error("a scoped run must not read stdin"); };
    const { mode, calls, code } = f.decide({ lines });
    assert.equal(code, 0);
    assert.equal(mode, "scoped");
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0][1].slice(-5), ["--project", "unit", "--project", "property", "--changed"].slice(-4).concat(calls[0][1].slice(-1)));
    assert.ok(!calls[0][1].includes("--passWithNoTests"));
    assert.ok(!calls[1][1].includes("tests/unit/computed.test.ts"));
    assert.ok(calls[1][1].includes("tests/unit/disk.test.ts"));
    f.put("src/a.ts", "export const x = 3;\n");
    assert.equal(f.decide({ lines }).mode, "scoped", "the working tree does not matter to it");
    f.git("checkout", "--", "src/a.ts");
    f.git("update-ref", "refs/remotes/origin/main", "HEAD");
    f.git("update-index", "--chmod=+x", "src/a.ts");
    f.git("commit", "-qm", "executable");
    assert.equal(f.judged(), "scoped");
  }, { files });
});

test("K-01, K-02: a failure in any phase, a signal or a command that cannot start is a failed push", () => withFixture((f) => {
  toolChange(f);
  for (const failedAt of [0, 1, 2]) {
    let count = 0;
    assert.equal(f.decide({ execute: () => ({ status: count++ === failedAt ? 7 : 0 }) }).code, 7);
    assert.equal(count, failedAt + 1);
  }
  assert.equal(f.decide({ execute: () => ({ status: null, signal: "SIGTERM" }) }).code, 1);
  assert.equal(f.decide({ execute: () => ({ status: null, error: new Error("ENOENT") }) }).code, 1);
}));

test("K-05: only DUCTUS_PREPUSH_FULL=1 forces the full run", () => withFixture((f) => {
  toolChange(f);
  assert.equal(f.decide({ env: { ...gitEnv, DUCTUS_PREPUSH_FULL: "1" } }).mode, "full");
  for (const value of ["true", "0", " 1", ""]) assert.equal(f.decide({ env: { ...gitEnv, DUCTUS_PREPUSH_FULL: value } }).mode, "tooling", JSON.stringify(value));
}));

test("K-06, L-04: lint and typecheck stay, and only the test command takes the pushed refs", () => {
  const hooks = readFileSync(new URL("../../lefthook.yml", import.meta.url), "utf8");
  const prePush = hooks.slice(hooks.indexOf("\npre-push:"));
  for (const command of ["run: pnpm lint", "run: pnpm typecheck", "run: node scripts/engineering/pre-push-tests.mjs"]) assert.ok(prePush.includes(command), command);
  assert.ok(hooks.includes("gitleaks stdin"));
  assert.equal(hooks.match(/use_stdin/g).length, 1);
  assert.match(prePush, /\n {4}test:\n {6}use_stdin: true\n/);
});

test("K-07: the decision line names the run, the reason and at most five files", () => {
  assert.deepEqual(describe(explain([change("docs/TESTING.md")])), ["pre-push: tooling run: only allowlisted scripts or documents; script tests and readers retained."]);
  withFixture((f) => {
    toolChange(f);
    const printed = [];
    const log = console.log;
    console.log = (line) => printed.push(line);
    try { f.decide(); } finally { console.log = log; }
    assert.match(printed.join("\n"), /tooling run/);
    assert.match(printed.join("\n"), /CI runs everything/);
  });
});

test("L-04: the selector itself, started as the hook starts it, picks each run from stdin", () => {
  const shim = mkdtempSync(join(tmpdir(), "dan361-shim-"));
  try {
    const log = join(shim, "calls.log");
    writeFileSync(join(shim, "pnpm.cmd"), `@echo %* >> "${log}"\r\n`);
    writeFileSync(join(shim, "pnpm"), `#!/bin/sh\necho "$@" >> "${log}"\n`);
    chmodSync(join(shim, "pnpm"), 0o755);
    const pathKey = Object.keys(gitEnv).find((name) => /^path$/i.test(name));
    const env = { ...gitEnv, [pathKey]: `${shim}${delimiter}${gitEnv[pathKey]}` };
    delete env.NODE_TEST_CONTEXT;
    const hook = (f, input) => {
      rmSync(log, { force: true });
      const result = spawnSync(process.execPath, ["scripts/engineering/pre-push-tests.mjs"], { cwd: f.root, env, input, encoding: "utf8" });
      return { ...result, calls: existsSync(log) ? readFileSync(log, "utf8").trim() : "" };
    };
    const selector = readFileSync(new URL("./pre-push-tests.mjs", import.meta.url), "utf8");
    withFixture((f) => {
      f.put("docs/TESTING.md", "x\n");
      f.commit();
      const tooling = hook(f, f.pushLine());
      assert.equal(tooling.status, 0, tooling.stdout + tooling.stderr);
      assert.match(tooling.stdout, /pre-push: tooling run/);
      assert.match(tooling.calls, /--passWithNoTests/);
      const empty = hook(f, "");
      assert.match(empty.stdout, /pre-push: full test run \(pnpm test\): the pushed ref is unknown or is not HEAD/);
      assert.equal(empty.calls, "test");
      f.put("src/a.ts", "export const x = 2;\n");
      f.commit();
      const mixed = hook(f, f.pushLine());
      assert.match(mixed.stdout, /pre-push: full test run/);
      f.git("update-ref", "refs/remotes/origin/main", "HEAD~1");
      const scoped = hook(f, "");
      assert.match(scoped.stdout, /pre-push: scoped run/);
    }, { files: { "scripts/engineering/pre-push-tests.mjs": selector } });
  } finally {
    rmSync(shim, { recursive: true, force: true });
  }
});
