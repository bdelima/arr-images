#!/usr/bin/env bash
# Decides which of ci.yml's jobs a change needs, so a pull request only builds the images it can affect.
#
#   scripts/ci-changes.sh                      changed files from git (BASE..HEAD), results as GitHub step outputs
#   scripts/ci-changes.sh --classify < files   the same decision for a list of file names on stdin (used by the test)
#
# Environment for the git mode: EVENT (the workflow event name), BASE and HEAD (commits to compare). Whenever the
# comparison cannot be made (a manual run, a new branch, a commit that is not here) every job is turned on: building too
# much is the safe mistake, building too little is not.
#
# Outputs: apps (JSON array of radarr/sonarr/lidarr/sportarr to build), validator, vmaf, dovi (true/false).
set -euo pipefail

classify() {
  local all=false apps_all=false radarr=false sonarr=false lidarr=false sportarr=false validator=false vmaf=false dovi=false f
  if [ "${1:-}" = "all" ]; then all=true; fi

  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in
      radarr/*)                    radarr=true ;;
      sonarr/*)                    sonarr=true ;;
      lidarr/*)                    lidarr=true ;;
      sportarr/*)                  sportarr=true ;;
      # the shared source files are copied into radarr, sonarr and lidarr (sportarr has its own copy)
      common/*)                    radarr=true; sonarr=true; lidarr=true ;;
      # the upstream resolver and the start-tests are used by every app build
      scripts/resolve-upstream.sh|tests/*) apps_all=true ;;
      tdarr-download-validator/*)  validator=true ;;
      tdarr-vmaf-cuda/*)           vmaf=true ;;
      tdarr-dovi-tool/*)           dovi=true ;;
      # this file and the workflow itself can change anything
      scripts/ci-changes.sh|.github/workflows/ci.yml) all=true ;;
    esac
  done

  if $all; then apps_all=true; validator=true; vmaf=true; dovi=true; fi
  if $apps_all; then radarr=true; sonarr=true; lidarr=true; sportarr=true; fi

  local apps="" a
  for a in radarr sonarr lidarr sportarr; do
    if [ "${!a}" = true ]; then apps="${apps:+$apps,}\"$a\""; fi
  done
  echo "apps=[$apps]"
  echo "validator=$validator"
  echo "vmaf=$vmaf"
  echo "dovi=$dovi"
}

if [ "${1:-}" = "--classify" ]; then
  classify < /dev/stdin
  exit 0
fi

zeros=0000000000000000000000000000000000000000
if [ "${EVENT:-}" = "workflow_dispatch" ] || [ -z "${BASE:-}" ] || [ "${BASE:-}" = "$zeros" ] || [ -z "${HEAD:-}" ]; then
  echo "building everything (${EVENT:-no event}, no commit range to compare)" >&2
  echo -n | classify all
  exit 0
fi

if files=$(git diff --name-only "$BASE...$HEAD" 2>/dev/null); then
  echo "changed files:" >&2
  echo "$files" | sed 's/^/  /' >&2
  echo "$files" | classify
else
  echo "could not compare $BASE...$HEAD; building everything" >&2
  echo -n | classify all
fi
