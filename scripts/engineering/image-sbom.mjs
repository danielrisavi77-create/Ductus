#!/usr/bin/env node
// DAN-185 (M11.9-P02): the SBOM Syft writes for the production web image must
// describe that image. The smoke script hands it the CycloneDX file and the
// RootFS layers of the image and of its pinned base (contract on #1091, w185a).
//
//   image-sbom.mjs <sbom.json> <image-layers.json> <base-layers.json>
//
// The next version is the one package.json pins. Exit 1 on findings, 2 on usage.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LAYER_ID = /^syft:location:\d+:layerID$/;

/** Every component, nested ones included. */
function flatten(components) {
  if (!Array.isArray(components)) return [];
  return components.flatMap((c) => (c && typeof c === "object" ? [c, ...flatten(c.components)] : []));
}

const layersOf = (component) =>
  (Array.isArray(component.properties) ? component.properties : [])
    .filter((p) => p && LAYER_ID.test(p.name ?? "") && typeof p.value === "string")
    .map((p) => p.value);

/** Findings for one CycloneDX document against the layers of its image. */
export function checkSbom(bom, { layers, baseLayers, next }) {
  const findings = [];
  const add = (code, detail) => findings.push({ code, detail });
  if (!bom || typeof bom !== "object" || bom.bomFormat !== "CycloneDX" || typeof bom.specVersion !== "string") {
    add("sbom-format", "not a CycloneDX document with a specVersion");
    return findings;
  }
  if (bom.metadata?.component?.type !== "container") add("sbom-source", "the source is not a container image");
  const components = flatten(bom.components);
  if (components.length === 0) add("sbom-empty", "no components");
  const purls = components.map((c) => (typeof c.purl === "string" ? c.purl : ""));
  if (!purls.some((p) => p.startsWith("pkg:apk/"))) add("sbom-os", "no pkg:apk/ component (OS packages)");
  const app = new RegExp(`^pkg:npm/next@${next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[?#]|$)`);
  if (!purls.some((p) => app.test(p))) add("sbom-app", `no pkg:npm/next@${next} component`);
  const known = new Set(layers);
  const prefix = baseLayers.length <= layers.length && baseLayers.every((id, i) => layers[i] === id);
  const added = new Set(prefix ? layers.slice(baseLayers.length) : []);
  const seen = components.flatMap(layersOf);
  const unknown = [...new Set(seen.filter((id) => !known.has(id)))];
  if (unknown.length > 0) add("sbom-layer", `${unknown.length} layer IDs not in the image, first ${unknown[0]}`);
  if (!seen.some((id) => added.has(id))) add("sbom-layer", "no component in a layer the build adds");
  return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sbomPath, layersPath, basePath] = process.argv.slice(2);
  if (!sbomPath || !layersPath || !basePath) {
    console.error("usage: image-sbom.mjs <sbom.json> <image-layers.json> <base-layers.json>");
    process.exit(2);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const next = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).dependencies.next;
  let bom = null;
  try {
    bom = JSON.parse(readFileSync(sbomPath, "utf8"));
  } catch {
    // Not JSON: reported as sbom-format below.
  }
  const layers = JSON.parse(readFileSync(layersPath, "utf8"));
  const baseLayers = JSON.parse(readFileSync(basePath, "utf8"));
  const findings = checkSbom(bom, { layers, baseLayers, next });
  const components = flatten(bom?.components);
  for (const f of findings) console.error(`${sbomPath}: ${f.code} (${f.detail})`);
  if (findings.length > 0) {
    // What Syft wrote, so a change of its output shape is visible in the log.
    const sample = components.slice(0, 3).map((c) => ({ purl: c.purl, properties: (c.properties ?? []).map((p) => p.name) }));
    console.error(`${components.length} components, ${layers.length} image layers, ${baseLayers.length} base layers; first: ${JSON.stringify(sample)}`);
    process.exit(1);
  }
  console.log(`SBOM OK: ${components.length} components, next@${next}, OS packages, every location in the image's layers`);
}
