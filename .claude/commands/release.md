# Release - mado 新バージョンリリース

mado の新バージョンをリリースするための一連の手順を自動化するコマンド。

## --auto オプション

`/release --auto` で実行すると、対話なしの完全自動リリースが実行される。

### 動作の違い

| 項目 | 通常モード (`/release`) | 自動モード (`/release --auto`) |
|------|-------------------------|-------------------------------|
| 未コミット変更 | ユーザーに確認を求める | ドキュメント変更のみスキップ、ソースコードはエラー |
| バージョン番号 | ユーザーに提案して確認 | コミットログから自動判定 |
| 確認プロンプト | 各ステップで確認 | 全てスキップ |

### 自動判定ルール

**バージョン番号の自動判定（Semantic Versioning）:**
- `BREAKING CHANGE:` を含むコミット → **major** インクリメント (0.5.0 → 1.0.0)
- `feat:` プレフィックスのコミット → **minor** インクリメント (0.5.0 → 0.6.0)
- `fix:`, `docs:`, `chore:` のみ → **patch** インクリメント (0.5.0 → 0.5.1)

**未コミット変更の扱い:**
- `.md`, `.json` ファイルのみ → 警告してスキップ
- `.ts`, `.tsx`, `.js` 等のソースコード → エラー終了

**初回リリースの特殊動作:**
- 前回のタグが存在しない場合（`git describe --tags --abbrev=0` が失敗）、
  現在の `package.json.version` をそのまま `NEXT_VERSION` として採用し、
  auto バンプは実施しない。CHANGELOG の `[Unreleased]` 以降の追記もスキップ。

## 実行手順

以下の順序で実行する。

### 1. 前提条件チェック

main ブランチ、テスト通過、未コミット変更の確認。

```bash
# main ブランチ確認
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo "❌ main ブランチ以外では実行不可 (現在: $BRANCH)"
  exit 1
fi

# bun test
bun test || { echo "❌ bun test 失敗"; exit 1; }

# 未コミット変更チェック
UNCOMMITTED=$(git status --porcelain)

if [ -n "$UNCOMMITTED" ]; then
  if [[ "$0" == "--auto" ]]; then
    SOURCE_CHANGES=$(echo "$UNCOMMITTED" | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|sh)$' || true)
    if [ -n "$SOURCE_CHANGES" ]; then
      echo "❌ ソースコードに未コミット変更があります。--auto モードではリリースできません。"
      echo "$SOURCE_CHANGES"
      exit 1
    fi
    DOC_CHANGES=$(echo "$UNCOMMITTED" | grep -E '\.(md|json)$' || true)
    if [ -n "$DOC_CHANGES" ]; then
      echo "⚠️  以下のドキュメント変更をスキップします:"
      echo "$DOC_CHANGES"
    fi
  else
    echo "⚠️  未コミットの変更があります:"
    echo "$UNCOMMITTED"
    echo ""
    echo "必要であれば /commit コマンドを実行してコミットを作成してください。"
    exit 1
  fi
fi
```

### 2. バージョン決定

```bash
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "現在のバージョン: $CURRENT_VERSION"

LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

if [ -z "$LATEST_TAG" ]; then
  # 初回リリース: 現在の version をそのまま採用
  NEXT_VERSION="$CURRENT_VERSION"
  echo "📦 初回リリース: $NEXT_VERSION"
else
  echo "前回のリリースタグ: $LATEST_TAG"

  if [[ "$0" == "--auto" ]]; then
    # auto 判定
    COMMITS=$(git log ${LATEST_TAG}..HEAD --oneline)

    if echo "$COMMITS" | grep -qi "BREAKING CHANGE:"; then
      VERSION_TYPE="major"
    elif echo "$COMMITS" | grep -qE "^[a-f0-9]+ feat:"; then
      VERSION_TYPE="minor"
    else
      VERSION_TYPE="patch"
    fi
    echo "📦 自動判定されたバージョンタイプ: $VERSION_TYPE"

    IFS='.' read -r -a VERSION_PARTS <<< "${CURRENT_VERSION}"
    MAJOR="${VERSION_PARTS[0]}"
    MINOR="${VERSION_PARTS[1]}"
    PATCH="${VERSION_PARTS[2]}"

    case "$VERSION_TYPE" in
      major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
      minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
      patch) PATCH=$((PATCH + 1)) ;;
    esac

    NEXT_VERSION="$MAJOR.$MINOR.$PATCH"
    echo "✅ 次のバージョン: $NEXT_VERSION"
  else
    echo ""
    echo "最近のコミット:"
    git log --oneline -10
    echo ""
    echo "**バージョンタイプの判定基準:**"
    echo "- **patch**: バグ修正のみ（fix:, docs: など）"
    echo "- **minor**: 新機能追加（feat: など）"
    echo "- **major**: 破壊的変更（BREAKING CHANGE）"
    echo ""
    echo "次のバージョンを決定してください（例: 0.1.0）"
    exit 1  # ユーザーに確認を促すため一旦終了
  fi
fi
```

