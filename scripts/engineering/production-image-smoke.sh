#!/usr/bin/env bash
# Checks a built production web image (DAN-298, attack plan #1687) without
# pushing it: its config (docker image inspect) read by production-image.mjs
# --image-config, with no local-only or secret ENV name, NODE_ENV=production and a
# numeric non-root user, and a negative image that must fail it; built on the
# pinned base, no local-only or
# secret file and no secret (gitleaks) in any layer the build adds, its history
# or config, with planted canaries and a copied-then-deleted secret as negative
# controls, and at run time the local login refused (D-09) while the process
# serves /api/health. DAN-185 (M11.9-P02): every file the running image serves
# is fetched over HTTP and holds no source map, reference or SourceMap header
# and no secret, with a planted map and canary as negative control; Syft writes
# the CycloneDX SBOM of the image, checked against its layers and copied to
# <sbom-dir> when given. Usage: production-image-smoke.sh <image> [<sbom-dir>]
set -euo pipefail
# A failure inside "$(...)", as in start(), stops the script too.
shopt -s inherit_errexit

image="${1:?usage: production-image-smoke.sh <image> [<sbom-dir>]}"
sbom_out="${2:-}"
syft_image="ghcr.io/anchore/syft:v1.55.0@sha256:4cc92b64ca74ffca4c94d4c8fcc01f217731375300be14d0b6eeb2e82eaa110a"
gitleaks_image="ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ductus-image.XXXXXX")"
negative="ductus-image-negative:$$"
served_negative="ductus-image-served-negative:$$"
cleanup() {
  # start() runs in a command substitution and records its containers here.
  if [ -f "$work/containers" ]; then
    while read -r c; do docker rm -f "$c" >/dev/null 2>&1 || true; done < "$work/containers"
  fi
  docker image rm "$negative" "$served_negative" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
fail() { echo "::error::$*" >&2; exit 1; }

guard="$repo/scripts/engineering/production-image.mjs"
bundle="$repo/scripts/engineering/served-bundle.mjs"

# 1. The config of the built image: no local-only or secret ENV name,
# NODE_ENV=production, numeric non-root user. The same rules as the static check.
docker image inspect "$image" > "$work/config.json"
node "$guard" --image-config "$work/config.json" || fail "image config of $image failed the check"
user="$(docker image inspect --format '{{.Config.User}}' "$image")"
echo "config: user $user, no local-only or secret ENV name, NODE_ENV=production"

# 2. Layers. The image must start with exactly the layers of the pinned base
# (its digest is in the Dockerfile); every layer the build adds is unpacked on
# its own, so a file deleted by a later layer is still read.
base="$(sed -n 's/^ARG WEB_BASE_IMAGE=//p' "$repo/infra/docker/web.Dockerfile")"
[ -n "$base" ] || fail "no WEB_BASE_IMAGE in web.Dockerfile"
docker image inspect "$base" >/dev/null 2>&1 || docker pull -q "$base" >/dev/null
# Unpacks the layers <image> adds on top of <parent> into <dir>/<index>.
unpack() {
  local archive="$work/save" count
  rm -rf "$archive" && mkdir -p "$archive" "$3"
  docker image save "$1" | tar -x -C "$archive"
  docker image inspect --format '{{json .RootFS.Layers}}' "$2" > "$archive/parent.json"
  docker image inspect --format '{{json .RootFS.Layers}}' "$1" > "$archive/image.json"
  count="$(python3 -I - "$archive" <<'PY2'
import json, sys
root = sys.argv[1]
parent = json.load(open(f"{root}/parent.json"))
layers = json.load(open(f"{root}/image.json"))
blobs = json.load(open(f"{root}/manifest.json"))[0]["Layers"]
if len(blobs) != len(layers) or layers[: len(parent)] != parent:
    sys.exit("the image does not start with the layers of its parent")
with open(f"{root}/added.txt", "w") as out:
    out.writelines(f"{blob}\n" for blob in blobs[len(parent):])
print(len(blobs) - len(parent))
PY2
)" || fail "$1 is not built on $2"
  local index=0
  while read -r blob; do
    mkdir "$3/$index" && tar -x -f "$archive/$blob" -C "$3/$index"
    index=$((index + 1))
  done < "$archive/added.txt"
  chmod -R u+rwX "$3" && rm -rf "$archive"
  echo "$count"
}
# Paths that must not be in any layer, anywhere in the file system.
forbidden() {
  (cd "$1" && find . \( -name '.env*' -o -name '.git' -o -name '.npmrc' -o -path '*fake-oidc*' \
    -o -path './*/app/infra*' -o -name '*.test.*' -o -name '*.fixture.*' \) -print)
}
scan() {
  docker run --rm --user "$(id -u):$(id -g)" -v "$1:/scan:ro" -v "$work:/out" \
    -v "$repo/infra/docker/image-gitleaks.toml:/gitleaks.toml:ro" "$gitleaks_image" \
    dir --config /gitleaks.toml --redact --no-banner --exit-code 3 \
    --report-format json --report-path "/out/$2.json" /scan
}
layers="$work/layers"
added="$(unpack "$image" "$base" "$layers")"
echo "layers: built on $base, $added added layers unpacked"

