#!/bin/bash
# mado スモークテスト: ビルド済み .app の launcher を起動して
#   - ログに `file_list_added path=<test_file>` または
#     `file_delegated path=<test_file>` が記録されていること
#     （前者: 新規ウィンドウで表示開始、後者: 既存 mado インスタンスに
#     IPC delegate。いずれも CLI 経由のファイル受付が機能していることを示す）
# を検証する。
#
# 使い方: scripts/smoke-test.sh [app_path]
#   例: scripts/smoke-test.sh build/stable-macos-arm64/mado.app
#   省略時は build/stable-macos-arm64/mado.app を使用。
#
# 注: launcher は Electrobun self-extractor なので bun プロセスを spawn 後に
#     自身は exit する。このため生存確認ではなくログ出力で成否を判定する。
set -euo pipefail

APP_PATH="${1:-build/stable-macos-arm64/mado.app}"
LAUNCHER="$APP_PATH/Contents/MacOS/launcher"

if [ ! -x "$LAUNCHER" ]; then
  echo "❌ launcher が見つからない: $LAUNCHER (bun run build:prod を先に実行)" >&2
  exit 1
fi

SMOKE_LOG_DIR=$(mktemp -d /tmp/mado-smoke-XXXXXX)
SMOKE_FILE="$(pwd)/docs/seed.md"

if [ ! -f "$SMOKE_FILE" ]; then
  echo "❌ スモークテスト用ファイルが見つからない: $SMOKE_FILE" >&2
  rm -rf "$SMOKE_LOG_DIR"
  exit 1
fi

echo "📁 ログディレクトリ: $SMOKE_LOG_DIR"
echo "📄 対象ファイル: $SMOKE_FILE"

cleanup() {
  # launcher 経由で起動した bun プロセスを片付ける
  pkill -f "dev.mado.app" 2>/dev/null || true
  rm -rf "$SMOKE_LOG_DIR"
}
trap cleanup EXIT

MADO_LOG_DIR="$SMOKE_LOG_DIR" MADO_FILE="$SMOKE_FILE" "$LAUNCHER" >/dev/null 2>&1 &
LAUNCHER_PID=$!

# launcher の self-extraction + bun プロセス起動を待つ
sleep 10

# bun プロセスを停止（ログは既に吐き出されているはず）
pkill -f "dev.mado.app" 2>/dev/null || true
wait "$LAUNCHER_PID" 2>/dev/null || true

# ログ確認
if ! ls "$SMOKE_LOG_DIR"/*.log >/dev/null 2>&1; then
  echo "❌ スモークテスト失敗: ログファイルが生成されていない"
  exit 1
fi

if grep -q "file_list_added path=$SMOKE_FILE" "$SMOKE_LOG_DIR"/*.log 2>/dev/null; then
  echo "✅ スモークテスト成功: file_list_added path=$SMOKE_FILE を検出"
elif grep -q "file_delegated path=$SMOKE_FILE" "$SMOKE_LOG_DIR"/*.log 2>/dev/null; then
  echo "✅ スモークテスト成功: file_delegated path=$SMOKE_FILE を検出（既存インスタンスに委譲）"
else
  echo "❌ スモークテスト失敗: file_list_added / file_delegated イベントがログにない"
  echo "--- ログ末尾 ---"
  tail -50 "$SMOKE_LOG_DIR"/*.log
  exit 1
fi
