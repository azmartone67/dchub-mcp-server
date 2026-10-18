#!/usr/bin/env bash
# Installs a pre-push hook that runs scripts/prepush-gate.mjs. Chains any existing
# pre-push hook (kept as pre-push.chained). Respects core.hooksPath. Safe to rerun.
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
hooks="$(git config --get core.hooksPath || true)"; hooks="${hooks:-$(git rev-parse --git-path hooks)}"
case "$hooks" in /*) ;; *) hooks="$root/$hooks";; esac
mkdir -p "$hooks"; hook="$hooks/pre-push"
marker="# dchub-prepush-gate"
if [ -f "$hook" ] && grep -q "$marker" "$hook"; then echo "unchanged  $hook"; exit 0; fi
if [ -f "$hook" ]; then mv "$hook" "$hooks/pre-push.chained"; echo "chained    existing pre-push -> pre-push.chained"; fi
cat > "$hook" <<H
#!/usr/bin/env bash
$marker
here="\$(cd "\$(dirname "\$0")" && pwd)"
if [ -x "\$here/pre-push.chained" ]; then "\$here/pre-push.chained" "\$@" || exit \$?; fi
cat >/dev/null   # drain the ref lines git feeds a pre-push hook
cd "\$(git rev-parse --show-toplevel)" && exec node scripts/prepush-gate.mjs
H
chmod +x "$hook"; echo "installed  $hook"
node "$root/scripts/prepush-gate.mjs" --self-test
