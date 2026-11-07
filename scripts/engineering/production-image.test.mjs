import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import fc from "fast-check";

import { checkDockerfile, checkDockerignore, productionImages } from "./production-image.mjs";

// DAN-298 (attack plan #1687): every image under infra/docker is pinned by
// digest, runs as a numeric non-root user, carries no secret and no local-only
// login switch (D-09), and its build context is an allowlist. The data below
// is invented.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIGEST = `@sha256:${"a".repeat(64)}`;
const PINNED = `mirror.gcr.io/library/node:24.21.0-alpine${DIGEST}`;

const codes = (findings) => [...new Set(findings.map((finding) => finding.code))].sort();
const valid = (overrides = {}) => {
  const lines = {
    arg: `ARG BASE=${PINNED}`,
    build: "FROM ${BASE} AS build",
    buildBody: "WORKDIR /app\nCOPY package.json pnpm-lock.yaml ./\nRUN --mount=type=secret,id=npm true",
    web: "FROM ${BASE} AS web",
    env: "ENV NODE_ENV=production",
    copy: "COPY --from=build --chown=0:0 /app/out ./",
    user: "USER 1000:1000",
    cmd: 'CMD ["node", "server.js"]',
    ...overrides,
  };
  return Object.values(lines).filter((line) => line !== "").join("\n");
};

