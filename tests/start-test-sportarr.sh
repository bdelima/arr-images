#!/usr/bin/env bash
# Start-test for the Sportarr image (called from start-test.sh, which dispatches here for "sportarr").
#
#   tests/start-test-sportarr.sh sportarr IMAGE [EXPECTED_VERSION]
#
# Checks, against the built image:
#   1. the app starts and answers /ping
#   2. through its own API it reports the upstream release version (the overlay still presents itself as upstream)
#   3. the rebuilt Sportarr.dll in the image contains the pre-import validator patch (its log message is in the assembly),
#      so a build that silently lost the patch cannot pass
#
# What it does not do: exercise a queued download. The hold itself needs a download client with a finished
# download; that check is made on a real host (see the README).
#
# Needs: docker, curl, jq, python3. Runs the image on 127.0.0.1 only.
set -euo pipefail

app="${1:?usage: start-test-sportarr.sh sportarr IMAGE [EXPECTED_VERSION]}"
image="${2:?usage: start-test-sportarr.sh sportarr IMAGE [EXPECTED_VERSION]}"
expected_version="${3:-}"
[ "$app" = sportarr ] || { echo "this script is for sportarr only" >&2; exit 2; }

port=1867
work="$(mktemp -d)"
cname="arrtest-sportarr"
apikey=""

cleanup() { docker rm -f "$cname" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  echo "--- container log (tail)"; docker logs "$cname" 2>&1 | tail -80 || true
  exit 1
}

mkdir -p "$work/cfg"
echo "== starting $image"
docker run -d --name "$cname" -e PUID="$(id -u)" -e PGID="$(id -g)" -e TZ=UTC \
  -v "$work/cfg:/config" -p "127.0.0.1:${port}:${port}" "$image" >/dev/null

up=false
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${port}/ping" -o /dev/null 2>/dev/null; then up=true; break; fi
  sleep 2
done
$up || fail "the app did not answer /ping within 180 s"
echo "   ok   /ping answers"

# The API key is generated on first start and kept in config.xml (an environment variable does not set it).
for _ in $(seq 1 30); do
  apikey="$(sed -n 's:.*<ApiKey>\(.*\)</ApiKey>.*:\1:p' "$work/cfg/config.xml" 2>/dev/null | head -n 1 || true)"
  [ -z "$apikey" ] || break
  sleep 2
done
[ -n "$apikey" ] || fail "no ApiKey in config.xml after 60 s"

status=""
for _ in $(seq 1 30); do
  status="$(curl -fsS -H "X-Api-Key: ${apikey}" "http://127.0.0.1:${port}/api/system/status" 2>/dev/null || true)"
  [ -z "$status" ] || break
  sleep 2
done
[ -n "$status" ] || fail "GET /api/system/status returned nothing within 60 s"
reported="$(jq -r '.version // .Version // empty' <<<"$status")"
[ -n "$reported" ] || fail "no version in /api/system/status: ${status}"
echo "   app reports version ${reported}"
if [ -n "$expected_version" ]; then
  case "$reported" in
    "$expected_version"|"$expected_version"[-+.]*) echo "   ok   version matches the upstream release ${expected_version}" ;;
    *) fail "the app reports version '${reported}', expected the upstream release '${expected_version}'" ;;
  esac
fi

docker cp "$cname:/app/Sportarr.dll" "$work/Sportarr.dll" >/dev/null || fail "could not copy /app/Sportarr.dll out of the image"
python3 - "$work/Sportarr.dll" <<'PYEOF' || fail "the pre-import validator patch is not in the shipped Sportarr.dll"
import sys
data = open(sys.argv[1], "rb").read()
# C# string literals are stored as UTF-16 in the assembly's #US heap
needle = "Pre-import check not ready for".encode("utf-16-le")
sys.exit(0 if needle in data else 1)
PYEOF
echo "   ok   the pre-import validator patch is in /app/Sportarr.dll"

echo "PASS: sportarr start-test"
