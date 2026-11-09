#!/usr/bin/env node
// DAN-185 (M11.9-P02): the files the production web image serves to the
// browser carry no source map. The smoke script lists every file under the two
// served roots of the running container, fetches each over HTTP and hands the
// bodies, headers and status codes to this check (contract on #1091, w185a).
//
//   served-bundle.mjs list  <tree>              prints the files of a copied /app
//   served-bundle.mjs urls  < container paths   prints one URL per path
//   served-bundle.mjs check <dir>               reads <dir>/index.tsv
//
// index.tsv has one line per file: URL, HTTP status, and the status of
// "<URL>.map" ("-" when not probed). Line n has its body in body/n and its
// response headers in head/n. Exit 1 on findings, 2 on usage errors.
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Next.js standalone serves .next/static at /_next/static and public at /.
const ROOTS = [["/app/.next/static/", "/_next/static/"], ["/app/public/", "/"]];
// "//# sourceMappingURL=", "//@ …", "/*# … */" and inline data: maps alike.
// \s is any ECMAScript white space or line terminator, as ECMA-426 §11.1.2.1.1 allows.
const REFERENCE = /[#@]\s*sourceMappingURL\s*=/i;
const HEADER = /^(?:x-)?sourcemap[ \t]*:/im;
const CHUNK = /^\/_next\/static\/chunks\/.+\.js$/;
// A WebAssembly module names its map in a custom section (ECMA-426 §11.1.2.3).
const WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
const WASM_MAP = "sourceMappingURL";

/** An unsigned LEB128 at `at`: [value, next offset], or null when cut off. */
function leb128(bytes, at) {
  let value = 0;
  for (let i = at, shift = 0; i < bytes.length && shift < 35; i += 1, shift += 7) {
    value += (bytes[i] & 0x7f) * 2 ** shift;
    if ((bytes[i] & 0x80) === 0) return [value, i + 1];
  }
  return null;
}

/** The custom section names of a WebAssembly module, or null when it does not parse. */
export function wasmCustomSections(bytes) {
  const names = [];
  for (let at = 8; at < bytes.length; ) {
    const size = leb128(bytes, at + 1);
    if (size === null || size[1] + size[0] > bytes.length) return null;
    const end = size[1] + size[0];
    if (bytes[at] === 0) {
      const name = leb128(bytes, size[1]);
      if (name === null || name[1] + name[0] > end) return null;
      names.push(bytes.toString("utf8", name[1], name[1] + name[0]));
    }
    at = end;
  }
  return names;
}

/** A WebAssembly module that names a source map; one that does not parse is judged by the word. */
function wasmReference(bytes, text) {
  if (bytes.length < 8 || !bytes.subarray(0, 4).equals(WASM)) return false;
  const names = wasmCustomSections(bytes);
  return names === null ? text.includes(WASM_MAP) : names.includes(WASM_MAP);
}

/**
 * The files under the served roots of <tree>, a copy of the container's /app
 * made with "docker cp", which keeps a symbolic link a link. Next follows a
 * link under a served root (#1752 review c.6729118211), so a link, wherever it
 * points, and any entry that is neither a file nor a directory is a finding;
 * so is a missing root. Paths are the container's, sorted.
 */
export function listServed(tree) {
  const paths = [];
  const findings = [];
  const walk = (path) => {
    let entry;
    try {
      entry = lstatSync(join(tree, path));
    } catch {
      findings.push({ code: "served-root", url: path, detail: "missing" });
      return;
    }
    if (entry.isFile()) paths.push(path);
    else if (entry.isDirectory()) for (const name of readdirSync(join(tree, path))) walk(`${path}/${name}`);
    else {
      const kind = entry.isSymbolicLink() ? "symbolic link" : entry.isFIFO() ? "FIFO" : entry.isSocket() ? "socket" : "device";
      findings.push({ code: "served-type", url: path, detail: `${kind}, not a regular file or directory` });
    }
  };
  for (const [root] of ROOTS) walk(root.slice(0, -1));
  return { paths: paths.sort(), findings };
}

/** The URL a container path is served at, or null outside the served roots. */
export function servedUrl(path) {
  if (/[\u0000-\u001f\u007f]/.test(path)) return null;
  for (const [from, to] of ROOTS) {
    if (!path.startsWith(from)) continue;
    const parts = path.slice(from.length).split("/");
    if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
    return to + parts.map(encodeURIComponent).join("/");
  }
  return null;
}

/**
 * Every text a browser may read the body as. latin1 keeps every byte, so a
 * marker inside a binary file is still seen; UTF-8 turns a multi-byte space
 * (U+00A0, U+2028, U+FEFF, …) into \s. UTF-16 is the only encoding a browser
 * applies (by BOM or charset) that is not ASCII compatible (#1752 QA
 * c.6729113556), so both byte orders are read at both alignments, BOM or not.
 */
function decodings(bytes, text) {
  const texts = [text, bytes.toString("utf8")];
  for (const at of [0, 1]) {
    const even = bytes.subarray(at, at + ((bytes.length - at) & ~1));
    texts.push(even.toString("utf16le"), Buffer.from(even).swap16().toString("utf16le"));
  }
  return texts;
}

/** Findings for one served file: { url, status, mapStatus, body, headers }. */
export function checkServed({ url, status, mapStatus, body, headers }) {
  const findings = [];
  const add = (code, detail) => findings.push({ code, url, detail });
  if (status !== "200") add("served-status", `answered ${status}, not 200`);
  if (/\.map$/i.test(url)) add("source-map-file", "a source map is served");
  const bytes = Buffer.from(body);
  const text = bytes.toString("latin1");
  if (decodings(bytes, text).some((decoded) => REFERENCE.test(decoded))) add("source-map-reference", "sourceMappingURL in the body");
  else if (wasmReference(bytes, text)) add("source-map-reference", "sourceMappingURL custom section in a WebAssembly module");
  if (HEADER.test(headers)) add("source-map-header", "SourceMap response header");
  if (mapStatus !== "-" && mapStatus !== "404") add("source-map-served", `${url}.map answered ${mapStatus}, not 404`);
  return findings;
}

/** Findings for the whole served set; a set without a JS chunk proves nothing. */
export function checkServedSet(entries) {
  const findings = entries.flatMap(checkServed);
  if (!entries.some((entry) => CHUNK.test(entry.url))) {
    findings.push({ code: "served-empty", url: "-", detail: `${entries.length} files, none under /_next/static/chunks/*.js` });
  }
  return findings;
}

function readSet(dir) {
  const lines = readFileSync(join(dir, "index.tsv"), "utf8").split("\n").filter((line) => line !== "");
  return lines.map((line, index) => {
    const [url, status, mapStatus] = line.split("\t");
    const n = String(index + 1);
    return { url, status, mapStatus, body: readFileSync(join(dir, "body", n)), headers: readFileSync(join(dir, "head", n), "latin1") };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, dir] = process.argv.slice(2);
  if (mode === "list" && dir) {
    const { paths, findings } = listServed(dir);
    for (const path of paths) console.log(path);
    for (const f of findings) console.error(`${f.url}: ${f.code} (${f.detail})`);
    process.exit(findings.length > 0 ? 1 : 0);
  }
  if (mode === "urls") {
    let failed = false;
    for (const path of readFileSync(0, "utf8").split("\n").filter((line) => line !== "")) {
      const url = servedUrl(path);
      if (url === null) {
        console.error(`${JSON.stringify(path)}: served-path (outside the served roots)`);
        failed = true;
      } else console.log(url);
    }
    process.exit(failed ? 1 : 0);
  }
  if (mode !== "check" || !dir) {
    console.error("usage: served-bundle.mjs list <tree> | served-bundle.mjs urls < paths | served-bundle.mjs check <dir>");
    process.exit(2);
  }
  const entries = readSet(dir);
  const findings = checkServedSet(entries);
  for (const f of findings) console.error(`${f.url}: ${f.code} (${f.detail})`);
  if (findings.length > 0) process.exit(1);
  console.log(`Served bundle OK: ${entries.length} files, no source map, reference or SourceMap header`);
}