// One row per input class of the contract (#1091, w298a UGOVOR); null = passes.
const DOCKERFILE_CASES = [
  ["the valid baseline", valid(), []],
  ["FROM with a tag and no digest", valid({ build: "FROM node:24-alpine AS build" }), ["unpinned-image"]],
  ["FROM with a digest and no registry", valid({ arg: "", build: `FROM node${DIGEST} AS build`, web: `FROM node${DIGEST} AS web` }), ["unpinned-image"]],
  ["FROM with a namespace and no registry host", valid({ arg: "", build: `FROM library/node${DIGEST} AS build`, web: `FROM library/node${DIGEST} AS web` }), ["unpinned-image"]],
  ["ARG without a default", valid({ arg: "ARG BASE" }), ["unresolved-image"]],
  ["ARG default without a digest", valid({ arg: "ARG BASE=mirror.gcr.io/library/node:24" }), ["unpinned-image"]],
  ["FROM with a partly substituted name", valid({ build: "FROM mirror.gcr.io/library/node:${TAG} AS build" }), ["unresolved-image"]],
  ["FROM with a default inside the substitution", valid({ build: "FROM ${BASE:-node:24} AS build" }), ["unresolved-image"]],
  ["FROM $NAME without braces", valid({ build: "FROM $BASE AS build" }), []],
  ["FROM a literal pinned image with --platform", valid({ build: `FROM --platform=linux/amd64 ${PINNED} AS build` }), []],
  ["FROM an earlier stage", valid({ web: "FROM build AS web" }), []],
  ["FROM scratch", valid({ web: "FROM scratch AS web" }), []],
  ["COPY --from an external image without a digest", valid({ copy: "COPY --from=node:24 /usr/local/bin/node /bin/" }), ["unpinned-image"]],
  ["COPY --from an external pinned image", valid({ copy: `COPY --from=${PINNED} /usr/local/bin/node /bin/` }), []],
  ["COPY --from a stage index", valid({ copy: "COPY --from=0 /app/out ./" }), []],
  ["ADD of a URL", valid({ copy: "ADD https://example.invalid/tool.tgz /opt/" }), ["add"]],
  ["ADD of a local file", valid({ copy: "ADD package.json ./" }), ["add"]],
  ["final stage without USER", valid({ user: "" }), ["final-user"]],
  ["final stage USER root", valid({ user: "USER root" }), ["final-user"]],
  ["final stage USER 0", valid({ user: "USER 0" }), ["final-user"]],
  ["final stage USER 0:0", valid({ user: "USER 0:0" }), ["final-user"]],
  ["final stage USER 1000:0", valid({ user: "USER 1000:0" }), ["final-user"]],
  ["final stage USER with a name", valid({ user: "USER node" }), ["final-user"]],
  ["final stage USER from a variable", valid({ user: "USER ${UID}" }), ["final-user"]],
  ["final stage USER 00", valid({ user: "USER 00" }), ["final-user"]],
  ["final stage USER 1000 without a group", valid({ user: "USER 1000" }), []],
  ["USER only in an earlier stage", valid({ buildBody: "USER 1000:1000", user: "" }), ["final-user"]],
  ["USER root after a non-root USER", valid({ user: "USER 1000:1000\nUSER root" }), ["final-user"]],
  ["secret-like ARG", valid({ buildBody: "ARG NPM_TOKEN" }), ["secret-name"]],
  ["secret-like ENV, key=value form", valid({ env: "ENV NODE_ENV=production APP_DATABASE_URL=postgres://x" }), ["secret-name"]],
  ["secret-like ENV, legacy form", valid({ env: "ENV NODE_ENV=production\nENV OIDC_CLIENT_SECRET example" }), ["local-only-env", "secret-name"]],
  ["secret-like ENV, private key", valid({ env: "ENV NODE_ENV=production SIGNING_PRIVATE_KEY=x" }), ["secret-name"]],
  ["DUCTUS_AUTH_PROVIDER in the image", valid({ env: "ENV NODE_ENV=production DUCTUS_AUTH_PROVIDER=aai-eduhr" }), ["local-only-env"]],
  ["OIDC setting in the image", valid({ env: "ENV NODE_ENV=production OIDC_ISSUER=http://localhost:8090" }), ["local-only-env"]],
  ["local demo journal switch in the image", valid({ env: "ENV NODE_ENV=production DUCTUS_LOCAL_DEMO_JOURNAL=1" }), ["local-only-env"]],
  ["NODE_ENV development in the final stage", valid({ env: "ENV NODE_ENV=development" }), ["node-env"]],
  ["NODE_ENV quoted production", valid({ env: 'ENV NODE_ENV="production"' }), []],
  ["NODE_ENV missing in the final stage", valid({ env: "" }), ["node-env"]],
  ["NODE_ENV overridden in the build stage", valid({ buildBody: "ENV NODE_ENV=test" }), ["node-env"]],
  ["COPY of .env", valid({ copy: "COPY .env ./" }), ["forbidden-copy"]],
  ["COPY of .env.local in JSON form", valid({ copy: 'COPY [".env.local", "./"]' }), ["forbidden-copy"]],
  ["COPY of infra/fake-oidc", valid({ copy: "COPY infra/fake-oidc ./oidc" }), ["forbidden-copy"]],
  ["COPY of ./infra", valid({ copy: "COPY ./infra/ ./" }), ["forbidden-copy"]],
  ["COPY of .git", valid({ copy: "COPY .git ./.git" }), ["forbidden-copy"]],
  ["heredoc in RUN", valid({ buildBody: "RUN <<EOF\ntrue\nEOF" }), ["heredoc"]],
  ["heredoc in COPY", valid({ copy: "COPY <<-'X' /app/a\nx\nX" }), ["heredoc"]],
  ["ONBUILD", valid({ buildBody: "ONBUILD RUN true" }), ["onbuild"]],
  ["escape parser directive", `# escape=\`\n${valid()}`, ["escape-directive"]],
  ["syntax parser directive", `# syntax=docker/dockerfile:1\n${valid()}`, ["syntax-directive"]],
  ["RUN bind mount from an unpinned image", valid({ buildBody: "RUN --mount=type=bind,from=alpine:latest,target=/x true" }), ["unpinned-image"]],
  ["RUN cache mount from an earlier stage", valid({ copy: "RUN --mount=type=cache,target=/c,from=build true" }), []],
  ["RUN mount from a pinned image", valid({ buildBody: `RUN --network=none --mount=type=bind,from=${PINNED},target=/x true` }), []],
  ["unknown instruction", valid({ buildBody: "FETCH x" }), ["unknown-instruction"]],
  ["instruction before the first FROM", `WORKDIR /x\n${valid()}`, ["before-from"]],
  ["no FROM at all", "ARG X=1\n", ["no-from"]],
  ["lowercase instructions", valid().replace(/^([A-Z]+)/gm, (word) => word.toLowerCase()), []],
  ["line continuation and comments", valid({ user: "USER \\\n  # uid of the runtime user\n  0" }), ["final-user"]],
  ["continued FROM", valid({ build: "FROM \\\n  node:24 AS build" }), ["unpinned-image"]],
];

for (const [name, text, expected] of DOCKERFILE_CASES) {
  test(`Dockerfile: ${name}`, () => {
    assert.deepEqual(codes(checkDockerfile(text)), [...expected].sort());
  });
}

