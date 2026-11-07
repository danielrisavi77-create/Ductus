#!/usr/bin/env bash
# Checks a built production web image (DAN-298, attack plan #1687) without
# pushing it: numeric non-root user, no local-only or secret files, no secret
# in its files, history or config (gitleaks, with a planted canary as negative
# control), and at run time the local login refused (D-09) while the process
# serves /api/health. Usage: production-image-smoke.sh <image>
set -euo pipefail

image="${1:?usage: production-image-smoke.sh <image>}"
gitleaks_image="ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ductus-image.XXXXXX")"
container=""
cleanup() {
  if [ -n "$container" ]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
  rm -rf "$work"
}
trap cleanup EXIT
fail() { echo "::error::$*" >&2; exit 1; }

# 1. The final user is numeric and not root.
user="$(docker image inspect --format '{{.Config.User}}' "$image")"
[[ "$user" =~ ^[1-9][0-9]*(:[1-9][0-9]*)?$ ]] || fail "image user is '$user', not a numeric non-root user"
echo "user: $user"

# 2. Files: nothing local-only, secret or from the repository's tooling.
created="$(docker create "$image")"
mkdir "$work/files"
docker export "$created" | tar -x -C "$work/files" app
docker rm "$created" >/dev/null
forbidden="$(cd "$work/files" && find app \( -name '.env*' -o -name '.git' -o -name '.npmrc' -o -path '*fake-oidc*' -o -path 'app/infra*' -o -name '*.test.*' -o -name '*.fixture.*' \) -print)"
[ -z "$forbidden" ] || fail "forbidden files in image: $forbidden"
[ -f "$work/files/app/server.js" ] || fail "app/server.js missing: the export found no application"
echo "files: $(find "$work/files/app" -type f | wc -l) under /app, none forbidden"

# 3. Secrets: files, layer history and config, then a canary that must be found.
docker history --no-trunc --format '{{.CreatedBy}}' "$image" > "$work/files/history.txt"
docker image inspect "$image" > "$work/files/inspect.json"
scan() {
  docker run --rm --user "$(id -u):$(id -g)" -v "$work/files:/scan:ro" -v "$work:/out" \
    -v "$repo/infra/docker/image-gitleaks.toml:/gitleaks.toml:ro" "$gitleaks_image" \
    dir --config /gitleaks.toml --redact --no-banner --exit-code 3 \
    --report-format json --report-path "/out/$1.json" /scan
}
status=0; scan clean || status=$?
[ "$status" -eq 0 ] || fail "gitleaks found secrets in the image or did not run (exit $status)"
manifest="$work/files/app/.next/server/middleware-manifest.json"
[ -f "$manifest" ] || fail "middleware manifest missing: the allowlisted path no longer exists"
# Two canaries in a manifest the exception covers: another key name, and a
# Next.js key name with a value of the wrong form. Both must be reported.
canary="$(od -An -N20 -tx1 /dev/urandom | tr -d ' \n')"
printf '\n"DUCTUS_CANARY_API_KEY": "%s"\n"__NEXT_PREVIEW_MODE_SIGNING_KEY": "%s"\n' "$canary" "$canary" >> "$manifest"
status=0; scan canary || status=$?
[ "$status" -eq 3 ] || fail "gitleaks missed the canaries (exit $status)"
python3 -I - "$work/canary.json" <<'PY' || fail "canary findings not reported as expected"
import json, sys
findings = json.load(open(sys.argv[1], encoding="utf-8"))
lines = sorted(f["StartLine"] for f in findings if f["File"].endswith("middleware-manifest.json"))
sys.exit(0 if len(findings) == 2 and len(lines) == 2 else f"unexpected findings: {len(findings)}")
PY
echo "secrets: none; both canaries next to the allowed keys found"

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
