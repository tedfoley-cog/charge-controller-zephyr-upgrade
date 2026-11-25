#!/usr/bin/env bash
# Build this checkout against a pinned Zephyr workspace.
#
#   scripts/ws.sh <baseline|target|auto> <setup|test|build BOARD|path>
#
# west needs the application inside the workspace, so the working tree is
# mirrored into <workspace>/fw before every build and compiler paths are
# rewritten back to this checkout.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WS_ROOT="${ZEPHYR_WS_ROOT:-$HOME/zephyr-ws}"
SDK_VERSION="${ZEPHYR_SDK_VERSION:-0.17.0}"
SDK_DIR="${ZEPHYR_SDK_INSTALL_DIR:-$HOME/zephyr-sdk-$SDK_VERSION}"
BASELINE=v3.2
TARGET=v4.3

tree_version() {
    sed -n 's/^ *revision: v\([0-9]*\.[0-9]*\)-branch.*/v\1/p' "$REPO/west.yml" | head -1
}

case "${1:-}" in
    baseline) VER=$BASELINE ;;
    target) VER=$TARGET ;;
    auto) VER="$(tree_version)" ;;
    *) echo "usage: $0 <baseline|target|auto> <setup|test|build BOARD|path>" >&2; exit 2 ;;
esac
CMD="${2:-}"
WS="$WS_ROOT/$VER"
FW="$WS/fw"
LOGS="$REPO/build/logs"
mkdir -p "$LOGS"

if [ "$VER" = "$BASELINE" ]; then NATIVE=native_posix; else NATIVE=native_sim; fi

sync_tree() {
    mkdir -p "$FW"
    rsync -a --delete \
        --exclude .git --exclude build --exclude node_modules --exclude console \
        --exclude test-results --exclude playwright-report --exclude .venv \
        "$REPO/" "$FW/"
    # A tree that is not yet on this workspace's OS version is built with the
    # pinned manifest for that version (used by `make trial`).
    if [ "$(tree_version)" != "$VER" ]; then
        cp "$REPO/migration/manifests/west-$VER.yml" "$FW/west.yml"
    fi
}

ensure_sdk() {
    [ -d "$SDK_DIR/arm-zephyr-eabi" ] && return
    echo "== installing Zephyr SDK $SDK_VERSION (arm-zephyr-eabi) into $SDK_DIR"
    local tarball="zephyr-sdk-${SDK_VERSION}_linux-x86_64_minimal.tar.xz"
    local tmp; tmp="$(mktemp -d)"
    wget -q -O "$tmp/$tarball" \
        "https://github.com/zephyrproject-rtos/sdk-ng/releases/download/v$SDK_VERSION/$tarball"
    mkdir -p "$(dirname "$SDK_DIR")"
    tar xf "$tmp/$tarball" -C "$(dirname "$SDK_DIR")"
    [ "$(dirname "$SDK_DIR")/zephyr-sdk-$SDK_VERSION" = "$SDK_DIR" ] \
        || mv "$(dirname "$SDK_DIR")/zephyr-sdk-$SDK_VERSION" "$SDK_DIR"
    (cd "$SDK_DIR" && ./setup.sh -t arm-zephyr-eabi -c >/dev/null)
    rm -rf "$tmp"
}

ensure_ws() {
    sync_tree
    local stamp="$WS/.manifest.sha"
    local want; want="$(sha256sum "$FW/west.yml" | cut -d' ' -f1)"
    if [ ! -d "$WS/.west" ]; then
        (cd "$WS" && west init -l fw >/dev/null)
    fi
    (cd "$WS" && west config manifest.path fw)
    if [ ! -f "$stamp" ] || [ "$(cat "$stamp")" != "$want" ]; then
        echo "== west update for Zephyr $VER (first run downloads ~1 GB)"
        (cd "$WS" && west update --narrow -o=--depth=1 >"$LOGS/west-update-$VER.log" 2>&1) \
            || { tail -20 "$LOGS/west-update-$VER.log"; exit 1; }
        echo "$want" >"$stamp"
    fi
    # The workspace can come from a cache while the Python environment is new.
    local reqs="$WS/zephyr/scripts/requirements-base.txt" mods="elftools, pykwalify"
    # Probe jsonschema (list_boards.py) only where this Zephyr version lists it
    if grep -qi '^jsonschema' "$reqs"; then mods="$mods, jsonschema"; fi
    python3 -c "import $mods" 2>/dev/null || python3 -m pip install -q -r "$reqs"
}

rewrite_paths() { sed -u -e "s#$FW/#$REPO/#g" -e 's/\x1b\[[0-9;]*[mK]//g'; }

case "$CMD" in
    path) echo "$WS" ;;
    setup)
        ensure_sdk
        ensure_ws
        echo "workspace ready: $WS (Zephyr $VER, native board $NATIVE)"
        ;;
    test)
        ensure_ws
        log="$LOGS/$VER-tests.log"
        set +e
        (cd "$FW" && ZEPHYR_TOOLCHAIN_VARIANT=host \
            west build -b "$NATIVE" -d "$WS/build/tests" -p always tests -t run 2>&1) | rewrite_paths >"$log"
        rc=${PIPESTATUS[0]}
        set -e
        grep -E "Tests [0-9]+ Failures|:FAIL|error:|warning:|Aborting|CMake Error" "$log" | sort -u | head -60 || true
        echo "log: $log (exit $rc)"
        exit "$rc"
        ;;
    build)
        board="${3:?board required}"
        ensure_sdk
        ensure_ws
        log="$LOGS/$VER-$board.log"
        set +e
        (cd "$FW" && ZEPHYR_TOOLCHAIN_VARIANT=zephyr ZEPHYR_SDK_INSTALL_DIR="$SDK_DIR" \
            west build -b "$board" -d "$WS/build/$board" -p always app 2>&1) | rewrite_paths >"$log"
        rc=${PIPESTATUS[0]}
        set -e
        grep -E "FLASH:|RAM:|error:|warning:|Aborting|CMake Error|No board named|Invalid BOARD" "$log" | sort -u | head -40 || true
        echo "log: $log (exit $rc)"
        exit "$rc"
        ;;
    *) echo "unknown command: $CMD" >&2; exit 2 ;;
esac
