#!/bin/sh
# shrine-inspect installer. Checks Node 20 or newer, then checks the tarball
# against the SHA-256 pinned below before it extracts anything. No network:
# download the release files first, then run this next to them.
#
#   sh install.sh [--skill] [path/to/shrine-inspect-<version>.tgz]
#
# Installs to ~/.local/share/shrine-inspect/<version>/ and links
# ~/.local/bin/shrine-inspect to it. --skill also copies the harness skill to
# ~/.claude/skills/shrine-inspect/ (a copy from another release is replaced;
# any other file there is left alone).
# SHRINE_INSPECT_PREFIX and SHRINE_INSPECT_BIN_DIR change the two folders.
# Exit codes: 0 ok, 1 failed, 2 usage, 3 Node too old or missing, 4 checksum mismatch.
#
# The release build pins the two values below; this source copy has none and
# refuses to run. Use the install.sh from the release.
set -eu

PINNED_VERSION=""
PINNED_SHA256=""

fail() {
  printf 'shrine-inspect install: %s\n' "$1" >&2
  exit "${2:-1}"
}

skill=0
tarball=""
for a in "$@"; do
  case "$a" in
    --skill) skill=1 ;;
    -h | --help)
      sed -n '2,13p' "$0"
      exit 0
      ;;
    -*) fail "unknown option $a" 2 ;;
    *) tarball="$a" ;;
  esac
done

if [ -z "$PINNED_VERSION" ] || [ -z "$PINNED_SHA256" ]; then
  fail "this install.sh has no pinned checksum; use the install.sh from the release" 2
fi
here=$(cd "$(dirname "$0")" && pwd)
[ -n "$tarball" ] || tarball="$here/shrine-inspect-$PINNED_VERSION.tgz"
[ -f "$tarball" ] || fail "no tarball at $tarball"

# 1. Node 20 or newer.
command -v node >/dev/null 2>&1 || fail "Node 20 or newer is needed; node is not on PATH" 3
major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
case "$major" in
  '' | *[!0-9]*) major=0 ;;
esac
[ "$major" -ge 20 ] || fail "Node 20 or newer is needed; found $(node --version 2>/dev/null || echo 'an unknown version')" 3

# 2. Checksum, before anything is extracted.
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tarball" | cut -d ' ' -f 1)
elif command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$tarball" | cut -d ' ' -f 1)
else
  actual=$(node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$tarball")
fi
[ "$actual" = "$PINNED_SHA256" ] || fail "checksum mismatch for $tarball: expected $PINNED_SHA256, got $actual. Nothing was installed." 4
echo "Checksum OK: $actual"

# 3. Extract into a temp folder beside the destination, then move it into place.
prefix="${SHRINE_INSPECT_PREFIX:-$HOME/.local/share/shrine-inspect}"
bindir="${SHRINE_INSPECT_BIN_DIR:-$HOME/.local/bin}"
dest="$prefix/$PINNED_VERSION"
top="shrine-inspect-$PINNED_VERSION"
mkdir -p "$prefix" "$bindir"
tmp=$(mktemp -d "$prefix/.install.XXXXXX")
prev="$tmp.previous"
# On any exit (Ctrl-C included): if the old copy was moved aside and no new one is
# in place, put the old one back; then remove the temp folders.
cleanup() {
  if [ -e "$prev" ] && [ ! -e "$dest" ]; then mv "$prev" "$dest"; fi
  rm -rf "$tmp" "$prev"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
tar -xzf "$tarball" -C "$tmp"
[ -f "$tmp/$top/bin/shrine-inspect.mjs" ] || fail "unexpected tarball layout: no $top/bin/shrine-inspect.mjs"
# A copy already there is moved aside first and removed only after the new one is in place.
if [ -e "$dest" ]; then
  mv "$dest" "$prev"
fi
mv "$tmp/$top" "$dest" || fail "could not move the new copy into $dest; the previous install is kept"
rm -rf "$prev"
ln -sf "$dest/bin/shrine-inspect.mjs" "$bindir/shrine-inspect"
echo "Installed: $dest"
echo "Linked: $bindir/shrine-inspect"
"$bindir/shrine-inspect" version

# 4. Optional: the harness skill (a thin driver; all logic stays in the CLI).
if [ "$skill" = 1 ]; then
  src="$dest/skill/skills/shrine-inspect"
  target="$HOME/.claude/skills/shrine-inspect"
  if [ -e "$target" ]; then
    if diff -r "$src" "$target" >/dev/null 2>&1; then
      echo "Skill already installed: $target"
    elif grep -q '^name: shrine-inspect$' "$target/SKILL.md" 2>/dev/null && grep -q '^Skill version: ' "$target/SKILL.md" 2>/dev/null; then
      # This skill from another release: replaced, so its version matches the CLI.
      rm -rf "$target"
      cp -R "$src" "$target"
      echo "Skill updated: $target"
    else
      echo "Skill not copied: $target holds a different copy. Remove it, then run with --skill again."
    fi
  else
    mkdir -p "$(dirname "$target")"
    cp -R "$src" "$target"
    echo "Skill installed: $target"
  fi
fi

case ":$PATH:" in
  *":$bindir:"*) ;;
  *) echo "Add $bindir to your PATH to run shrine-inspect by name." ;;
esac
