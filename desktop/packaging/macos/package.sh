#!/usr/bin/env bash
# Empaqueta Cartero para macOS: binario universal (Apple Silicon + Intel), Cartero.app y .dmg.
# Firma ad hoc por defecto. Con MACOS_SIGN_IDENTITY (certificado «Developer ID Application» en el
# llavero) firma de verdad, y con APPLE_ID, APPLE_TEAM_ID y APPLE_APP_PASSWORD además notariza.
set -euo pipefail
cd "$(dirname "$0")/../.."
VERSION=$(grep -m1 '^version' Cargo.toml | cut -d'"' -f2)
OUT=target/dist
APP="$OUT/Cartero.app"

rustup target add aarch64-apple-darwin x86_64-apple-darwin
cargo build --release -p cartero-desktop --target aarch64-apple-darwin
MACOSX_DEPLOYMENT_TARGET=11.0 cargo build --release -p cartero-desktop --target x86_64-apple-darwin

rm -rf "$OUT" && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
lipo -create -output "$APP/Contents/MacOS/cartero" \
  target/aarch64-apple-darwin/release/cartero target/x86_64-apple-darwin/release/cartero

ICONSET="$OUT/cartero.iconset" && mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s packaging/icons/icon-1024.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2)); sips -z $d $d packaging/icons/icon-1024.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/cartero.icns"
sed "s/__VERSION__/$VERSION/g" packaging/macos/Info.plist > "$APP/Contents/Info.plist"

if [ -n "${MACOS_SIGN_IDENTITY:-}" ]; then
  codesign --force --deep --options runtime --timestamp --sign "$MACOS_SIGN_IDENTITY" "$APP"
else
  codesign --force --deep --sign - "$APP"
fi

STAGE="$OUT/dmg" && mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/" && ln -s /Applications "$STAGE/Applications"
DMG="$OUT/Cartero-$VERSION-macos-universal.dmg"
hdiutil create -volname "Cartero" -srcfolder "$STAGE" -ov -format UDZO "$DMG"

if [ -n "${MACOS_SIGN_IDENTITY:-}" ] && [ -n "${APPLE_ID:-}" ]; then
  codesign --force --sign "$MACOS_SIGN_IDENTITY" --timestamp "$DMG"
  xcrun notarytool submit "$DMG" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD" --wait
  xcrun stapler staple "$DMG"
fi
echo "$DMG"