# 3. Files and secrets in every added layer, its history and its config.
found="$(forbidden "$layers")"
[ -z "$found" ] || fail "forbidden files in image layers: $found"
manifest="$(cd "$layers" && find . -path './*/app/.next/server/middleware-manifest.json' -print -quit)"
[ -n "$(cd "$layers" && find . -path './*/app/server.js' -print -quit)" ] && [ -n "$manifest" ] \
  || fail "app/server.js or the middleware manifest missing: the layers hold no application"
mkdir "$layers/meta"
docker history --no-trunc --format '{{.CreatedBy}}' "$image" > "$layers/meta/history.txt"
docker image inspect "$image" > "$layers/meta/inspect.json"
status=0; scan "$layers" clean || status=$?
[ "$status" -eq 0 ] || fail "gitleaks found secrets in the image layers or did not run (exit $status)"
echo "files and secrets: none in $(find "$layers" -type f | wc -l) files of the added layers"

# Negative controls. Two canaries in a manifest the exception covers: another
# key name, and a Next.js key name with a value of the wrong form.
canary="$(od -An -N20 -tx1 /dev/urandom | tr -d ' \n')"
printf '\n"DUCTUS_CANARY_API_KEY": "%s"\n"__NEXT_PREVIEW_MODE_SIGNING_KEY": "%s"\n' "$canary" "$canary" >> "$layers/$manifest"
status=0; scan "$layers" canary || status=$?
[ "$status" -eq 3 ] || fail "gitleaks missed the canaries (exit $status)"
# A secret and an .env file copied, then deleted by a later layer: invisible
# in the running image, but each must still be found in its layer.
mkdir "$work/negative"
printf '"DUCTUS_CANARY_API_KEY": "%s"\n' "$canary" > "$work/negative/leak.txt"
# It also sets a local-only and a secret-like ENV name: its config must fail with both.
printf '%s\n' "FROM $image" "USER 0:0" "COPY leak.txt /opt/ductus-leak/key.txt" "COPY leak.txt /app/.env.leak" \
  "RUN rm -rf /opt/ductus-leak /app/.env.leak" "USER $user" \
  "ENV DUCTUS_AUTH_PROVIDER=fake-oidc DUCTUS_CANARY_TOKEN=x" > "$work/negative/Dockerfile"
docker build -q -t "$negative" "$work/negative" >/dev/null
docker image inspect "$negative" > "$work/negative.json"
status=0; node "$guard" --image-config "$work/negative.json" > "$work/negative.log" 2>&1 || status=$?
[ "$status" -eq 1 ] && grep -q 'local-only-env (DUCTUS_AUTH_PROVIDER)' "$work/negative.log" \
  && grep -q 'secret-name (DUCTUS_CANARY_TOKEN)' "$work/negative.log" \
  || { cat "$work/negative.log" >&2; fail "the image config check passed a local-only or secret ENV name (exit $status)"; }
unpack "$negative" "$image" "$work/deleted" >/dev/null
[ -n "$(cd "$work/deleted" && find . -name '.wh.ductus-leak' -print -quit)" ] || fail "the negative control deleted nothing"
forbidden "$work/deleted" | grep -q '/app/\.env\.leak$' || fail "a deleted .env file was not found in its layer"
status=0; scan "$work/deleted" deleted || status=$?
[ "$status" -eq 3 ] || fail "gitleaks missed the deleted secret (exit $status)"
python3 -I - "$work/canary.json" "$work/deleted.json" <<'PY2' || fail "canary findings not reported as expected"
import json, sys
canary = json.load(open(sys.argv[1], encoding="utf-8"))
deleted = json.load(open(sys.argv[2], encoding="utf-8"))
ok = (
    len(canary) == 2 and all(f["File"].endswith("middleware-manifest.json") for f in canary)
    and sorted(f["File"].split("/", 3)[-1] for f in deleted) == ["app/.env.leak", "opt/ductus-leak/key.txt"]
)
sys.exit(0 if ok else f"unexpected findings: {len(canary)} canary, {len(deleted)} deleted")
PY2
echo "negative controls: both manifest canaries, the copied-then-deleted secret and .env, and the local-only and secret ENV names found"

