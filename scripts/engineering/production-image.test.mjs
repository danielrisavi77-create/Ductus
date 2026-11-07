import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import fc from "fast-check";

import { checkDockerfile, checkDockerignore, checkImageConfig, productionImages } from "./production-image.mjs";

// DAN-298 (attack plan #1687), owner decision 7. 11. 2026. on #1691: the
// Dockerfile is a whitelist of canonical lines and the built image's config is
// checked on its own. Input classes 1-7 of the contract (#1091, w298c UGOVOR).
// The data below is invented.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const script = resolve(dirname(fileURLToPath(import.meta.url)), "production-image.mjs");
const DIGEST = `@sha256:${"a".repeat(64)}`;
const PINNED = `mirror.gcr.io/library/node:24.21.0-alpine${DIGEST}`;
const WEB = readFileSync(resolve(root, "infra/docker/web.Dockerfile"), "utf8");

const codes = (findings) => [...new Set(findings.map((finding) => finding.code))].sort();
const valid = (overrides = {}) => {
  const lines = {
    arg: `ARG BASE=${PINNED}`,
    build: "FROM ${BASE} AS build",
    buildBody: "WORKDIR /app\nCOPY package.json pnpm-lock.yaml ./\nRUN pnpm install --frozen-lockfile --ignore-scripts",
    web: "FROM ${BASE} AS web",
    env: "ENV NODE_ENV=production",
    copy: "COPY --from=build /app/out ./",
    user: "USER 1000:1000",
    cmd: 'CMD ["node", "server.js"]',
    ...overrides,
  };
  return Object.values(lines).filter((line) => line !== "").join("\n");
};
const NOT_CANONICAL = ["not-canonical"];