### 3. package.json / electrobun.config.ts バージョン更新

```bash
# package.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"$NEXT_VERSION\"/" package.json
echo "✅ package.json を $NEXT_VERSION に更新"

# electrobun.config.ts（L7 の app.version 固有のパターン。
# 将来別の `version: "..."` が増えるとマッチ範囲が広がるので注意）
sed -i '' "s/version: \".*\",/version: \"$NEXT_VERSION\",/" electrobun.config.ts
echo "✅ electrobun.config.ts を $NEXT_VERSION に同期"
```

初回リリース時 `NEXT_VERSION == CURRENT_VERSION` の場合、sed は no-op で問題なし。

### 4. CHANGELOG.md 更新

初回リリース時は雛形に既に `[0.0.1]` エントリが存在するためスキップ。
2 回目以降は `[Unreleased]` 直下に `[$NEXT_VERSION]` セクションを挿入する。

```bash
if [ -z "$LATEST_TAG" ]; then
  echo "ℹ️  初回リリース: CHANGELOG.md は雛形のまま使用"
else
  # 前回のリリースタグから現在までのコミットを取得
  COMMITS=$(git log ${LATEST_TAG}..HEAD --oneline)
  RELEASE_DATE=$(date +"%Y-%m-%d")

  # CHANGELOG エントリを生成
  echo "## [$NEXT_VERSION] - $RELEASE_DATE" > /tmp/mado_changelog_entry.md
  echo "" >> /tmp/mado_changelog_entry.md

  # feat → Added
  FEAT_COMMITS=$(echo "$COMMITS" | grep -E "^[a-f0-9]+ feat:" || true)
  if [ -n "$FEAT_COMMITS" ]; then
    echo "### Added" >> /tmp/mado_changelog_entry.md
    echo "$FEAT_COMMITS" | sed 's/^[a-f0-9]* feat: /- /' >> /tmp/mado_changelog_entry.md
    echo "" >> /tmp/mado_changelog_entry.md
  fi

  # fix → Fixed
  FIX_COMMITS=$(echo "$COMMITS" | grep -E "^[a-f0-9]+ fix:" || true)
  if [ -n "$FIX_COMMITS" ]; then
    echo "### Fixed" >> /tmp/mado_changelog_entry.md
    echo "$FIX_COMMITS" | sed 's/^[a-f0-9]* fix: /- /' >> /tmp/mado_changelog_entry.md
    echo "" >> /tmp/mado_changelog_entry.md
  fi

  # その他 → Changed
  OTHER_COMMITS=$(echo "$COMMITS" | grep -vE "^[a-f0-9]+ (feat|fix):" || true)
  if [ -n "$OTHER_COMMITS" ]; then
    echo "### Changed" >> /tmp/mado_changelog_entry.md
    echo "$OTHER_COMMITS" | sed 's/^[a-f0-9]* /- /' >> /tmp/mado_changelog_entry.md
    echo "" >> /tmp/mado_changelog_entry.md
  fi

  # [Unreleased] 行の直後に挿入
  awk -v entry_file=/tmp/mado_changelog_entry.md '
    /^## \[Unreleased\]/ {
      print
      print ""
      while ((getline line < entry_file) > 0) print line
      close(entry_file)
      next
    }
    { print }
  ' CHANGELOG.md > /tmp/mado_changelog_new.md
  mv /tmp/mado_changelog_new.md CHANGELOG.md
  rm -f /tmp/mado_changelog_entry.md

  echo "✅ CHANGELOG.md を更新"
fi
```