# 4. SBOM of the image as built (Syft, CycloneDX), tied to the image's layers;
# a copy without the next component must fail the same check.
sbom="$work/sbom"
mkdir -p "$sbom/tmp"
docker image save -o "$sbom/image.tar" "$image"
docker run --rm --user "$(id -u):$(id -g)" -e SYFT_CHECK_FOR_APP_UPDATE=false -e HOME=/work/tmp -e TMPDIR=/work/tmp \
  -v "$sbom:/work" "$syft_image" scan -q docker-archive:/work/image.tar -o cyclonedx-json=/work/sbom.cdx.json
rm -f "$sbom/image.tar"
docker image inspect --format '{{json .RootFS.Layers}}' "$image" > "$sbom/layers.json"
docker image inspect --format '{{json .RootFS.Layers}}' "$base" > "$sbom/base.json"
node "$repo/scripts/engineering/image-sbom.mjs" "$sbom/sbom.cdx.json" "$sbom/layers.json" "$sbom/base.json" \
  || fail "the SBOM of $image failed the check"
node -e 'const fs = require("node:fs"); const bom = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
bom.components = bom.components.filter((c) => !String(c.purl).startsWith("pkg:npm/next@"));
fs.writeFileSync(process.argv[2], JSON.stringify(bom));' "$sbom/sbom.cdx.json" "$sbom/no-next.json"
status=0; node "$repo/scripts/engineering/image-sbom.mjs" "$sbom/no-next.json" "$sbom/layers.json" "$sbom/base.json" \
  > "$sbom/no-next.log" 2>&1 || status=$?
[ "$status" -eq 1 ] && grep -q 'sbom-app' "$sbom/no-next.log" \
  || { cat "$sbom/no-next.log" >&2; fail "the SBOM check passed an SBOM without next (exit $status)"; }
if [ -n "$sbom_out" ]; then mkdir -p "$sbom_out" && cp "$sbom/sbom.cdx.json" "$sbom_out/sbom.cdx.json"; fi
echo "sbom: CycloneDX of $image checked against its layers; a copy without next fails"

# 5. Run time. Without a database URL the image has no default and stops.
status=0; docker run --rm --read-only "$image" > "$work/bare.log" 2>&1 || status=$?
[ "$status" -ne 0 ] && grep -q 'APP_DATABASE_URL' "$work/bare.log" \
  || { cat "$work/bare.log" >&2; fail "image started without APP_DATABASE_URL (exit $status)"; }
echo "run time: refuses to start without APP_DATABASE_URL"

# Starts <image> locked down, with the local login configured on purpose and the
# local-only database URL of .env.example; no database answers, /api/health
# reads none. Prints the address it serves at once /api/health answers 200.
start() {
  local id port
  id="$(docker run -d --read-only --tmpfs /tmp --tmpfs /app/.next/cache:uid=1000,gid=1000 \
  --cap-drop ALL --security-opt no-new-privileges -p 127.0.0.1::3000 \
  -e APP_DATABASE_URL=postgres://ductus_app_local:ductus-app-local-only@127.0.0.1:54329/ductus \
  -e NODE_ENV=development -e DUCTUS_AUTH_PROVIDER=fake-oidc -e OIDC_ISSUER=http://localhost:8090 \
  -e OIDC_CLIENT_ID=ductus-local -e OIDC_CLIENT_SECRET=ductus-local-only \
  -e OIDC_REDIRECT_URI=http://localhost:3000/api/auth/callback "$1")"
  echo "$id" >> "$work/containers"
  port="$(docker port "$id" 3000/tcp | head -n1 | sed 's/.*://')"
  curl -fsS --noproxy "*" --retry 60 --retry-delay 1 --retry-all-errors -o /dev/null "http://127.0.0.1:$port/api/health" \
    || { docker logs "$id" >&2; fail "/api/health of $1 did not answer 200"; }
  echo "http://127.0.0.1:$port"
}
site="$(start "$image")"
container="$(tail -n1 "$work/containers")"
[ "$(docker exec "$container" id -u)" = "${user%%:*}" ] || fail "process does not run as $user"
login="$(curl -sS --noproxy "*" -o /dev/null -w '%{http_code}' "$site/api/auth/login")"
[ "$login" = "503" ] || { docker logs "$container" >&2; fail "/api/auth/login answered $login, not 503 (D-09)"; }
echo "run time: /api/health 200, /api/auth/login 503 with fake-oidc and NODE_ENV=development set"