const DOCKERFILE_CASES = [
  // 1. Canonical files pass.
  ["the valid baseline", valid(), []],
  ["the repository's web.Dockerfile", WEB, []],
  ["comments, blank lines and a final newline", `# image\n\n${valid()}\n`, []],
  ["EXPOSE and WORKDIR in the final stage", valid({ cmd: 'WORKDIR /app\nEXPOSE 3000\nCMD ["node", "server.js"]' }), []],
  ["USER without a group", valid({ user: "USER 1000" }), []],

  // 2. Every form that failed an earlier round (review and QA on #1691).
  ["mount with a repeated from (QA 6709794886)", valid({ buildBody: "RUN --mount=type=bind,from=build,from=alpine:latest,target=/m true" }), NOT_CANONICAL],
  ["mount with a quoted from (review 6709800366)", valid({ buildBody: 'RUN --mount=type=bind,"from=alpine:latest",target=/m true' }), NOT_CANONICAL],
  ["quoted flag name", valid({ buildBody: 'RUN --mo"unt"=type=bind,from=alpine:latest,target=/x true' }), NOT_CANONICAL],
  ["escaped flag name", valid({ buildBody: "RUN --mo\\unt=type=bind,from=alpine:latest,target=/x true" }), NOT_CANONICAL],
  ["COPY with a quoted flag name", valid({ copy: "COPY --fr'om'=node:24 /usr/local/bin/node /bin/" }), NOT_CANONICAL],
  ["continuation inside a local-only ENV name", valid({ env: "ENV NODE_ENV=production DUCTUS_AUTH_PROVI\\\nDER=fake-oidc" }), NOT_CANONICAL],
  ["continuation inside a secret ARG name", valid({ arg: `ARG NPM_TO\\\nKEN=x\nARG BASE=${PINNED}` }), NOT_CANONICAL],
  ["continued RUN swallowing an ENV (review 6710654996)", valid({ env: "ENV NODE_ENV=production\nRUN echo \\\\\nENV NODE_ENV=development DUCTUS_AUTH_PROVIDER=fake-oidc" }), NOT_CANONICAL],
  ["quoted .env source (QA 6710687733)", valid({ copy: 'COPY --from=build ".env.local" /opt/config' }), NOT_CANONICAL],
  ["RUN --mount secret", valid({ buildBody: "RUN --mount=type=secret,id=npm true" }), NOT_CANONICAL],
  ["RUN --network", valid({ buildBody: "RUN --network=none true" }), NOT_CANONICAL],
  ["heredoc in RUN", valid({ buildBody: "RUN <<EOF\ntrue\nEOF" }), NOT_CANONICAL],
  ["heredoc in COPY", valid({ copy: "COPY <<-'X' /app/a\nx\nX" }), NOT_CANONICAL],
  ["escape parser directive", `# escape=\`\n${valid()}`, NOT_CANONICAL],
  ["syntax parser directive", `# syntax=docker/dockerfile:1\n${valid()}`, NOT_CANONICAL],
  ["check parser directive", `#check=skip=all\n${valid()}`, NOT_CANONICAL],
  ["directive-like comment later in the file", valid({ user: "#  escape = `\nUSER 1000:1000" }), NOT_CANONICAL],
  ["line continuation with a comment", valid({ user: "USER \\\n  # uid of the runtime user\n  0" }), NOT_CANONICAL],

  // 3. Characters and layout.
  ["CRLF line ends", valid().replace(/\n/g, "\r\n"), NOT_CANONICAL],
  ["a tab", valid({ cmd: 'CMD ["node",\t"server.js"]' }), NOT_CANONICAL],
  ["a byte order mark", `\uFEFF${valid()}`, NOT_CANONICAL],
  ["non-ASCII in a comment", `# slika čvora\n${valid()}`, NOT_CANONICAL],
  ["a NUL byte", valid({ user: "USER 1000:1000\u0000" }), NOT_CANONICAL],
  ["a backslash in a comment", `# path C:\\x\n${valid()}`, NOT_CANONICAL],
  ["leading space", valid({ user: " USER 1000:1000" }), NOT_CANONICAL],
  ["trailing space", valid({ user: "USER 1000:1000 " }), NOT_CANONICAL],
  ["two spaces after the keyword", valid({ env: "ENV  NODE_ENV=production" }), NOT_CANONICAL],
  ["a line of spaces", valid({ user: "   \nUSER 1000:1000" }), NOT_CANONICAL],
  ["comment without a space", `#image\n${valid()}`, NOT_CANONICAL],
  ["lowercase instruction", valid({ user: "user 1000:1000" }), NOT_CANONICAL],
  ["mixed-case instruction", valid({ env: "Env NODE_ENV=production" }), NOT_CANONICAL],

  // 4. Anything off the list.
  ["ADD of a URL", valid({ copy: "ADD https://example.invalid/tool.tgz /opt/" }), NOT_CANONICAL],
  ["ADD of a local file", valid({ copy: "ADD package.json ./" }), NOT_CANONICAL],
  ["ONBUILD", valid({ buildBody: "ONBUILD RUN true" }), NOT_CANONICAL],
  ["LABEL", valid({ buildBody: "LABEL a=b" }), NOT_CANONICAL],
  ["ENTRYPOINT", valid({ cmd: 'ENTRYPOINT ["node"]' }), NOT_CANONICAL],
  ["SHELL", valid({ buildBody: 'SHELL ["/bin/sh", "-c"]' }), NOT_CANONICAL],
  ["HEALTHCHECK", valid({ cmd: "HEALTHCHECK NONE" }), NOT_CANONICAL],
  ["VOLUME", valid({ cmd: "VOLUME /data" }), NOT_CANONICAL],
  ["STOPSIGNAL", valid({ cmd: "STOPSIGNAL SIGTERM" }), NOT_CANONICAL],
  ["unknown instruction", valid({ buildBody: "FETCH x" }), NOT_CANONICAL],
  ["RUN in JSON form", valid({ buildBody: 'RUN ["pnpm", "build"]' }), NOT_CANONICAL],
  ["COPY in JSON form", valid({ copy: 'COPY [".env.local", "./"]' }), NOT_CANONICAL],
  ["COPY --chown", valid({ copy: "COPY --from=build --chown=0:0 /app/out ./" }), NOT_CANONICAL],
  ["COPY --link", valid({ copy: "COPY --link --from=build /app/out ./" }), NOT_CANONICAL],
  ["COPY with one path", valid({ copy: "COPY --from=build /app/out" }), NOT_CANONICAL],
  ["COPY with a glob", valid({ copy: "COPY .e* ./" }), NOT_CANONICAL],
  ["COPY with a variable", valid({ copy: "COPY $SRC ./" }), NOT_CANONICAL],
  ["COPY --from a literal image with a tag", valid({ copy: "COPY --from=node:24 /usr/local/bin/node /bin/" }), NOT_CANONICAL],
  ["legacy ENV form", valid({ env: "ENV NODE_ENV production" }), NOT_CANONICAL],
  ["ENV with a quoted value", valid({ env: 'ENV NODE_ENV="production"' }), NOT_CANONICAL],
  ["ENV with a quoted name", valid({ env: 'ENV NODE_ENV=production\nENV "NODE_ENV"=development' }), NOT_CANONICAL],
  ["ENV with a space in the value", valid({ env: "ENV NODE_ENV=production LABEL_TEXT=a b" }), NOT_CANONICAL],
  ["ENV with a variable value", valid({ env: "ENV NODE_ENV=$MODE" }), NOT_CANONICAL],
  ["ENV with a variable name", valid({ env: "ENV NODE_ENV=production ${N}=development" }), NOT_CANONICAL],
  ["ENV with a lowercase name", valid({ env: "ENV NODE_ENV=production node_env=development" }), NOT_CANONICAL],
  ["ENV with an empty value", valid({ env: "ENV NODE_ENV=production OIDC_ISSUER=" }), NOT_CANONICAL],
  ["ENV with a second =", valid({ env: "ENV NODE_ENV=production=x" }), NOT_CANONICAL],
  ["ARG without a default", valid({ arg: "ARG BASE" }), NOT_CANONICAL],
  ["ARG with a quoted default", valid({ arg: `ARG BASE="${PINNED}"` }), NOT_CANONICAL],
  ["RUN with a redirect", valid({ buildBody: "RUN echo x > /app/.env" }), NOT_CANONICAL],
  ["RUN with a pipe", valid({ buildBody: "RUN pnpm build || true" }), NOT_CANONICAL],
  ["RUN with a semicolon", valid({ buildBody: "RUN true; true" }), NOT_CANONICAL],
  ["RUN with a variable", valid({ buildBody: "RUN echo $HOME" }), NOT_CANONICAL],
  ["RUN with quotes", valid({ buildBody: 'RUN echo "x"' }), NOT_CANONICAL],
  ["FROM a literal image", valid({ build: `FROM ${PINNED} AS build` }), NOT_CANONICAL],
  ["FROM $NAME without braces", valid({ build: "FROM $BASE AS build" }), NOT_CANONICAL],
  ["FROM with a default inside the substitution", valid({ build: "FROM ${BASE:-node:24} AS build" }), NOT_CANONICAL],
  ["FROM without a stage name", valid({ web: "FROM ${BASE}" }), NOT_CANONICAL],
  ["FROM with --platform", valid({ build: "FROM --platform=linux/amd64 ${BASE} AS build" }), NOT_CANONICAL],
  ["FROM with a capitalised stage name", valid({ web: "FROM ${BASE} AS Web" }), NOT_CANONICAL],
  ["FROM an earlier stage", valid({ web: "FROM build AS web" }), NOT_CANONICAL],
  ["FROM scratch", valid({ web: "FROM scratch AS web" }), NOT_CANONICAL],
  ["USER root", valid({ user: "USER root" }), NOT_CANONICAL],
  ["USER 0", valid({ user: "USER 0" }), NOT_CANONICAL],
  ["USER 0:0", valid({ user: "USER 0:0" }), NOT_CANONICAL],
  ["USER 1000:0", valid({ user: "USER 1000:0" }), NOT_CANONICAL],
  ["USER with a name", valid({ user: "USER node" }), NOT_CANONICAL],
  ["USER from a variable", valid({ user: "USER ${UID}" }), NOT_CANONICAL],
  ["USER 00", valid({ user: "USER 00" }), NOT_CANONICAL],
  ["USER root after a non-root USER", valid({ user: "USER 1000:1000\nUSER root" }), NOT_CANONICAL],
  ["relative WORKDIR", valid({ buildBody: "WORKDIR app" }), NOT_CANONICAL],
  ["EXPOSE with a protocol", valid({ cmd: 'EXPOSE 3000/tcp\nCMD ["node", "server.js"]' }), NOT_CANONICAL],
  ["CMD in shell form", valid({ cmd: "CMD node server.js" }), NOT_CANONICAL],
  ["CMD with a variable", valid({ cmd: 'CMD ["node", "$APP"]' }), NOT_CANONICAL],

  // 5. Values on canonical lines.
  ["ARG default without a digest", valid({ arg: "ARG BASE=mirror.gcr.io/library/node:24" }), ["unpinned-image"]],
  ["ARG default with a digest and no registry", valid({ arg: `ARG BASE=node${DIGEST}` }), ["unpinned-image"]],
  ["ARG default with a namespace and no registry host", valid({ arg: `ARG BASE=library/node${DIGEST}` }), ["unpinned-image"]],
  ["ARG default that is not an image", valid({ arg: `ARG BASE=1\nARG OTHER=${PINNED}`, build: "FROM ${OTHER} AS build", web: "FROM ${OTHER} AS web" }), ["unpinned-image"]],
  ["FROM an undeclared ARG", valid({ build: "FROM ${OTHER} AS build" }), ["unresolved-image"]],
  ["COPY --from a missing stage", valid({ copy: "COPY --from=nope /app/out ./" }), ["copy-from"]],
  ["COPY --from an image name", valid({ copy: "COPY --from=alpine /bin/sh /bin/" }), ["copy-from"]],
  ["COPY --from the current stage", valid({ copy: "COPY --from=web /app/out ./" }), ["copy-from"]],
  ["secret-like ARG", valid({ arg: `ARG BASE=${PINNED}\nARG NPM_TOKEN=${PINNED}` }), ["secret-name"]],
  ["secret-like ENV", valid({ env: "ENV NODE_ENV=production APP_DATABASE_URL=postgres://x" }), ["secret-name"]],
  ["private key ENV", valid({ env: "ENV NODE_ENV=production SIGNING_PRIVATE_KEY=x" }), ["secret-name"]],
  ["secret ENV in the build stage", valid({ buildBody: "ENV NPM_TOKEN=x" }), ["secret-name"]],
  ["DUCTUS_AUTH_PROVIDER in the image", valid({ env: "ENV NODE_ENV=production DUCTUS_AUTH_PROVIDER=aai-eduhr" }), ["local-only-env"]],
  ["OIDC setting in the image", valid({ env: "ENV NODE_ENV=production OIDC_ISSUER=http://localhost:8090" }), ["local-only-env"]],
  ["local demo journal switch in the image", valid({ env: "ENV NODE_ENV=production DUCTUS_LOCAL_DEMO_JOURNAL=1" }), ["local-only-env"]],
  ["local-only ARG", valid({ arg: `ARG BASE=${PINNED}\nARG OIDC_ISSUER=${PINNED}` }), ["local-only-env"]],
  ["OIDC client secret", valid({ env: "ENV NODE_ENV=production OIDC_CLIENT_SECRET=example" }), ["local-only-env", "secret-name"]],
  ["NODE_ENV development in the final stage", valid({ env: "ENV NODE_ENV=development" }), ["node-env"]],
  ["NODE_ENV overridden later in the final stage", valid({ env: "ENV NODE_ENV=production\nENV NODE_ENV=development" }), ["node-env"]],
  ["NODE_ENV missing in the final stage", valid({ env: "" }), ["node-env"]],
  ["NODE_ENV only in the build stage", valid({ buildBody: "ENV NODE_ENV=production", env: "" }), ["node-env"]],
  ["NODE_ENV test in the build stage", valid({ buildBody: "ENV NODE_ENV=test" }), ["node-env"]],
  ["final stage without USER", valid({ user: "" }), ["final-user"]],
  ["USER only in an earlier stage", valid({ buildBody: "USER 1000:1000", user: "" }), ["final-user"]],
  ["COPY of .env", valid({ copy: "COPY .env ./" }), ["forbidden-copy"]],
  ["COPY of .env.local", valid({ copy: "COPY .env.local ./" }), ["forbidden-copy"]],
  ["COPY of /.env.local", valid({ copy: "COPY /.env.local ./" }), ["forbidden-copy"]],
  ["COPY of a nested .env", valid({ copy: "COPY src/.env ./" }), ["forbidden-copy"]],
  ["COPY of .env as the second source", valid({ copy: "COPY package.json .env ./" }), ["forbidden-copy"]],
  ["COPY --from of a .env", valid({ copy: "COPY --from=build /app/.env.production ./" }), ["forbidden-copy"]],
  ["COPY of infra/fake-oidc", valid({ copy: "COPY infra/fake-oidc ./oidc" }), ["forbidden-copy"]],
  ["COPY of ./infra/", valid({ copy: "COPY ./infra/ ./" }), ["forbidden-copy"]],
  ["COPY of a nested infra", valid({ copy: "COPY app/infra/x ./" }), ["forbidden-copy"]],
  ["COPY of .git", valid({ copy: "COPY .git ./.git" }), ["forbidden-copy"]],
  ["a path that only starts like infra", valid({ copy: "COPY infrastructure.json ./" }), []],
  ["ARG after the first FROM", valid({ buildBody: `ARG OTHER=${PINNED}` }), ["arg-after-from"]],
  ["instruction before the first FROM", `WORKDIR /x\n${valid()}`, ["before-from"]],
  ["a repeated stage name", valid({ web: "FROM ${BASE} AS build" }), ["duplicate-stage"]],
  ["no FROM at all", `ARG X=${PINNED}\n`, ["no-from"]],
  ["an empty file", "", ["no-from"]],
];

