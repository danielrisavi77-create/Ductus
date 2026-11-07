#!/usr/bin/env bash
# Checks a built production web image (DAN-298, attack plan #1687) without
# pushing it: its config (docker image inspect) read by production-image.mjs
# --image-config, with no local-only or secret ENV name, NODE_ENV=production and a
# numeric non-root user, and a negative image that must fail it; built on the
# pinned base, no local-only or
# secret file and no secret (gitleaks) in any layer the build adds, its history
# or config, with planted canaries and a copied-then-deleted secret as negative
# controls, and at run time the local login refused (D-09) while the process
# serves /api/health. Usage: production-image-smoke.sh <image>
set -euo pipefail

image="${1:?usage: production-image-smoke.sh <image>}"
gitleaks_image="ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ductus-image.XXXXXX")"
container=""
negative="ductus-image-negative:$$"
cleanup() {
  if [ -n "$container" ]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
  docker image rm "$negative" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
fail() { echo "::error::$*" >&2; exit 1; }

guard="$repo/scripts/engineering/production-image.mjs"

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

# 4. Run time. Without a database URL the image has no default and stops.
status=0; docker run --rm --read-only "$image" > "$work/bare.log" 2>&1 || status=$?
[ "$status" -ne 0 ] && grep -q 'APP_DATABASE_URL' "$work/bare.log" \
  || { cat "$work/bare.log" >&2; fail "image started without APP_DATABASE_URL (exit $status)"; }
echo "run time: refuses to start without APP_DATABASE_URL"

# Locked down, with the local login configured on purpose and the local-only
# database URL of .env.example; no database answers, /api/health reads none.
container="$(docker run -d --read-only --tmpfs /tmp --tmpfs /app/.next/cache:uid=1000,gid=1000 \
  --cap-drop ALL --security-opt no-new-privileges -p 127.0.0.1::3000 \
  -e APP_DATABASE_URL=postgres://ductus_app_local:ductus-app-local-only@127.0.0.1:54329/ductus \
  -e NODE_ENV=development -e DUCTUS_AUTH_PROVIDER=fake-oidc -e OIDC_ISSUER=http://localhost:8090 \
  -e OIDC_CLIENT_ID=ductus-local -e OIDC_CLIENT_SECRET=ductus-local-only \
  -e OIDC_REDIRECT_URI=http://localhost:3000/api/auth/callback "$image")"
port="$(docker port "$container" 3000/tcp | head -n1 | sed 's/.*://')"
base="http://127.0.0.1:$port"
curl -fsS --noproxy "*" --retry 60 --retry-delay 1 --retry-all-errors -o /dev/null "$base/api/health" \
  || { docker logs "$container" >&2; fail "/api/health did not answer 200"; }
[ "$(docker exec "$container" id -u)" = "${user%%:*}" ] || fail "process does not run as $user"
login="$(curl -sS --noproxy "*" -o /dev/null -w '%{http_code}' "$base/api/auth/login")"
[ "$login" = "503" ] || { docker logs "$container" >&2; fail "/api/auth/login answered $login, not 503 (D-09)"; }
echo "run time: /api/health 200, /api/auth/login 503 with fake-oidc and NODE_ENV=development set"
echo "Production image OK: $image"
