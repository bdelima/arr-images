#!/usr/bin/env bash
# Start the built image three times with different /config contents and check the scheduled-task intervals
# through the app's own API:
#   1. no scheduled-tasks.properties        -> upstream defaults
#   2. a file overriding several tasks      -> overridden intervals applied, everything else unchanged,
#                                              including a task whose interval comes from the app's config
#   3. a file with bad lines                -> the app still starts, bad lines ignored with warnings,
#                                              the one good line still applied
#   4. the refresh interval set to 0        -> an API request for the Scheduled trigger is refused (400),
#                                              a plain request still works
#
# Scenarios 1 and 2 also post the refresh command through the API twice, with and without
# {"trigger":"scheduled"}, and check the command reports the trigger that was asked for and the look-back
# window the app logged (see ScheduledTaskIntervalOverrides.PrepareScheduledRequest).
#
#   tests/start-test.sh radarr|sonarr|lidarr IMAGE [EXPECTED_VERSION]
#
# With EXPECTED_VERSION (the upstream release the image was built for), also asserts that the running app
# reports exactly that version, i.e. the overlay still presents itself as the upstream release.
#
# Needs: docker, curl, jq. Runs the image on 127.0.0.1 only.
set -euo pipefail

app="${1:?usage: start-test.sh radarr|sonarr|lidarr IMAGE}"
image="${2:?usage: start-test.sh radarr|sonarr|lidarr IMAGE}"
expected_version="${3:-}"

case "$app" in
  radarr) port=7878; api=v3; refresh=RefreshMovie;  refresh_default=1440; other=CleanUpRecycleBin ;;
  sonarr) port=8989; api=v3; refresh=RefreshSeries; refresh_default=720;  other=CleanUpRecycleBin ;;
  lidarr) port=8686; api=v1; refresh=RefreshArtist; refresh_default=1440; other=RescanFolders ;;  # Lidarr's API is v1
  *) echo "unknown app: $app" >&2; exit 2 ;;
esac

work="$(mktemp -d)"
cname=""
scenario=""
apikey=""

