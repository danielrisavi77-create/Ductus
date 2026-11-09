import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import fc from "fast-check";

import { checkSbom } from "./image-sbom.mjs";

// DAN-185 (M11.9-P02): the SBOM of the production image describes that image:
// CycloneDX, a container source, OS and application packages, and every
// component tied to a layer of the image. Input classes of the contract on
// #1091 (w185a UGOVOR). The data below is invented.
const script = resolve(dirname(fileURLToPath(import.meta.url)), "image-sbom.mjs");
const layer = (c) => `sha256:${c.repeat(64)}`;
const BASE = [layer("a"), layer("b")];
const LAYERS = [...BASE, layer("c"), layer("d")];
const NEXT = JSON.parse(readFileSync(resolve(dirname(script), "../../package.json"), "utf8")).dependencies.next;
const codes = (findings) => [...new Set(findings.map((finding) => finding.code))].sort();
const at = (id) => [{ name: "syft:location:0:layerID", value: id }, { name: "syft:location:0:path", value: "/x" }];
const component = (purl, id) => ({ type: "library", name: purl.split("/").pop(), purl, properties: at(id) });
const bom = (overrides = {}) => ({
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  metadata: { component: { type: "container", name: "ductus-web:ci" } },
  components: [
    component("pkg:apk/alpine/musl@1.2.5-r10?arch=x86_64", layer("a")),
    component(`pkg:npm/next@${NEXT}`, layer("c")),
    component("pkg:npm/react@19.2.0", layer("c")),
  ],
  ...overrides,
});
const check = (value) => checkSbom(value, { layers: LAYERS, baseLayers: BASE, next: NEXT });

const CASES = [
  ["valid minimal SBOM", bom(), []],
  ["not an object", "{}", ["sbom-format"]],
  ["null", null, ["sbom-format"]],
  ["another format", bom({ bomFormat: "SPDX" }), ["sbom-format"]],
  ["no specVersion", bom({ specVersion: undefined }), ["sbom-format"]],
  ["specVersion not a string", bom({ specVersion: 1.6 }), ["sbom-format"]],
  ["source is a directory", bom({ metadata: { component: { type: "file" } } }), ["sbom-source"]],
  ["no metadata", bom({ metadata: undefined }), ["sbom-source"]],
  ["no components", bom({ components: [] }), ["sbom-app", "sbom-empty", "sbom-layer", "sbom-os"]],
  ["components not a list", bom({ components: {} }), ["sbom-app", "sbom-empty", "sbom-layer", "sbom-os"]],
  ["no OS package", bom({ components: bom().components.slice(1) }), ["sbom-os"]],
  ["no next", bom({ components: [bom().components[0], bom().components[2]] }), ["sbom-app"]],
  ["next of another version", bom({ components: [bom().components[0], component("pkg:npm/next@15.5.27", layer("c"))] }), ["sbom-app"]],
  ["version only as a prefix", bom({ components: [bom().components[0], component(`pkg:npm/next@${NEXT}1`, layer("c"))] }), ["sbom-app"]],
  ["next with qualifiers", bom({ components: [bom().components[0], component(`pkg:npm/next@${NEXT}?x=1`, layer("c"))] }), []],
  ["scoped package is not next", bom({ components: [bom().components[0], component(`pkg:npm/%40x/next@${NEXT}`, layer("c"))] }), ["sbom-app"]],
  ["next nested under another component", bom({ components: [bom().components[0], { ...bom().components[2], components: [bom().components[1]] }] }), []],
  ["layer not in the image", bom({ components: [...bom().components, component("pkg:npm/x@1.0.0", layer("e"))] }), ["sbom-layer"]],
  ["nothing in an added layer", bom({ components: bom().components.map((c) => ({ ...c, properties: at(layer("b")) })) }), ["sbom-layer"]],
  ["component without a location", bom({ components: [...bom().components, { type: "library", name: "y", purl: "pkg:npm/y@1.0.0" }] }), []],
];
for (const [name, value, expected] of CASES) {
  test(`checkSbom: ${name}`, () => assert.deepEqual(codes(check(value)), expected));
}

test("checkSbom: base layers that are not a prefix of the image never pass", () => {
  assert.deepEqual(codes(checkSbom(bom(), { layers: LAYERS, baseLayers: [layer("b")], next: NEXT })), ["sbom-layer"]);
  assert.deepEqual(codes(checkSbom(bom(), { layers: BASE, baseLayers: BASE, next: NEXT })), ["sbom-layer"]);
});

test("fast-check: dropping every next component always fails with sbom-app; extra packages in known layers never fail", () => {
  const extra = fc.array(fc.tuple(fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/), fc.constantFrom(...LAYERS)), { maxLength: 8 });
  fc.assert(fc.property(extra, (pairs) => {
    const more = pairs.filter(([name]) => name !== "next").map(([name, id]) => component(`pkg:npm/${name}@1.0.0`, id));
    const components = [...bom().components, ...more];
    assert.deepEqual(check(bom({ components })), []);
    const without = components.filter((c) => !c.purl.startsWith("pkg:npm/next@"));
    assert.deepEqual(codes(check(bom({ components: without }))), ["sbom-app"]);
  }));
});

const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

test("CLI: passes a valid SBOM, fails a broken one and bad JSON, rejects bad usage", () => {
  const dir = mkdtempSync(join(tmpdir(), "image-sbom-"));
  const write = (name, value) => {
    writeFileSync(join(dir, name), typeof value === "string" ? value : JSON.stringify(value));
    return join(dir, name);
  };
  try {
    const layers = write("layers.json", LAYERS);
    const base = write("base.json", BASE);
    const nextVersion = (value) => run(write("sbom.json", value), layers, base);
    const ok = nextVersion(bom());
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /SBOM OK: 3 components/);
    const failed = nextVersion(bom({ components: [bom().components[0]] }));
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /sbom-app/);
    const broken = nextVersion("{not json");
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /sbom-format/);
    assert.equal(run(layers, base).status, 2);
    assert.equal(run().status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
