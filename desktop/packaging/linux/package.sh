#!/usr/bin/env bash
# Empaqueta Cartero para Linux: .deb (cargo-deb) y AppImage (appimagetool).
set -euo pipefail
cd "$(dirname "$0")/../.."
VERSION=$(grep -m1 '^version' Cargo.toml | cut -d'"' -f2)
OUT=target/dist && mkdir -p "$OUT"
cargo build --release -p cartero-desktop

command -v cargo-deb >/dev/null || cargo install cargo-deb --locked
cargo deb -p cartero-desktop --no-build --output "$OUT/cartero_${VERSION}_amd64.deb"

APPDIR="$OUT/AppDir" && rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin" "$APPDIR/usr/share/applications" "$APPDIR/usr/share/icons/hicolor/256x256/apps"
cp target/release/cartero "$APPDIR/usr/bin/"
cp packaging/linux/cartero.desktop "$APPDIR/usr/share/applications/" && cp packaging/linux/cartero.desktop "$APPDIR/"
cp packaging/icons/icon-256.png "$APPDIR/usr/share/icons/hicolor/256x256/apps/cartero.png" && cp packaging/icons/icon-256.png "$APPDIR/cartero.png"
printf '#!/bin/sh\nexec "$(dirname "$(readlink -f "$0")")/usr/bin/cartero" "$@"\n' > "$APPDIR/AppRun" && chmod +x "$APPDIR/AppRun"
TOOL="$OUT/appimagetool"
[ -x "$TOOL" ] || { curl -fsSL -o "$TOOL" https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage && chmod +x "$TOOL"; }
ARCH=x86_64 "$TOOL" --appimage-extract-and-run "$APPDIR" "$OUT/Cartero-$VERSION-x86_64.AppImage"
ls -la "$OUT"