cleanup() { [ -z "$cname" ] || docker rm -f "$cname" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

applog() { cat "$work"/cfg/logs/*.txt 2>/dev/null || true; }

fail() {
  echo "FAIL [$scenario]: $*" >&2
  if [ -n "$cname" ]; then
    echo "--- container log (tail)"; docker logs "$cname" 2>&1 | tail -60 || true
    echo "--- app log (tail)"; applog | tail -80 || true
  fi
  exit 1
}

start() {  # start <scenario-name> [properties-file]
  scenario="$1"; local props="${2:-}"
  # Remove the previous container before its config directory: while it still runs it can write into the
  # directory, which made rm fail with "Directory not empty" and ended the whole test with no FAIL message.
  [ -z "$cname" ] || docker rm -f "$cname" >/dev/null 2>&1 || true
  rm -rf "$work/cfg"; mkdir -p "$work/cfg"
  [ -z "$props" ] || cp "$props" "$work/cfg/scheduled-tasks.properties"
  cname="arrtest-${app}-${scenario}"
  echo "== [$scenario] starting $image"
  docker run -d --name "$cname" -e PUID="$(id -u)" -e PGID="$(id -g)" -e TZ=UTC \
    -v "$work/cfg:/config" -p "127.0.0.1:${port}:${port}" "$image" >/dev/null

  # The app writes its API key into config.xml on first start.
  local key=""
  apikey=""
  for _ in $(seq 1 90); do
    key="$(sed -n 's:.*<ApiKey>\(.*\)</ApiKey>.*:\1:p' "$work/cfg/config.xml" 2>/dev/null | head -n 1 || true)"
    [ -z "$key" ] || break
    sleep 2
  done
  [ -n "$key" ] || fail "no ApiKey in config.xml after 180 s (the app did not start)"
  apikey="$key"

  rm -f "$work/status.json"
  for _ in $(seq 1 90); do
    curl -fsS -H "X-Api-Key: $key" "http://127.0.0.1:${port}/api/${api}/system/status" -o "$work/status.json" 2>/dev/null && break
    sleep 2
  done
  [ -s "$work/status.json" ] || fail "the API did not come up after 180 s"

  curl -fsS -H "X-Api-Key: $key" "http://127.0.0.1:${port}/api/${api}/system/task" -o "$work/tasks.json" \
    || fail "GET /api/${api}/system/task failed"
  local reported
  reported="$(jq -r .version "$work/status.json")"
  echo "   app reports version ${reported}"
  if [ -n "$expected_version" ] && [ "$reported" != "$expected_version" ]; then
    fail "the app reports version '${reported}', expected the upstream release '${expected_version}'"
  fi
}

expect() {  # expect <TaskName> <minutes>
  local got
  got="$(jq -r --arg n "$1" '.[] | select(.taskName == $n) | .interval' "$work/tasks.json")"
  [ "$got" = "$2" ] || fail "$1: expected $2 minutes, got '${got:-<task missing>}'"
  echo "   ok   $1 = $2"
}

api() {  # api GET|POST <path> [json-body]: sets $http_code and $resp (not for use inside $(...))
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS -X "$method" -H "X-Api-Key: $apikey" -o "$work/resp.json" -w '%{http_code}')
  [ -z "$body" ] || args+=(-H 'Content-Type: application/json' -d "$body")
  http_code="$(curl "${args[@]}" "http://127.0.0.1:${port}/api/${api}/${path}")" || fail "$method /${path} could not be sent"
  resp="$(cat "$work/resp.json")"
}

# run_command <json-body>: posts a command, waits until it has left the queue, sets $cmd_id and $cmd_trigger.
run_command() {
  api POST command "$1"
  [ "$http_code" = 201 ] || [ "$http_code" = 200 ] || fail "POST command $1 returned HTTP ${http_code}: ${resp}"
  cmd_id="$(jq -r .id <<<"$resp")"
  [ -n "$cmd_id" ] && [ "$cmd_id" != null ] || fail "POST command $1 returned no id: ${resp}"
  local status=""
  for _ in $(seq 1 60); do
    api GET "command/${cmd_id}"
    status="$(jq -r .status <<<"$resp")"
    case "$status" in queued|started) sleep 1 ;; *) break ;; esac
  done
  case "$status" in queued|started) fail "command ${cmd_id} still ${status} after 60 s" ;; esac
  cmd_trigger="$(jq -r .trigger <<<"$resp")"
}

# The same API call with and without the Scheduled trigger.
check_scheduled_request() {  # check_scheduled_request <expected log line>
  run_command "{\"name\":\"${refresh}\"}"
  [ "$cmd_trigger" = manual ] || fail "a plain ${refresh} request reports trigger '${cmd_trigger}', expected manual"
  echo "   ok   ${refresh} without a trigger -> manual"
  run_command "{\"name\":\"${refresh}\",\"trigger\":\"scheduled\"}"
  [ "$cmd_trigger" = scheduled ] || fail "a ${refresh} request with trigger=scheduled reports '${cmd_trigger}', expected scheduled"
  echo "   ok   ${refresh} with trigger=scheduled -> scheduled"
  expect_log "$1"
  local task
  api GET system/task
  task="$(jq -c --arg n "$refresh"  '.[] | select(.taskName == $n) | {lastExecution, nextExecution, interval}' <<<"$resp")"
  echo "   info after the scheduled run: ${task}"
}

expect_log() {  # expect_log <fixed string>
  applog | grep -qF -- "$1" || fail "app log does not contain: $1"
  echo "   ok   log: $1"
}

# ---- 1. no properties file ----------------------------------------------------------------------------
start defaults
expect Housekeeping 1440
expect CheckHealth 360
expect MessagingCleanup 5
expect ImportListSync 5
expect "$other" 1440
expect "$refresh" "$refresh_default"
expect_log "No scheduled-tasks.properties"
if [ "$app" = sonarr ]; then
  check_scheduled_request "Scheduled request for ${refresh}: trigger honored (this task has no look-back)"
else
  check_scheduled_request "Scheduled request for ${refresh}: trigger honored, look-back 1445 minutes (interval ${refresh_default} + 5)"
fi

# ---- 2. overrides: every kind of task ------------------------------------------------------------------
cat > "$work/overrides.properties" <<EOF
# comment line
! another comment

Housekeeping=0
checkhealth = 720
RefreshMonitoredDownloads=60
Backup=43200
${refresh}=10080
ScheduledLookback.${refresh}=600
EOF
start overrides "$work/overrides.properties"
expect Housekeeping 0                 # 0 disables the task's own schedule
expect CheckHealth 720                # key matching is case-insensitive; spaces around = are fine
expect RefreshMonitoredDownloads 60   # an interval the app derives from its own config
expect Backup 43200                   # likewise
expect "$refresh" 10080
expect MessagingCleanup 5             # not mentioned: unchanged
expect ImportListSync 5
expect "$other" 1440
expect_log "Scheduled task Housekeeping: interval 1440 -> 0"
if [ "$app" = sonarr ]; then
  # Sonarr has no changed list, so the look-back line is a warning there and the request is plain.
  expect_log "does not use a changed list"
  check_scheduled_request "Scheduled request for ${refresh}: trigger honored (this task has no look-back)"
else
  check_scheduled_request "Scheduled request for ${refresh}: trigger honored, look-back 600 minutes (ScheduledLookback.${refresh})"
fi

# ---- 3. bad lines --------------------------------------------------------------------------------------
cat > "$work/bad.properties" <<EOF
this line has no equals sign
Housekeeping=-5
${other}=abc
NoSuchTask=5
CheckHealth=720
ScheduledLookback.Housekeeping=60
ScheduledLookback.${refresh}=abc
ScheduledLookback.NoSuchTask=5
EOF
start bad "$work/bad.properties"
expect CheckHealth 720                # the good line still applies
expect Housekeeping 1440              # bad values are ignored, upstream default stays
expect "$other" 1440
expect_log "unknown task 'NoSuchTask'"
expect_log "is not a whole number of minutes"
expect_log "does not use a changed list"
expect_log "unknown task 'NoSuchTask'"
expect_log "expected Name=minutes"

# ---- 4. a disabled task refuses a Scheduled request ------------------------------------------------------
cat > "$work/disabled.properties" <<EOF
${refresh}=0
EOF
start disabled "$work/disabled.properties"
expect "$refresh" 0
api POST command "{\"name\":\"${refresh}\",\"trigger\":\"scheduled\"}"
[ "$http_code" = 400 ] || fail "a scheduled ${refresh} request with its interval at 0 returned HTTP ${http_code}, expected 400: ${resp}"
echo "   ok   scheduled ${refresh} with interval 0 -> HTTP 400"
api GET command
queued="$(jq --arg n "$refresh" '[.[] | select(.name == $n and .trigger == "scheduled")] | length' <<<"$resp")"
[ "$queued" = 0 ] || fail "the refused request left ${queued} scheduled ${refresh} command(s) in the queue"
echo "   ok   nothing was queued"
run_command "{\"name\":\"${refresh}\"}"
[ "$cmd_trigger" = manual ] || fail "a plain ${refresh} request reports trigger '${cmd_trigger}', expected manual"
echo "   ok   a plain ${refresh} request still runs"

echo "PASS: $app start-test (4 scenarios)"
