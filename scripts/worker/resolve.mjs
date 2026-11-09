// DAN-517: lets plain Node run the worker from its TypeScript sources. Node
// strips the types itself; what it lacks is the "@/" alias of tsconfig.json
// and imports written without an extension. Both are resolved here, for files
// under src/ only; every other import goes to Node unchanged.
import { existsSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");

function sourceFile(base) {
  for (const candidate of [base, `${base}.ts`, path.join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function target(specifier, parentURL) {
  if (specifier.startsWith("@/")) return path.join(SRC, specifier.slice(2));
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  if (parentURL === undefined || !parentURL.startsWith("file:")) return null;
  const parent = fileURLToPath(parentURL);
  return parent.startsWith(SRC + path.sep) ? path.resolve(path.dirname(parent), specifier) : null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const base = target(specifier, context.parentURL);
    const found = base === null ? null : sourceFile(base);
    return found === null ? nextResolve(specifier, context) : { url: pathToFileURL(found).href, shortCircuit: true };
  },
});
