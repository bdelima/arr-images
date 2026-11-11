#!/usr/bin/env bash
# A flow template's name carries that template's own version, "Controller (0.6.1)". Tdarr treats a flow whose name differs
# as changed, so the version must move when the template's content changes and only then. This check, run on pull requests,
# fails when a flow template differs from the base commit but its name line (the flow-level "name", indented four spaces)
# does not: that edit would reach Tdarr as an unchanged-looking flow. A new template only needs a version in its name.
#
#   tdarr-flow-plugins/check-template-versions.sh <base commit>
set -euo pipefail

base=${1:?usage: check-template-versions.sh <base commit>}
dir=tdarr-flow-plugins/root/defaults/tdarr-plugins/LocalFlowTemplates/video
fail=0

# the text with any CR removed (a Windows checkout may have CRLF line endings)
nocr() { tr -d '\r'; }
name_line() { nocr | grep -E '^    "name": "' || true; }

for f in "$dir"/*.js; do
  now=$(name_line < "$f")
  [ "$(printf '%s\n' "$now" | grep -c .)" = 1 ] || { echo "FAIL: $f: expected exactly one flow-level name line" >&2; fail=1; continue; }
  printf '%s\n' "$now" | grep -qE ' \([0-9]+\.[0-9]+\.[0-9]+\)",$' || { echo "FAIL: $f: the flow name does not end in its version, e.g. \"Controller (0.6.1)\": $now" >&2; fail=1; continue; }
  if ! git cat-file -e "$base:$f" 2>/dev/null; then
    echo "   new  $f"
    continue
  fi
  if [ "$(git show "$base:$f" | nocr)" = "$(nocr < "$f")" ]; then
    continue
  fi
  before=$(git show "$base:$f" | name_line)
  if [ "$before" = "$now" ]; then
    echo "FAIL: $f changed but its version did not: bump the number in its name line: $now" >&2
    fail=1
  else
    echo "   ok   $f changed, version moved:$before  ->$now"
  fi
done
[ "$fail" = 0 ] || exit 1
echo "PASS: every changed flow template carries a new version"
