#!/usr/bin/env bash
# What can be checked without a Tdarr server: the image holds exactly the expected trees, every shipped file is
# byte-identical to its source in the repo and passes `node --check`, the s6 files are what LinuxServer's mod loader
# expects, and the start-up script copies each file at the right depth, owner and mode, follows the copy rule
# (missing -> install, identical -> leave, different -> replace and log, nothing else touched) and is safe to run twice.
#
# What this cannot check: that Tdarr loads the plugins, that a flow made from a template file keeps its ids, and that the
# s6 service runs before the Tdarr server starts. Those need a real Tdarr server; see the README.
#
#   tdarr-flow-plugins/smoke-test.sh <overlay image>
set -euo pipefail

image=${1:?usage: smoke-test.sh <overlay image>}
fail() { echo "FAIL: $*" >&2; exit 1; }
cd "$(dirname "$0")/.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# the release version the image was built with
version=$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$image")
[ -n "$version" ] || fail "the image has no org.opencontainers.image.version label"

cid=$(docker create "$image" /bin/true)
docker cp "$cid:/defaults" "$work/defaults"
docker cp "$cid:/etc" "$work/etc"
docker cp "$cid:/usr/share/doc/tdarr-flow-plugins" "$work/doc"
docker rm "$cid" >/dev/null


# 1. exactly the expected trees: the image holds the repo's root/ tree plus the docs, nothing else
expected=$(cd tdarr-flow-plugins/root && find . -type f -o -type l | sort)
# docker adds hostname, hosts and resolv.conf to every container's /etc; they are not the image's
actual=$(cd "$work" && find defaults etc -type f | sed 's|^|./|' | grep -vxE './etc/(hostname|hosts|resolv.conf)' | sort)
[ "$expected" = "$actual" ] || { diff <(echo "$expected") <(echo "$actual") >&2 || true; fail "the image's files differ from tdarr-flow-plugins/root"; }
extra=$(cd "$work" && find . -mindepth 1 -maxdepth 1 | sort | tr '\n' ' ')
[ "$extra" = "./defaults ./doc ./etc " ] || fail "unexpected top-level content: $extra"
for f in BUILD-INFO LICENSE; do [ -s "$work/doc/$f" ] || fail "missing from the image: /usr/share/doc/tdarr-flow-plugins/$f"; done
echo "   ok   the image holds exactly the expected files"