for (const [name, text, expected] of DOCKERFILE_CASES) {
  test(`Dockerfile: ${name}`, () => {
    assert.deepEqual(codes(checkDockerfile(text)), [...expected].sort());
  });
}

test("a line off the whitelist is reported with its line number", () => {
  const findings = checkDockerfile(valid({ user: "USER root" }));
  assert.deepEqual(findings.map(({ code, line }) => ({ code, line })), [{ code: "not-canonical", line: 9 }]);
});

// 6. Any quote, escape, variable, redirect, tab or leading flag inserted into
// an instruction of the real web.Dockerfile makes it fail.
test("an inserted quote, escape, variable, redirect, tab or flag fails every instruction line", () => {
  const lines = WEB.split("\n");
  const instructionLines = lines.map((line, index) => [line, index]).filter(([line]) => /^[A-Z]/.test(line));
  fc.assert(
    fc.property(fc.constantFrom(...instructionLines), fc.constantFrom("\\", '"', "'", "$", "<", "\t", "--"), fc.nat(), ([line, index], insert, at) => {
      const position = insert === "--" ? line.indexOf(" ") + 1 : at % (line.length + 1);
      const mutated = [...lines];
      mutated[index] = line.slice(0, position) + insert + line.slice(position);
      assert.ok(codes(checkDockerfile(mutated.join("\n"))).includes("not-canonical"), mutated[index]);
    }),
    { numRuns: 500 },
  );
});

