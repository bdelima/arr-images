#!/usr/bin/env bash
# Checks scripts/ci-changes.sh: which of ci.yml's jobs a given set of changed files turns on.
#   tests/test-ci-changes.sh
set -euo pipefail
cd "$(dirname "$0")/.."

fails=0
expect() { # description, expected output (one line per output), then the changed files on stdin
  local want=$1 got
  got=$(scripts/ci-changes.sh --classify | tr '\n' ' ')
  if [ "$got" = "$want " ]; then echo "   ok   $2"; else echo "FAIL: $2" >&2; echo "   want: $want" >&2; echo "   got:  $got" >&2; fails=1; fi
}
none='apps=[] validator=false vmaf=false dovi=false flowplugins=false'

printf 'tdarr-vmaf-cuda/Dockerfile\n' | expect 'apps=[] validator=false vmaf=true dovi=false flowplugins=false' "a vmaf change builds only vmaf"
printf 'tdarr-dovi-tool/VERSION\n' | expect 'apps=[] validator=false vmaf=false dovi=true flowplugins=false' "a dovi change builds only dovi"
printf 'tdarr-flow-plugins/root/defaults/x.js
' | expect 'apps=[] validator=false vmaf=false dovi=false flowplugins=true' "a flow-plugins change builds only flow-plugins"
printf 'tdarr-download-validator/validator.py\n' | expect 'apps=[] validator=true vmaf=false dovi=false flowplugins=false' "a validator change builds only the validator"
printf 'sportarr/patches/02-x.patch\n' | expect 'apps=["sportarr"] validator=false vmaf=false dovi=false flowplugins=false' "a sportarr change builds only sportarr"
printf 'radarr/patches/05-x.patch\nsonarr/Dockerfile\n' | expect 'apps=["radarr","sonarr"] validator=false vmaf=false dovi=false flowplugins=false' "two apps"
printf 'common/PreImportValidator.cs\n' | expect 'apps=["radarr","sonarr","lidarr"] validator=false vmaf=false dovi=false flowplugins=false' "common builds radarr, sonarr and lidarr, not sportarr"
printf 'tests/start-test.sh\n' | expect 'apps=["radarr","sonarr","lidarr","sportarr"] validator=false vmaf=false dovi=false flowplugins=false' "the start-tests build every app"
printf 'scripts/resolve-upstream.sh\n' | expect 'apps=["radarr","sonarr","lidarr","sportarr"] validator=false vmaf=false dovi=false flowplugins=false' "the upstream resolver builds every app"
printf '.github/workflows/ci.yml\n' | expect 'apps=["radarr","sonarr","lidarr","sportarr"] validator=true vmaf=true dovi=true flowplugins=true' "a workflow change builds everything"
printf 'scripts/ci-changes.sh\n' | expect 'apps=["radarr","sonarr","lidarr","sportarr"] validator=true vmaf=true dovi=true flowplugins=true' "a change to this script builds everything"
printf 'README.md\ndocs/x.md\n' | expect "$none" "docs alone build nothing"
printf 'tdarr-vmaf-cuda/a\ntdarr-dovi-tool/b\nlidarr/c\n' | expect 'apps=["lidarr"] validator=false vmaf=true dovi=true flowplugins=false' "a mix"
: | expect "$none" "an empty change builds nothing"

# no commit range to compare -> everything
got=$(EVENT=workflow_dispatch scripts/ci-changes.sh 2>/dev/null | tr '\n' ' ')
[ "$got" = 'apps=["radarr","sonarr","lidarr","sportarr"] validator=true vmaf=true dovi=true flowplugins=true ' ] \
  && echo "   ok   a manual run builds everything" || { echo "FAIL: manual run: $got" >&2; fails=1; }
got=$(EVENT=push BASE=0000000000000000000000000000000000000000 HEAD=abc scripts/ci-changes.sh 2>/dev/null | tr '\n' ' ')
[ "$got" = 'apps=["radarr","sonarr","lidarr","sportarr"] validator=true vmaf=true dovi=true flowplugins=true ' ] \
  && echo "   ok   a new branch (all-zero base) builds everything" || { echo "FAIL: new branch: $got" >&2; fails=1; }
got=$(EVENT=pull_request BASE=deadbeef HEAD=cafebabe scripts/ci-changes.sh 2>/dev/null | tr '\n' ' ')
[ "$got" = 'apps=["radarr","sonarr","lidarr","sportarr"] validator=true vmaf=true dovi=true flowplugins=true ' ] \
  && echo "   ok   commits that cannot be compared build everything" || { echo "FAIL: bad range: $got" >&2; fails=1; }

[ "$fails" = 0 ] && echo "PASS: ci-changes tests" || exit 1
