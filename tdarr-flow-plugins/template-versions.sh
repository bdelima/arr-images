#!/usr/bin/env bash
# Prints each flow template's own version as "<file>=<n>" pairs on one line, for the image build (--build-arg
# TEMPLATE_VERSIONS="$(tdarr-flow-plugins/template-versions.sh)"). The version is the number of commits that touched the
# template file, so it goes up by one each time a template is changed and stays put while it is not: a release does not
# rename a template that did not change, and nobody has to remember to bump anything.
#
#   controller.js=12 converter.js=9 ...
#
# Needs the full git history (a shallow clone gives wrong numbers, so it refuses to run on one).
set -euo pipefail

cd "$(dirname "$0")/.."
dir=tdarr-flow-plugins/root/defaults/tdarr-plugins/LocalFlowTemplates/video

if [ "$(git rev-parse --is-shallow-repository)" != false ]; then
  echo "template-versions.sh: this is a shallow clone, the commit counts would be wrong (fetch the full history)" >&2
  exit 1
fi

out=
for f in "$dir"/*.js; do
  n=$(git rev-list --count HEAD -- "$f")
  [ "$n" -gt 0 ] || { echo "template-versions.sh: $f has no commits (is it committed?)" >&2; exit 1; }
  out="$out$(basename "$f")=$n "
done
printf '%s\n' "${out% }"
