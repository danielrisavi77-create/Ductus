import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

// DAN-517 (attack plan #1826, W-3 and W-4): the fence ends a real node
// process. Each case is a child that arms the fence and then behaves as one
// class of attempt; what is compared is how the child ended and what it wrote.
const work = mkdtempSync(path.join(tmpdir(), "ductus-fence-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const fenceModule = pathToFileURL(path.resolve(__dirname, "attempt-fence.ts")).href;
let scripts = 0;

type Ending = { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; elapsed: number };

async function run(body: string): Promise<Ending> {
  scripts += 1;
  const file = path.join(work, `case-${scripts}.mjs`);
  writeFileSync(
    file,
    `import { startAttemptFence } from ${JSON.stringify(fenceModule)};
const fence = startAttemptFence();
const later = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
${body}
`,
  );
  const started = Date.now();
  const child = spawn(process.execPath, [file], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  return new Promise((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr, elapsed: Date.now() - started }));
  });
}

const killed = { code: null, signal: "SIGKILL", stdout: "armed\n", stderr: "" };
const survived = (stdout: string): object => ({ code: 0, signal: null, stdout, stderr: "" });

describe("attempt fence: an attempt still armed at its time ends the process", () => {
  it.each<[string, string]>([
    ["blocks the thread", `fence.arm(300); console.log("armed"); for (;;) {}`],
    ["waits on something that never settles", `fence.arm(300); console.log("armed"); setInterval(() => {}, 1000); await new Promise(() => {});`],
    ["finishes after its time", `fence.arm(300); console.log("armed"); await later(3000); console.log("late");`],
    ["was armed beside one that was released", `const release = fence.arm(60000); fence.arm(300); release(); console.log("armed"); await later(3000); console.log("late");`],
    ["was armed before a later one", `fence.arm(300); fence.arm(60000); console.log("armed"); await later(3000); console.log("late");`],
    ["is still running when the fence is closed", `fence.arm(300); await fence.close(); console.log("armed"); await later(3000); console.log("late");`],
    ["was released twice by another attempt", `const release = fence.arm(200); fence.arm(300); release(); release(); console.log("armed"); await later(3000); console.log("late");`],
  ])("an attempt that %s is killed, and writes nothing after it", async (_label, body) => {
    const ending = await run(body);
    expect(ending).toMatchObject(killed);
    expect(ending.elapsed).toBeGreaterThanOrEqual(300);
    expect(ending.elapsed).toBeLessThan(3000);
  });

  it.each<[string, string, string]>([
    ["is released before its time", `const release = fence.arm(300); release(); await later(700); console.log("done"); await fence.close();`, "done\n"],
    ["is the later of two, after the earlier one was released", `const first = fence.arm(300); const second = fence.arm(60000); first(); await later(700); second(); console.log("done"); await fence.close();`, "done\n"],
    ["is released after the fence was closed", `const release = fence.arm(300); await fence.close(); release(); await later(700); console.log("done");`, "done\n"],
    ["never armed the fence", `await later(50); console.log("done");`, "done\n"],
  ])("a process whose attempt %s lives on and exits 0", async (_label, body, stdout) => {
    expect(await run(body)).toMatchObject(survived(stdout));
  });

  it("an idle fence does not keep the process alive", async () => {
    const ending = await run(`console.log("done");`);
    expect(ending).toMatchObject(survived("done\n"));
    expect(ending.elapsed).toBeLessThan(3000);
  });

  it.each<[string, string]>([
    ["zero", "0"],
    ["a negative time", "-5"],
    ["a fraction", "0.5"],
    ["not a number", "Number.NaN"],
    ["infinity", "Number.POSITIVE_INFINITY"],
    ["a string", `"300"`],
  ])("refuses to arm for %s", async (_label, value) => {
    const ending = await run(`try { fence.arm(${value}); console.log("armed"); } catch (error) { console.log(error.message); } await later(600); console.log("alive");`);
    expect(ending).toMatchObject(survived("fence_refused\nalive\n"));
  });

  it("refuses to arm once closed, so no attempt runs unfenced", async () => {
    const ending = await run(`await fence.close(); try { fence.arm(300); console.log("armed"); } catch (error) { console.log(error.message); }`);
    expect(ending).toMatchObject(survived("fence_refused\n"));
  });
});