# 6. Served files. Every file under the two served roots is fetched from the
# running container into <dir>: body, headers, status, and the status of
# "<URL>.map" next to each script, stylesheet and WebAssembly module
# (index.tsv, served-bundle.mjs).
fetch() {
  local n=0 url code map
  mkdir -p "$3/body" "$3/head"
  docker exec "$1" find /app/.next/static /app/public -type f > "$3/paths.txt"
  node "$bundle" urls < "$3/paths.txt" > "$3/urls.txt" || fail "a served file outside the served roots"
  : > "$3/index.tsv"
  while read -r url; do
    n=$((n + 1))
    code="$(curl -sS --noproxy "*" -o "$3/body/$n" -D "$3/head/$n" -w '%{http_code}' "$2$url")"
    map="-"
    case "$url" in *.js | *.mjs | *.css | *.wasm) map="$(curl -sS --noproxy "*" -o /dev/null -w '%{http_code}' "$2$url.map")" ;; esac
    printf '%s\t%s\t%s\n' "$url" "$code" "$map" >> "$3/index.tsv"
  done < "$3/urls.txt"
}
fetch "$container" "$site" "$work/served"
node "$bundle" check "$work/served" || fail "the served files of $image carry a source map or failed to load"
status=0; scan "$work/served/body" served || status=$?
[ "$status" -eq 0 ] || fail "gitleaks found secrets in the served files or did not run (exit $status)"
echo "served: $(wc -l < "$work/served/index.tsv") files fetched, no source map, reference, SourceMap header or secret"

# Negative control: a chunk with a map reference, its map and a secret, a
# public stylesheet with an inline map, and a public WebAssembly module whose
# sourceMappingURL custom section holds an inline map, all on one server. A
# clean module next to it (only a name section) must pass.
mkdir "$work/served-negative"
printf 'self.ductusCanary=1;\n"DUCTUS_CANARY_API_KEY": "%s"\n//# sourceMappingURL=ductus-canary.js.map\n' "$canary" \
  > "$work/served-negative/ductus-canary.js"
printf '{"version":3,"sources":[],"mappings":""}\n' > "$work/served-negative/ductus-canary.js.map"
printf 'a{b:c}\n/*# sourceMappingURL=data:application/json;base64,e30= */\n' > "$work/served-negative/ductus-canary.css"
# Header and version, then section 0 (51 bytes): name (16) and the URL (33).
printf '\0asm\1\0\0\0\0\063\020sourceMappingURL\041data:application/json;base64,e30=' \
  > "$work/served-negative/ductus-canary.wasm"
printf '\0asm\1\0\0\0\0\010\004name\001\001\0' > "$work/served-negative/ductus-clean.wasm"
printf '%s\n' "FROM $image" "COPY ductus-canary.js ductus-canary.js.map /app/.next/static/chunks/" \
  "COPY ductus-canary.css ductus-canary.wasm ductus-clean.wasm /app/public/" > "$work/served-negative/Dockerfile"
docker build -q -t "$served_negative" "$work/served-negative" >/dev/null
negative_site="$(start "$served_negative")"
fetch "$(tail -n1 "$work/containers")" "$negative_site" "$work/served-planted"
status=0; node "$bundle" check "$work/served-planted" > "$work/served-planted.log" 2>&1 || status=$?
[ "$status" -eq 1 ] \
  && grep -q '^/_next/static/chunks/ductus-canary\.js: source-map-reference' "$work/served-planted.log" \
  && grep -q '^/_next/static/chunks/ductus-canary\.js: source-map-served' "$work/served-planted.log" \
  && grep -q '^/_next/static/chunks/ductus-canary\.js\.map: source-map-file' "$work/served-planted.log" \
  && grep -q '^/ductus-canary\.css: source-map-reference' "$work/served-planted.log" \
  && grep -q '^/ductus-canary\.wasm: source-map-reference' "$work/served-planted.log" \
  && grep -qxF "$(printf '/ductus-clean.wasm\t200\t404')" "$work/served-planted/index.tsv" \
  && ! grep -q '^/ductus-clean\.wasm:' "$work/served-planted.log" \
  || { cat "$work/served-planted.log" >&2; fail "the served-file check missed a planted source map (exit $status)"; }
status=0; scan "$work/served-planted/body" served-planted || status=$?
[ "$status" -eq 3 ] || fail "gitleaks missed the canary in a served file (exit $status)"
echo "served negative control: the planted map, all three references and the served canary found, the clean module passes"
echo "Production image OK: $image"
