# Release - mado 新バージョンリリース

mado の新バージョンをリリースするための一連の手順を自動化するコマンド。

**役割分担**: 本コマンドは **ローカルで version bump + tag push まで** を担当し、
署名・公証・GitHub Release 作成・asset upload は **CI (`.github/workflows/build-release.yml`)**
が tag push を契機に実行する。Homebrew Cask の自動更新は `release: published` を
受けた `update-tap.yml` が担当する。詳細な構成図は `docs/release-automation.md` を参照。

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

# リモートを最新化してローカルコミットも同期してから作業する
# （他の worktree や手動コミットで main が先行していても正しい HEAD から
#  バージョン判定 / ビルド / タグ付けを行うため）
git fetch origin main || { echo "❌ git fetch origin main 失敗"; exit 1; }

# origin/main から fast-forward できるか確認
AHEAD=$(git rev-list --count origin/main..HEAD)
BEHIND=$(git rev-list --count HEAD..origin/main)

if [ "$BEHIND" -gt 0 ]; then
  # リモートが先行している場合は fast-forward で追従
  git pull --ff-only origin main || {
    echo "❌ git pull --ff-only 失敗（ローカルとリモートが分岐している可能性）。手動で解消してください。"
    exit 1
  }
  echo "✅ origin/main に追従（$BEHIND コミット pull）"
fi

if [ "$AHEAD" -gt 0 ]; then
  # ローカルに未 push のコミットがある場合は push
  git push origin main || { echo "❌ git push origin main 失敗"; exit 1; }
  echo "✅ ローカルコミットを push（$AHEAD コミット）"
fi

# bun test（最新コードに対して実施）
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

### 5. version bump を PR で main にマージ

main 直 push は branch protection / hook で拒否されるため、release branch を切って PR 経由でマージする。

```bash
RELEASE_BRANCH="release/v$NEXT_VERSION"
git checkout -b "$RELEASE_BRANCH"
git add package.json electrobun.config.ts CHANGELOG.md
git commit -m "chore: bump version to v$NEXT_VERSION"
git push -u origin "$RELEASE_BRANCH"

gh pr create --base main --head "$RELEASE_BRANCH" \
  --title "chore: release v$NEXT_VERSION" \
  --body "Bump version, see CHANGELOG.md for details."

# 手動レビューが不要なら即マージ
gh pr merge --merge --delete-branch

git checkout main
git pull --ff-only origin main
echo "✅ v$NEXT_VERSION の version bump を main にマージ"
```

### 6. Git タグの作成 & プッシュ → CI 起動

tag push が `.github/workflows/build-release.yml` の trigger になり、CI が以降の
ビルド・署名・公証・Release 作成・asset upload を全部実行する。

```bash
git tag "v$NEXT_VERSION"
git push origin "v$NEXT_VERSION"
echo "🚀 tag v$NEXT_VERSION を push、CI build-release.yml が起動"
```

### 7. CI ビルドの監視

```bash
sleep 5  # workflow キューイング待ち
RUN_ID=$(gh run list --workflow=build-release.yml --branch="v$NEXT_VERSION" \
  --limit 1 --json databaseId -q '.[0].databaseId')

if [ -z "$RUN_ID" ]; then
  # tag push の workflow run は branch ではなく ref で取れることもある
  RUN_ID=$(gh run list --workflow=build-release.yml --limit 1 \
    --json databaseId,headBranch,event -q \
    '.[] | select(.event=="push") | .databaseId' | head -1)
fi

gh run watch "$RUN_ID" --exit-status || {
  echo "❌ CI が失敗。詳細: gh run view $RUN_ID --log-failed"
  exit 1
}
echo "✅ CI 完了。GitHub Release を確認:"
gh release view "v$NEXT_VERSION"
```

CI が完了すると以下が揃う:
- 署名・公証済みの `.zip` / `.dmg`
- GitHub Release（CHANGELOG ベースの notes 付き）

### 8. Cask 自動更新の確認

`release: published` イベントにより `.github/workflows/update-tap.yml` が起動し、
`hummer98/homebrew-mado` の `Casks/mado.rb` が自動更新される（通常 1〜2 分）。