// Any name carrying a secret marker fails as ARG and as ENV.
test("Dockerfile rejects every secret-like ARG and ENV name", () => {
  const marker = fc.constantFrom("SECRET", "TOKEN", "PASSWORD", "PASSWD", "PRIVATE_KEY", "API_KEY", "APIKEY", "CREDENTIALS", "DATABASE_URL");
  const part = fc.stringMatching(/^[A-Z][A-Z0-9]{0,6}$/);
  fc.assert(
    fc.property(part, marker, part, fc.constantFrom("ARG", "ENV"), (before, secret, after, kind) => {
      const name = `${before}_${secret}_${after}`;
      const text = kind === "ARG" ? valid({ arg: `ARG BASE=${PINNED}\nARG ${name}=${PINNED}` }) : valid({ env: `ENV NODE_ENV=production ${name}=x` });
      assert.deepEqual(codes(checkDockerfile(text)), ["secret-name"], name);
    }),
  );
});

// 7. The built image's config (docker image inspect).
const config = (overrides = {}) => ({
  Config: {
    User: "1000:1000",
    Env: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "NODE_VERSION=24.21.0", "YARN_VERSION=1.22.22", "NODE_ENV=production", "NEXT_TELEMETRY_DISABLED=1", "PORT=3000", "HOSTNAME=0.0.0.0"],
    ...overrides,
  },
});
const withEnv = (...extra) => config({ Env: [...config().Config.Env, ...extra] });
const IMAGE_CASES = [
  ["a clean config", config(), []],
  ["a clean config as docker prints it (an array)", [config()], []],
  ["USER without a group", config({ User: "1000" }), []],
  ["DUCTUS_AUTH_PROVIDER", withEnv("DUCTUS_AUTH_PROVIDER=fake-oidc"), ["local-only-env"]],
  ["an OIDC setting", withEnv("OIDC_ISSUER=http://localhost:8090"), ["local-only-env"]],
  ["the local demo journal switch", withEnv("DUCTUS_LOCAL_DEMO_JOURNAL=1"), ["local-only-env"]],
  ["a secret-like name", withEnv("APP_DATABASE_URL=postgres://x"), ["secret-name"]],
  ["a token", withEnv("DUCTUS_CANARY_TOKEN=x"), ["secret-name"]],
  ["an OIDC client secret", withEnv("OIDC_CLIENT_SECRET=x"), ["local-only-env", "secret-name"]],
  ["an entry without =", withEnv("NPM_TOKEN"), ["secret-name"]],
  ["NODE_ENV development", config({ Env: ["NODE_ENV=development"] }), ["node-env"]],
  ["NODE_ENV missing", config({ Env: ["PATH=/usr/bin"] }), ["node-env"]],
  ["no Env at all", config({ Env: null }), ["node-env"]],
  ["empty User", config({ User: "" }), ["final-user"]],
  ["User missing", { Config: { Env: ["NODE_ENV=production"] } }, ["final-user"]],
  ["User 0", config({ User: "0" }), ["final-user"]],
  ["User root", config({ User: "root" }), ["final-user"]],
  ["User 0:0", config({ User: "0:0" }), ["final-user"]],
  ["User 1000:0", config({ User: "1000:0" }), ["final-user"]],
  ["User by name", config({ User: "node" }), ["final-user"]],
  ["no Config", {}, ["no-config"]],
  ["two images", [config(), config()], ["no-config"]],
];