# 2. byte-identical to the source (the flow templates are identical except for their own version in the flow's name: the
# number of commits that touched that template, from template-versions.sh), and valid JavaScript
versions=$(tdarr-flow-plugins/template-versions.sh)
count=0
while IFS= read -r f; do
  case "$f" in
    defaults/tdarr-plugins/LocalFlowTemplates/*)
      n=$(printf '%s\n' $versions | sed -n "s/^$(basename "$f")=\([0-9][0-9]*\)\$/\1/p")
      [ -n "$n" ] || fail "no version worked out for $f"
      sed "s/^    \"name\": \"\(.*\)\",\$/    \"name\": \"\1 (v$n)\",/" "tdarr-flow-plugins/root/$f" | cmp -s - "$work/$f" \
        || fail "$f differs from the repo source apart from its version (v$n) in its name"
      # a template with no flow-level name line would pass the comparison above unchanged, so check the name itself
      grep -E '^    "name": ' "$work/$f" | grep -qF " (v$n)\"," || fail "$f: the flow name does not carry its version (v$n)"
      ;;
    *) cmp -s "tdarr-flow-plugins/root/$f" "$work/$f" || fail "$f differs from the repo source" ;;
  esac
  count=$((count + 1))
done < <(cd tdarr-flow-plugins/root && find defaults -type f | sort)
[ "$count" -ge 18 ] || fail "only $count plugin/template files shipped (expected at least 13 plugins and 5 templates)"
for p in classifySource setMaxBitrate tagEncodeSettings tagOutputMetadata checkSourceEfficiency setSourceRelativeBitrate requireEnglishAudio removeUntaggedAudio mkvmergeExecute repairLanguageTags markStep requireTrail runVmaf; do
  [ -s "$work/defaults/tdarr-plugins/LocalFlowPlugins/video/$p/1.0.0/index.js" ] || fail "plugin $p is missing at LocalFlowPlugins/video/$p/1.0.0/index.js"
done
ls "$work"/defaults/tdarr-plugins/LocalFlowTemplates/video/*.js >/dev/null 2>&1 || fail "no flow templates shipped"
docker run --rm -v "$work/defaults:/d:ro" node:20-slim sh -c 'for f in $(find /d -name "*.js"); do node --check "$f" || exit 1; done' \
  || fail "a shipped file does not pass node --check"
echo "   ok   $count files, byte-identical to the repo (template names carry their own versions: $versions) and valid JavaScript"

# 3. the s6 service, as LinuxServer's mod loader expects it
s6=$work/etc/s6-overlay/s6-rc.d
name=init-mod-tdarr-flow-plugins
[ "$(cat "$s6/$name/type")" = oneshot ] || fail "$name/type is not 'oneshot'"
[ "$(cat "$s6/$name/up")" = "/etc/s6-overlay/s6-rc.d/$name/run" ] || fail "$name/up does not point at the run script"
[ -e "$s6/$name/dependencies.d/init-mods" ] || fail "$name does not depend on init-mods"
[ -e "$s6/init-mods-end/dependencies.d/$name" ] || fail "init-mods-end does not wait for $name"
[ -e "$s6/user/contents.d/$name" ] || fail "$name is not registered in user/contents.d"
if grep -rlI $'\r' "$work/etc" | grep -q .; then fail "an s6 file has CR line endings"; fi
echo "   ok   s6 service files"

[ -x "$s6/$name/run" ] || fail "the run script is not executable"
run=$s6/$name/run
bash -n "$run" || fail "the run script does not parse"
head -1 "$run" | grep -qx '#!/usr/bin/with-contenv bash' || fail "the run script's first line is not '#!/usr/bin/with-contenv bash'"
echo "   ok   run script parses"

# 4. the start-up script, against a scratch destination with test ids (as root in a container, so chown works)
cat > "$work/exercise.sh" <<'EOS'
set -eu
export TDARR_FLOW_PLUGINS_SRC=/work/defaults/tdarr-plugins TDARR_FLOW_PLUGINS_DEST=/scratch/FlowPlugins PUID=1234 PGID=4321
run() { bash /work/etc/s6-overlay/s6-rc.d/init-mod-tdarr-flow-plugins/run; }
fail() { echo "FAIL: $*" >&2; exit 1; }
cls=LocalFlowPlugins/video/classifySource/1.0.0/index.js
tpl=LocalFlowTemplates/video/controller.js

mkdir -p /scratch/FlowPlugins/LocalFlowPlugins/video/otherPlugin/1.0.0
echo "someone else's plugin" > /scratch/FlowPlugins/LocalFlowPlugins/video/otherPlugin/1.0.0/index.js
out=$(run); echo "$out"
echo "$out" | grep -q 'installed LocalFlowPlugins/video/classifySource/1.0.0/index.js' || fail "first run did not install classifySource"
echo "$out" | grep -q '0 replaced' || fail "first run replaced something"
[ "$(stat -c '%u:%g %a' "/scratch/FlowPlugins/$cls")" = "1234:4321 664" ] || fail "file owner/mode wrong: $(stat -c '%u:%g %a' "/scratch/FlowPlugins/$cls")"
[ "$(stat -c '%u:%g %a' "/scratch/FlowPlugins/$(dirname "$cls")")" = "1234:4321 775" ] || fail "folder owner/mode wrong"
[ "$(stat -c '%u:%g %a' "/scratch/FlowPlugins/LocalFlowTemplates")" = "1234:4321 775" ] || fail "templates folder owner/mode wrong"
cmp -s "/work/defaults/tdarr-plugins/$tpl" "/scratch/FlowPlugins/$tpl" || fail "template content differs"
[ "$(cat /scratch/FlowPlugins/LocalFlowPlugins/video/otherPlugin/1.0.0/index.js)" = "someone else's plugin" ] || fail "an unrelated plugin was touched"
echo "   ok   first run: installs each file at the right depth, owner and mode; leaves other plugins alone"

out=$(run); echo "$out"
echo "$out" | grep -q ' 0 installed, 0 replaced' || fail "second run was not a no-op"
echo "   ok   second run changes nothing"

echo "// edited on the host" >> "/scratch/FlowPlugins/$cls"
out=$(run); echo "$out"
echo "$out" | grep -q 'replaced LocalFlowPlugins/video/classifySource/1.0.0/index.js' || fail "a differing file was not replaced and logged"
cmp -s "/work/defaults/tdarr-plugins/$cls" "/scratch/FlowPlugins/$cls" || fail "the replaced file is not the shipped one"
echo "   ok   a host-edited file is replaced and the replacement is logged"

rm "/scratch/FlowPlugins/$tpl"
out=$(run); echo "$out"
echo "$out" | grep -q 'installed LocalFlowTemplates/video/controller.js' || fail "a deleted file was not put back"
echo "   ok   a missing file is put back"

out=$(TDARR_FLOW_PLUGINS_SRC=/nonexistent run); echo "$out"
echo "$out" | grep -q 'ERROR' || fail "a missing source was not reported"
echo "   ok   a broken image reports an error and still exits 0"

# no PUID/PGID: still works (files owned by whoever runs it)
rm -rf /scratch2; TDARR_FLOW_PLUGINS_DEST=/scratch2/FlowPlugins PUID= PGID= run | tail -1 | grep -q 'failed' || fail "run without PUID/PGID gave no summary"
[ -f "/scratch2/FlowPlugins/$cls" ] || fail "run without PUID/PGID did not install"
echo "   ok   works without PUID/PGID"
EOS
docker run --rm -v "$work:/work:ro" debian:12-slim bash /work/exercise.sh \
  || fail "the start-up script did not behave as the copy rule says"

echo "PASS: tdarr-flow-plugins smoke test"
