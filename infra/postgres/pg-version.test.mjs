// DAN-711: the pgTAP install must not upgrade PostgreSQL past the base image.
// Classes are listed in the contract on #1836 (c.6851028802).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, "assert-pg-version.sh");
const dockerfile = readFileSync(resolve(here, "Dockerfile"), "utf8");
const image = "17.11-1.pgdg13+2";

const run = (args) => spawnSync("sh", [script, ...args], { encoding: "utf8" });

const cases = [
  ["(1) server and client equal the image", [image, image, image], 0],
  ["(2) server pulled to 17.12", [image, "17.12-1.pgdg13+1", image], 1],
  ["(3) client differs", [image, image, "17.12-1.pgdg13+1"], 1],
  ["(4) PG_VERSION unset", ["", image, image], 1],
  ["(5) package not installed", [image, image, ""], 1],
  ["(6) no installed version given", [image], 1],
  ["(7) same prefix only", [image, `${image}0`, image], 1],
  ["(8a) trailing newline", [image, `${image}\n`, image], 1],
  ["(8b) leading space", [image, ` ${image}`, image], 1],
];

for (const [name, args, status] of cases) {
  test(`assert-pg-version: ${name}`, () => {
    const result = run(args);
    if (status === 0) assert.equal(result.status, 0, result.stderr);
    else {
      assert.notEqual(result.status, 0, `must fail: ${JSON.stringify(args)}`);
      assert.match(
        result.stderr,
        /PostgreSQL version drift|PG_VERSION|no installed/,
      );
    }
  });
}

/** True when the Dockerfile's install step pins server and client to the image and runs the check. */
function pinsImageVersion(text) {
  const runs = text
    .replace(/\\\n/g, " ")
    .split("\n")
    .filter((line) => /^RUN\s/.test(line));
  const install = runs.find((line) => line.includes("apt-get install")) ?? "";
  return (
    install.includes('"postgresql-17=${PG_VERSION}"') &&
    install.includes('"postgresql-client-17=${PG_VERSION}"') &&
    /assert-pg-version\.sh "\$PG_VERSION"/.test(install)
  );
}

const variants = [
  ["the real Dockerfile", dockerfile, true],
  [
    "server not pinned",
    dockerfile.replace('"postgresql-17=${PG_VERSION}"', "postgresql-17"),
    false,
  ],
  [
    "client not pinned",
    dockerfile.replace(
      '"postgresql-client-17=${PG_VERSION}"',
      "postgresql-client-17",
    ),
    false,
  ],
  [
    "check not run",
    dockerfile.replace(/assert-pg-version\.sh "\$PG_VERSION"/, "true"),
    false,
  ],
  [
    "old unpinned install",
    "RUN apt-get install -y postgresql-17-pgtap\n",
    false,
  ],
];

for (const [name, text, expected] of variants) {
  test(`Dockerfile pin: ${name}`, () => {
    if (expected) assert.notEqual(text, "", "Dockerfile must exist");
    else
      assert.notEqual(
        text,
        dockerfile,
        "variant must differ from the real file",
      );
    assert.equal(pinsImageVersion(text), expected);
  });
}