for (const [name, inspect, expected] of IMAGE_CASES) {
  test(`image config: ${name}`, () => {
    assert.deepEqual(codes(checkImageConfig(inspect)), [...expected].sort());
  });
}

test("--image-config passes a clean config and fails with the finding and name", () => {
  const directory = mkdtempSync(join(tmpdir(), "ductus-image-config-"));
  try {
    const clean = join(directory, "clean.json");
    const dirty = join(directory, "dirty.json");
    writeFileSync(clean, JSON.stringify([config()]));
    writeFileSync(dirty, JSON.stringify([withEnv("DUCTUS_AUTH_PROVIDER=fake-oidc", "DUCTUS_CANARY_TOKEN=x")]));
    const ok = spawnSync(process.execPath, [script, "--image-config", clean], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    const bad = spawnSync(process.execPath, [script, "--image-config", dirty], { encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /local-only-env \(DUCTUS_AUTH_PROVIDER\)/);
    assert.match(bad.stderr, /secret-name \(DUCTUS_CANARY_TOKEN\)/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

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
  const nextConfig = readFileSync(resolve(root, "next.config.ts"), "utf8");
  assert.match(nextConfig, /process\.env\.DUCTUS_NEXT_OUTPUT === "standalone"/);
  assert.match(WEB, /^ENV DUCTUS_NEXT_OUTPUT=standalone$/m);
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

// Known limit: `docker build --build-arg` could override the pinned base. No
// workflow passes one, and CI builds the web image with exactly this command.
test("no workflow passes --build-arg and CI builds the web image without one", () => {
  const workflows = resolve(root, ".github/workflows");
  for (const name of readdirSync(workflows).filter((file) => /\.ya?ml$/.test(file))) {
    assert.doesNotMatch(readFileSync(join(workflows, name), "utf8"), /--build-arg/, `${name} passes --build-arg`);
  }
  const ci = readFileSync(join(workflows, "ci.yml"), "utf8");
  const builds = ci.split("\n").filter((line) => line.includes("web.Dockerfile") && /docker\s+(?:buildx\s+)?build/.test(line));
  assert.deepEqual(builds.map((line) => line.trim()), ["run: docker build -f infra/docker/web.Dockerfile -t ductus-web:ci ."]);
});