const IGNORE_OK = "*\n!package.json\n!pnpm-lock.yaml\n!src\n!app\n!public\n**/.env*\n";
const DOCKERIGNORE_CASES = [
  ["the valid allowlist", IGNORE_OK, []],
  ["comments and blank lines", `# allowlist\n\n${IGNORE_OK}`, []],
  ["no leading *", IGNORE_OK.replace("*\n", ""), ["ignore-not-allowlist"]],
  ["re-include of .env", IGNORE_OK.replace("!src", "!.env.local"), ["ignore-reinclude"]],
  ["re-include of a nested .env", IGNORE_OK.replace("!src", "!src/.env"), ["ignore-reinclude"]],
  ["re-include of infra", IGNORE_OK.replace("!src", "!infra/fake-oidc"), ["ignore-reinclude"]],
  ["re-include of .git", IGNORE_OK.replace("!src", "!.git"), ["ignore-reinclude"]],
  ["re-include with a glob", IGNORE_OK.replace("!src", "!**"), ["ignore-reinclude"]],
  ["re-include with ..", IGNORE_OK.replace("!src", "!src/../infra"), ["ignore-reinclude"]],
  ["re-include of tests", IGNORE_OK.replace("!src", "!tests"), ["ignore-reinclude"]],
  ["no trailing .env exclusion", IGNORE_OK.replace("**/.env*\n", ""), ["ignore-env-tail"]],
  ["re-include after the .env exclusion", `${IGNORE_OK}!docs2\n`, ["ignore-env-tail"]],
];

for (const [name, text, expected] of DOCKERIGNORE_CASES) {
  test(`dockerignore: ${name}`, () => {
    assert.deepEqual(codes(checkDockerignore(text)), [...expected].sort());
  });
}

// Case and spacing never change a verdict (input class 13).
test("Dockerfile verdicts do not depend on instruction case or spacing", () => {
  const rows = DOCKERFILE_CASES.filter(([name]) => !name.includes("directive"));
  fc.assert(
    fc.property(fc.constantFrom(...rows), fc.array(fc.boolean(), { minLength: 40, maxLength: 40 }), fc.integer({ min: 1, max: 4 }), ([, text, expected], cases, spaces) => {
      let index = 0;
      const mutated = text.replace(/^([A-Za-z]+)( )/gm, (_, word) => {
        const lower = cases[index++ % cases.length];
        return (lower ? word.toLowerCase() : word.toUpperCase()) + " ".repeat(spaces);
      });
      assert.deepEqual(codes(checkDockerfile(mutated)), [...expected].sort());
    }),
  );
});

// Any name carrying a secret marker fails as ARG and as ENV (input class 9).
test("Dockerfile rejects every secret-like ARG and ENV name", () => {
  const marker = fc.constantFrom("SECRET", "TOKEN", "PASSWORD", "PASSWD", "PRIVATE_KEY", "API_KEY", "APIKEY", "CREDENTIALS", "DATABASE_URL");
  const part = fc.stringMatching(/^[A-Z][A-Z0-9]{0,6}$/);
  fc.assert(
    fc.property(part, marker, part, fc.constantFrom("ARG", "ENV"), (before, secret, after, kind) => {
      const name = `${before}_${secret}_${after}`;
      const line = kind === "ARG" ? `ARG ${name}=x` : `ENV ${name}=x`;
      assert.ok(codes(checkDockerfile(valid({ buildBody: line }))).includes("secret-name"), name);
    }),
  );
});

test("the repository has a web production image and every image passes", () => {
  const images = productionImages(root);
  assert.ok(images.some((image) => image.dockerfile.endsWith("infra/docker/web.Dockerfile")), "infra/docker/web.Dockerfile exists");
  for (const image of images) {
    assert.ok(existsSync(image.dockerignore), `${image.dockerignore} exists next to ${image.dockerfile}`);
    assert.deepEqual(checkDockerfile(readFileSync(image.dockerfile, "utf8")), [], image.dockerfile);
    assert.deepEqual(checkDockerignore(readFileSync(image.dockerignore, "utf8")), [], image.dockerignore);
  }
});

test("standalone output is switched on only by the image build", () => {
  const config = readFileSync(resolve(root, "next.config.ts"), "utf8");
  assert.match(config, /process\.env\.DUCTUS_NEXT_OUTPUT === "standalone"/);
  const web = readFileSync(resolve(root, "infra/docker/web.Dockerfile"), "utf8");
  assert.match(web, /^ENV DUCTUS_NEXT_OUTPUT=standalone$/m);
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts.build, "next build");
  assert.equal(pkg.scripts.start, "next start");
});

// infra/docker/image-gitleaks.toml lets the per-build Next.js preview and
// Server Actions keys through because nothing in the application uses them.
test("the application has no Server Actions and no draft mode", () => {
  const files = (directory) =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return files(path);
      return /\.(?:ts|tsx|js|mjs)$/.test(entry.name) && !/\.(?:test|fixture)\./.test(entry.name) ? [path] : [];
    });
  const sources = ["app", "src", "middleware.ts", "instrumentation.ts"].map((path) => resolve(root, path));
  for (const file of sources.flatMap((path) => (path.endsWith(".ts") ? [path] : files(path)))) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /["']use server["']/, `${file}: Server Actions need infra/docker/image-gitleaks.toml reviewed`);
    assert.doesNotMatch(text, /\bdraftMode\b/, `${file}: draft mode needs infra/docker/image-gitleaks.toml reviewed`);
  }
});
