#!/bin/bash
# mado リリースパッケージング: .zip（必須）と .dmg（optional）を dist/ に配置
#
# 使い方: scripts/package.sh <version>
#   例: scripts/package.sh 0.0.1
#
# 前提: bun run build:prod が成功済みで build/stable-macos-arm64/mado.app が存在すること。
# electrobun の build 出力:
#   - .app       : build/stable-macos-arm64/mado.app
#   - .dmg       : artifacts/stable-macos-arm64-mado.dmg   (createDmg: true の既定出力)
#   - .tar.zst   : artifacts/stable-macos-arm64-mado.app.tar.zst (自己更新用、リリースには使わない)
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "usage: $0 <version>  (e.g. 0.0.1)" >&2
  exit 1
fi

BUILD_DIR="build/stable-macos-arm64"
APP_PATH="$BUILD_DIR/mado.app"
ARTIFACTS_DIR="artifacts"
DIST_DIR="dist"

if [ ! -d "$APP_PATH" ]; then
  echo "❌ .app が見つからない: $APP_PATH (bun run build:prod を先に実行)" >&2
  exit 1
fi

mkdir -p "$DIST_DIR"

# .zip（ditto で macOS メタデータ保持）
ZIP_NAME="mado-v${VERSION}-macos-arm64.zip"
ditto -c -k --keepParent "$APP_PATH" "$DIST_DIR/$ZIP_NAME"
ZIP_SIZE=$(du -h "$DIST_DIR/$ZIP_NAME" | awk '{print $1}')
echo "✅ zip: $DIST_DIR/$ZIP_NAME ($ZIP_SIZE)"

# .dmg（electrobun が artifacts/ に createDmg で生成するのでリネームコピー）
DMG_SRC=""
for candidate in "$ARTIFACTS_DIR/stable-macos-arm64-mado.dmg" "$ARTIFACTS_DIR"/*.dmg "$BUILD_DIR/mado.dmg" "$BUILD_DIR"/*.dmg; do
  if [ -f "$candidate" ]; then
    DMG_SRC="$candidate"
    break
  fi
done

if [ -n "$DMG_SRC" ]; then
  DMG_NAME="mado-v${VERSION}-macos-arm64.dmg"
  cp "$DMG_SRC" "$DIST_DIR/$DMG_NAME"
  DMG_SIZE=$(du -h "$DIST_DIR/$DMG_NAME" | awk '{print $1}')
  echo "✅ dmg: $DIST_DIR/$DMG_NAME ($DMG_SIZE)"
else
  echo "ℹ️  .dmg 未検出（createDmg が無効か出力先が異なる）。zip のみでリリースする。"
fi