- GitHub Actions 実行状況: https://github.com/hummer98/mado/actions/workflows/update-tap.yml
- 失敗時: workflow ログを確認し、後述の「リリース失敗時のロールバック」手順を参照した上で、
  手動で Cask を更新するか Actions を workflow_dispatch で再実行する。
- PAT 管理および失効時の対応は `docs/release-automation.md` を参照。

```bash
sleep 30  # update-tap workflow の起動・完了待ち
gh run list --workflow=update-tap.yml --limit 1 --json status,conclusion,url \
  -q '.[0]'
```

## 注意事項

### 署名・公証について

mado は Apple Developer ID Application 証明書で署名し、Apple Notary Service で
公証（notarize）+ staple 済みのバイナリを配布する。役割分担:

- **codesign**: Electrobun が担当（`build.mac.codesign: true`）。helper / launcher /
  framework / dmg を含めて deep に署名する。
- **notarize + staple**: fastlane が担当（`fastlane/Fastfile` の `notarize_app` lane）。
  `xcrun notarytool` を呼び、`.app` と `.dmg` を公証して staple する。
  PEM → `.p8` の path 化は fastlane の `app_store_connect_api_key` action が
  tempfile で完結処理する（永続化しない）。

ローカル実行時に必要な env（既に `~/git/.envrc` で揃っている前提）:

| env | 用途 | 取得元 |
|---|---|---|
| `ELECTROBUN_DEVELOPER_ID` | codesign identity 文字列 | `security find-identity -p codesigning -v` |
| `APP_STORE_CONNECT_API_KEY_KEY_ID` | notarize Key ID | App Store Connect |
| `APP_STORE_CONNECT_API_KEY_ISSUER_ID` | notarize Issuer ID | App Store Connect |
| `APP_STORE_CONNECT_API_KEY_KEY` | `.p8` の PEM 中身（改行込み） | App Store Connect |

初回セットアップ手順は **`docs/signing-setup.md`** を参照。

CI 上では GitHub Secrets から同等の env を注入する。
詳細は `docs/release-automation.md` を参照（Phase 2 で整備予定）。

### 手動 fallback（CI 障害時）

GitHub Actions 全般が利用不可、または build-release.yml が長期障害で復旧見込みが
無い場合の手動リリース手順。`~/git/.envrc` でローカル env が揃っていることが前提。

```bash
APP_PATH="build/stable-macos-arm64/mado.app"

# 1. ローカルビルド（codesign 込み）
bun run build:prod

# 2. fastlane で公証 + staple（5〜15 分）
fastlane mac notarize_app

# 3. 検証（1 つでも失敗したらリリース中止）
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
spctl --assess --type execute --verbose=2 "$APP_PATH"   # accepted source=Notarized Developer ID
stapler validate "$APP_PATH"

# 4. パッケージング
bash scripts/package.sh "$NEXT_VERSION"

# 5. スモークテスト
bash scripts/smoke-test.sh "$APP_PATH"

# 6. GitHub Release 作成 & asset upload
RELEASE_NOTES=$(awk -v version="$NEXT_VERSION" '
  $0 ~ "^## \\[" version "\\]" { flag=1; next }
  /^## \[/ { flag=0 }
  flag
' CHANGELOG.md)
gh release create "v$NEXT_VERSION" --title "mado v$NEXT_VERSION" --notes "$RELEASE_NOTES"
gh release upload "v$NEXT_VERSION" "dist/mado-v${NEXT_VERSION}-macos-arm64.zip"
[ -f "dist/mado-v${NEXT_VERSION}-macos-arm64.dmg" ] && \
  gh release upload "v$NEXT_VERSION" "dist/mado-v${NEXT_VERSION}-macos-arm64.dmg"
```

`update-tap.yml` は `release: published` で起動するので、Cask 自動更新は CI 経由でも動く。

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
- canary チャンネルのリリース運用定義（現状は stable のみ）
- T-A の build-release.yml の本番試運転後、観測された改善点を取り込む
