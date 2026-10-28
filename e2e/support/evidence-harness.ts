/**
 * Node side of the evidence journal suite (F-8 3d-2b, QA points 12-20):
 * bundles the harness entry once per run, serves it, and answers
 * `/api/evidence/commit` as the server would as far as the client can tell:
 * a compare-and-set on the revision, one stored commit per key (a replay is
 * `duplicate`) and a receipt v2 over the hash of the received segment, signed
 * with an Ed25519 key made for the run. Everything is fulfilled by
 * `context.route`, so no route of the application is reached and nothing is
 * added to the production build. Every key, id and text is invented.
 */

import { createHash, generateKeyPairSync, randomBytes, sign as nodeSign } from "node:crypto";
import { mkdir, readFile, rename, rmdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { BrowserContext, Page, Route } from "@playwright/test";

import type { EvidenceReceiptPayloadV2, SignedEvidenceReceiptV2 } from "../../src/domain/forensics/evidence-receipt";
import type { EvidenceDomainKey } from "../../src/domain/forensics/evidence-receipt-verifier";
import { loadGoldenVectors } from "../../src/domain/forensics/golden-vectors/load";
import { canonicalizeJcs } from "../../src/domain/forensics/jcs";
import type { HarnessConfig } from "./evidence-harness.entry";

type Bundler = {
  build(config: object): Promise<{ output: { code?: string }[] } | { output: { code?: string }[] }[]>;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
export const HARNESS_URL = "http://localhost:3000/__evidence-harness";
const COMMIT_URL = "http://localhost:3000/api/evidence/commit";

const BASE = loadGoldenVectors().receiptV2.accepted[0]!.payload;
export const DOC = BASE.documentId;
export const R0 = 4;

const PAGE = `<!doctype html>
<html lang="hr">
<head>
<meta charset="utf-8">
<title>Evidencija u pregledniku</title>
<style>
  body { font: 16px/1.5 sans-serif; margin: 16px; }
  #editor .ProseMirror { min-height: 160px; padding: 8px; outline: 1px solid #767676; white-space: pre-wrap; }
  #editor p { margin: 0 0 12px; }
</style>
</head>
<body>
<div id="editor"></div>
<script src="/__evidence-harness.js"></script>
</body>
</html>`;

let bundle: Promise<string> | undefined;

async function buildBundle(): Promise<string> {
  const fromHere = createRequire(import.meta.url);
  const fromVitest = createRequire(fromHere.resolve("vitest/package.json"));
  const vite = (await import(pathToFileURL(fromVitest.resolve("vite")).href)) as Bundler;
  const result = await vite.build({
    configFile: false,
    logLevel: "silent",
    root,
    resolve: { alias: { "@": path.join(root, "src") } },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      write: false,
      minify: false,
      lib: { entry: path.join(here, "evidence-harness.entry.ts"), formats: ["iife"], name: "EvidenceHarness" },
    },
  });
  const code = (Array.isArray(result) ? result[0] : result).output[0]?.code;
  if (!code) throw new Error("evidence harness: the bundle is empty");
  return code;
}

/**
 * Makes the bundle available to this worker; called from `beforeAll` with a
 * generous timeout. The first worker builds it under the run's output
 * directory, the others read it.
 */
export function prepareEvidenceHarness(outputDir: string): Promise<string> {
  bundle ??= (async () => {
    const directory = path.join(outputDir, ".evidence-harness");
    const file = path.join(directory, `bundle-${process.ppid}.js`);
    await mkdir(directory, { recursive: true });
    return withLock(path.join(directory, "build.lock"), 120_000, async () => {
      const ready = await readFile(file, "utf8").catch(() => null);
      if (ready) return ready;
      const code = await buildBundle();
      await writeFile(`${file}.${process.pid}`, code);
      await rename(`${file}.${process.pid}`, file);
      return code;
    });
  })();
  return bundle;
}

/** A lock shared by the worker processes: a directory only one of them can create. */
async function withLock<T>(lock: string, staleMs: number, run: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      // Windows answers EPERM or EBUSY while another worker is still removing the directory.
      if (!["EEXIST", "EPERM", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      const held = await stat(lock).catch(() => null);
      if (held && Date.now() - held.mtimeMs > staleMs) {
        await rmdir(lock).catch(() => undefined);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }
  try {
    return await run();
  } finally {
    await rmdir(lock).catch(() => undefined);
  }
}

export type CommitBody = {
  documentId: string;
  clientTransactionId: string;
  baseRevision: number;
  segments: string[];
  document: string;
};

/**
 * How the server answers the next request. `hang` never answers; `abort`
 * fails the request as a lost connection; `chain_conflict` is another device
 * having moved the chain; `tamper` is a receipt with one changed signature byte.
 */
export type Answer = "accept" | "hang" | "abort" | "chain_conflict" | "tamper";

export function receiptKey(keyId: string) {
  const pair = generateKeyPairSync("ed25519");
  const key: EvidenceDomainKey = {
    algorithm: "Ed25519", keyId, keyVersion: "1", encoding: "spki-der",
    keyBase64Url: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
    evidenceDomainId: BASE.evidenceDomainId, purpose: "receipt",
    validFrom: "2026-01-01T00:00:00.000Z", validTo: null, revokedAt: null,
  };
  const sign = (over: Partial<EvidenceReceiptPayloadV2>): SignedEvidenceReceiptV2 => {
    const payload = { ...BASE, ...over };
    const digest = createHash("sha256").update(canonicalizeJcs(payload), "utf8").digest();
    const input = Buffer.concat([Buffer.from("ductus-evidence-receipt-v2\n"), digest]);
    return {
      payload,
      payloadDigestSha256: digest.toString("hex"),
      signature: {
        algorithm: "Ed25519", keyId, keyVersion: "1", signatureEncoding: "raw",
        signatureBase64Url: nodeSign(null, input, pair.privateKey).toString("base64url"),
      },
    };
  };
  return { key, sign };
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export class EvidenceServer {
  readonly calls: { key: string; text: string; body: CommitBody }[] = [];
  readonly answers: Answer[] = [];
  readonly signer = receiptKey("kljuc-izmisljeni-e2e");
  revision = R0;
  head: string | null = null;
  lastSequenceTo = 0;
  maxInFlight = 0;
  private readonly keys = new Map<string, number>();
  private open = 0;

  config(seedText = "Uvod"): HarnessConfig {
    return {
      scope: randomBytes(32).toString("hex"),
      documentId: DOC,
      evidenceDomainId: BASE.evidenceDomainId,
      receiptKeys: [this.signer.key],
      revision: R0,
      seedText,
    };
  }

  /** Serves the page and the bundle and answers the commit route for every page of `context`. */
  async install(context: BrowserContext, config: HarnessConfig): Promise<void> {
    if (!bundle) throw new Error("evidence harness: call prepareEvidenceHarness in beforeAll first");
    const code = await bundle;
    await context.route(`${HARNESS_URL}*`, (route) =>
      route.request().url().endsWith(".js")
        ? route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: code })
        : route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE }));
    await context.route(COMMIT_URL, (route) => this.answer(route));
    await context.addInitScript((value) => {
      window.__evidenceConfig = value;
    }, config);
  }

  private async answer(route: Route): Promise<void> {
    const text = route.request().postData() ?? "";
    const body = JSON.parse(text) as CommitBody;
    this.calls.push({ key: body.clientTransactionId, text, body });
    const answer = this.answers.shift() ?? "accept";
    if (answer === "hang") return;
    this.open += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.open);
    try {
      // Long enough for a second request to overlap, were one ever sent.
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (answer === "abort") {
        await route.abort("internetdisconnected");
        return;
      }
      if (answer === "chain_conflict") {
        await route.fulfill({ status: 409, json: { status: "chain_conflict", currentRevision: this.revision + 1 } });
        return;
      }
      await route.fulfill(this.accept(body, answer === "tamper"));
    } finally {
      this.open -= 1;
    }
  }

  private accept(body: CommitBody, tamper: boolean) {
    const segment = Buffer.from(body.segments[0]!, "base64");
    const known = this.keys.get(body.clientTransactionId);
    if (known === undefined && body.baseRevision !== this.revision) {
      return { status: 409, json: { status: "stale_base", currentRevision: this.revision } };
    }
    if (known === undefined) {
      this.revision += 1;
      this.keys.set(body.clientTransactionId, this.revision);
      this.head = sha256(segment);
      this.lastSequenceTo = (JSON.parse(segment.toString("utf8")) as { sequenceTo: number }).sequenceTo;
    }
    const revision = this.keys.get(body.clientTransactionId)!;
    const signedReceipt = this.signer.sign({ documentId: DOC, clientTransactionId: body.clientTransactionId, revision, segmentHash: sha256(segment) });
    if (tamper) {
      const signature = Buffer.from(signedReceipt.signature.signatureBase64Url, "base64url");
      signature[0]! ^= 0x01;
      signedReceipt.signature.signatureBase64Url = signature.toString("base64url");
    }
    return { status: 200, json: { status: known === undefined ? "committed" : "duplicate", revision, receipt: { status: "signed", signedReceipt } } };
  }

  /** Waits until `n` requests have arrived. */
  async arrived(n: number, timeoutMs = 10_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (this.calls.length < n) {
      if (Date.now() > until) throw new Error(`expected ${n} commit requests, got ${this.calls.length}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

/** Opens the harness page in `page` and waits until its journal is started. */
export async function openEvidenceHarness(page: Page): Promise<void> {
  await page.goto(HARNESS_URL);
  await page.waitForFunction(() => window.__evidence?.ready === true || window.__evidence?.startFailure);
  const failed = await page.evaluate(() => window.__evidence!.startFailure);
  if (failed) throw new Error(`evidence harness did not start: ${failed}`);
}