### 5. Prod ビルド

```bash
bun run build:prod

APP_PATH="build/stable-macos-arm64/mado.app"
if [ ! -d "$APP_PATH" ]; then
  echo "❌ .app が生成されていない: $APP_PATH"
  exit 1
fi
echo "✅ ビルド成功: $APP_PATH"
```

### 6. パッケージング

```bash
bash scripts/package.sh "$NEXT_VERSION"

ZIP_PATH="dist/mado-v${NEXT_VERSION}-macos-arm64.zip"
if [ ! -f "$ZIP_PATH" ]; then
  echo "❌ zip が生成されていない: $ZIP_PATH"
  exit 1
fi
echo "✅ パッケージング成功: $ZIP_PATH"
```

### 7. スモークテスト

```bash
bash scripts/smoke-test.sh "build/stable-macos-arm64/mado.app" || {
  echo "❌ スモークテスト失敗。リリースを中止。"
  exit 1
}
```

**スモークテストが失敗した場合:**
1. 出力のログ末尾を確認
2. `$TMPDIR/mado/` 配下の直近ログも参照
3. 問題を修正してから再ビルド
4. **以降のステップ（commit / push / release）に進まないこと**

### 8. コミット & プッシュ

```bash
git add package.json electrobun.config.ts CHANGELOG.md
git commit -m "chore: bump version to v$NEXT_VERSION

🤖 Generated with Claude Code"
git push origin main
echo "✅ 変更をコミット & プッシュ"
```

### 9. Git タグの作成 & プッシュ

```bash
git tag "v$NEXT_VERSION"
git push origin "v$NEXT_VERSION"
echo "✅ タグ v$NEXT_VERSION を作成 & プッシュ"
```

### 10. GitHub リリース作成

```bash
# CHANGELOG から該当バージョンの section を抽出
RELEASE_NOTES=$(awk -v version="$NEXT_VERSION" '
  $0 ~ "^## \\[" version "\\]" { flag=1; next }
  /^## \[/ { flag=0 }
  flag
' CHANGELOG.md)

gh release create "v$NEXT_VERSION" \
  --title "mado v$NEXT_VERSION" \
  --notes "$RELEASE_NOTES"

echo "✅ GitHub リリースを作成"
```

### 11. バイナリ添付 & 完了報告

```bash
gh release upload "v$NEXT_VERSION" \
  "dist/mado-v${NEXT_VERSION}-macos-arm64.zip"

# .dmg があれば添付
if [ -f "dist/mado-v${NEXT_VERSION}-macos-arm64.dmg" ]; then
  gh release upload "v$NEXT_VERSION" \
    "dist/mado-v${NEXT_VERSION}-macos-arm64.dmg"
fi

echo "✅ リリース完了: https://github.com/hummer98/mado/releases/tag/v$NEXT_VERSION"
```

## 注意事項

### unsigned バイナリについて

mado は現状 codesign / notarize をスキップしている（`electrobun.config.ts` の
defaultConfig で `codesign: false`, `notarize: false`）。
エンドユーザーが GitHub Releases からダウンロードした `.zip` には
quarantine 属性が付くため、初回起動前に以下のいずれかの対応が必要:

```bash
# quarantine 属性を削除
xattr -d com.apple.quarantine /Applications/mado.app

# または右クリック → 開く → 「開く」を選択
```

README / README.ja.md にもエンドユーザー向けの手順として同内容を記載すること。

### リリース失敗時のロールバック

途中でエラーが発生した場合の戻し方:

```bash
# タグを削除（ローカル + リモート）
git tag -d "v$NEXT_VERSION"
git push --delete origin "v$NEXT_VERSION"

# GitHub リリースを削除
gh release delete "v$NEXT_VERSION" --yes

# コミットを戻す（まだ push していない場合）
git reset --hard HEAD~1

# push 済みの場合は revert commit を作成
git revert HEAD
git push origin main
```

### 今後のタスク

- npm / bun registry への publish 対応（現状 `bin/mado` は dev 用 launcher 固定）
- codesign / notarize の導入（Apple Developer ID が必要）
- canary チャンネルのリリース運用定義（現状は stable のみ）
