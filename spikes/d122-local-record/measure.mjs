// D-122 spike (DAN-99): cost of sealing a synthetic journal record in a real
// browser (IndexedDB + WebCrypto). Run: node spikes/d122-local-record/measure.mjs
// Prints JSON; the numbers are copied into docs/spikes/M3.11-S.md, never asserted.
import { chromium, firefox, webkit } from "@playwright/test";

const ORIGIN = "https://d122.spike.test/";
const SIZES = [10_000, 100_000, 1_000_000];
const RUNS = 30;

/** Runs inside the page; plain JS, no imports. */
async function measure({ sizes, runs }) {
  const sentence = "Ovo je izmišljena rečenica sintetičkog rada za mjerenje. ";
  const docOf = (bytes) => {
    const nodes = [];
    let i = 0;
    while (JSON.stringify(nodes).length < bytes) {
      nodes.push({ type: "paragraph", id: `00000000-0000-4000-8000-${String(i++).padStart(12, "0")}`,
        children: [{ type: "text", text: sentence.repeat(8), marks: [] }] });
    }
    return { schemaVersion: 1, nodes };
  };
  const stats = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return { median: +s[Math.floor(s.length / 2)].toFixed(3), p95: +s[Math.floor(s.length * 0.95)].toFixed(3) };
  };
  const time = async (fn) => { const t = performance.now(); await fn(); return performance.now() - t; };
  const req = (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const db = await new Promise((ok, no) => {
    const r = indexedDB.open(`d122-${Math.random()}`, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("plain"); r.result.createObjectStore("sealed"); };
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
  const put = (store, value, key) => new Promise((ok, no) => {
    const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(value, key);
    tx.oncomplete = ok; tx.onerror = () => no(tx.error);
  });
  const get = (store, key) => req(db.transaction(store).objectStore(store).get(key));
  const enc = new TextEncoder(); const dec = new TextDecoder();
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const aad = enc.encode("ductus-d122-v1\u0000scope\u0000doc");
  const out = { userAgent: navigator.userAgent, sizes: [] };
  for (const bytes of sizes) {
    const doc = docOf(bytes);
    const json = JSON.stringify(doc);
    const r = { jsonBytes: enc.encode(json).length, putPlain: [], putSealed: [], getPlain: [], getSealed: [], seal: [], open: [] };
    let sealed;
    for (let i = 0; i < runs; i++) {
      r.putPlain.push(await time(() => put("plain", doc, "d")));
      r.seal.push(await time(async () => {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, enc.encode(JSON.stringify(doc))));
        sealed = { v: 1, iv, ct, at: Date.now() };
      }));
      r.putSealed.push(await time(() => put("sealed", sealed, "d")));
      r.getPlain.push(await time(() => get("plain", "d")));
      r.getSealed.push(await time(() => get("sealed", "d")));
      r.open.push(await time(async () => {
        const row = await get("sealed", "d");
        JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: row.iv, additionalData: aad }, key, row.ct)));
      }));
    }
    out.sizes.push({ jsonBytes: r.jsonBytes, sealedBytes: sealed.ct.length + sealed.iv.length,
      ...Object.fromEntries(["putPlain", "seal", "putSealed", "getPlain", "getSealed", "open"].map((k) => [k, stats(r[k])])) });
  }
  const kek = await crypto.subtle.generateKey({ name: "AES-KW", length: 256 }, false, ["wrapKey", "unwrapKey"]);
  const dek = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const wrapped = await crypto.subtle.wrapKey("raw", dek, kek, "AES-KW");
  const unwrap = [];
  for (let i = 0; i < runs; i++) {
    unwrap.push(await time(() => crypto.subtle.unwrapKey("raw", wrapped, kek, "AES-KW", "AES-GCM", false, ["encrypt", "decrypt"])));
  }
  out.unwrap = stats(unwrap);
  for (let i = 0; i < 200; i++) await put("plain", { at: i % 2 ? 0 : Date.now() }, `r${i}`);
  out.sweep200 = +(await time(() => new Promise((ok, no) => {
    const tx = db.transaction("plain", "readwrite");
    const cursor = tx.objectStore("plain").openCursor();
    cursor.onsuccess = () => { const c = cursor.result; if (!c) return; if (c.value.at === 0) c.delete(); c.continue(); };
    tx.oncomplete = ok; tx.onerror = () => no(tx.error);
  }))).toFixed(3);
  db.close();
  return out;
}

const results = {};
for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
  let browser;
  try { browser = await type.launch(); } catch (error) { results[name] = { skipped: String(error.message).split("\n")[0] }; continue; }
  try {
    const page = await browser.newPage();
    await page.route(`${ORIGIN}**`, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>d122</title>" }));
    await page.goto(ORIGIN);
    results[name] = { version: browser.version(), ...(await page.evaluate(measure, { sizes: SIZES, runs: RUNS })) };
  } finally {
    await browser.close();
  }
}
console.log(JSON.stringify(results, null, 2));
