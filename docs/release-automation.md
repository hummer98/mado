# Release Automation — Homebrew Cask 自動更新

mado の GitHub Release publish 時に `hummer98/homebrew-mado` の `Casks/mado.rb`
を自動更新する GitHub Actions ワークフローの運用ドキュメント。

## 構成概要

- **Workflow**: `.github/workflows/release.yml`
- **トリガー**: `release: published` / `workflow_dispatch`
- **更新対象**: `hummer98/homebrew-mado` (別リポジトリ) の `Casks/mado.rb`
- **認証**: mado 本体リポジトリの Secret `HOMEBREW_TAP_TOKEN` (PAT)

mado 本体の `GITHUB_TOKEN` は tap リポジトリへの push 権限を持たないため、
別途 PAT を発行して tap への push 権限を付与する。

## PAT 発行手順

### 推奨: Fine-grained PAT

1. GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. **Generate new token** を押下
3. 以下を設定:
   - **Token name**: `mado-homebrew-tap-updater`
   - **Resource owner**: `hummer98`
   - **Expiration**: 90 日（必須）
   - **Repository access**: Only select repositories → `hummer98/homebrew-mado`
   - **Permissions** (Repository):
     - `Contents`: Read and write
     - `Metadata`: Read-only (自動付与)
4. **Generate token** を押下してトークン文字列をコピー

### 代替: Classic PAT

1. GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. **Generate new token (classic)** を押下
3. 以下を設定:
   - **Note**: `mado-homebrew-tap-updater`
   - **Expiration**: 90 日
   - **Scope**: `repo`（`repo:status`, `public_repo` だけだと足りないケースがあるため `repo` 推奨）
4. **Generate token** を押下してトークン文字列をコピー

## Secret 登録手順

1. `https://github.com/hummer98/mado/settings/secrets/actions` を開く
2. **New repository secret** を押下
3. 以下を設定:
   - **Name**: `HOMEBREW_TAP_TOKEN`
   - **Secret**: 上記で発行した PAT 文字列
4. **Add secret** を押下

## PAT 失効予定日

<!-- 新規発行のたびに更新する。失効予定日の 7 日前までに再発行すること。 -->

| 発行日 | 失効予定日 | 種別 | メモ |
|--------|------------|------|------|
| (未発行) | (未発行) | (fine-grained / classic) | 初回発行時に記入 |

## リマインダー設定例（任意）

失効予定日の 7 日前に通知されるよう、以下のいずれかを運用者が選んで設定する:

- **macOS Calendar**:
  `osascript -e 'tell application "Calendar" to make new event at calendar "Home" with properties {summary:"mado HOMEBREW_TAP_TOKEN 失効 7 日前", start date:date "YYYY/MM/DD HH:MM"}'`
- **GitHub Issue 自動生成** (case: cron workflow):
  失効予定日の 7 日前に警告 issue を自動生成する cron workflow を追加する。
- **macOS `reminders` CLI / その他**: 運用者好みのツールでリマインダー登録する。

## 失効時の対応

1. release 時に `push` step が 401 / 403 で失敗する → Actions ページのメール通知で検知
2. 新しい PAT を「PAT 発行手順」に従い再発行
3. mado 本体の Secret `HOMEBREW_TAP_TOKEN` を新 PAT で上書き
4. Actions の失敗した run を **Re-run jobs** で再実行するか、`workflow_dispatch` で対象 tag を指定して手動リラン
5. 本ドキュメントの「PAT 失効予定日」表を更新

## 手動フォールバック（Actions が使えない場合）

Actions 全般が利用不可の場合の手順:

```bash
# 1. mado 本体で該当 tag の zip を取得
TAG=v0.0.3
VERSION="${TAG#v}"
gh release download "$TAG" --repo hummer98/mado --pattern '*-macos-arm64.zip' --dir /tmp/mado-release
SHA256=$(shasum -a 256 /tmp/mado-release/mado-v${VERSION}-macos-arm64.zip | awk '{print $1}')

# 2. tap リポジトリを clone
gh repo clone hummer98/homebrew-mado /tmp/homebrew-mado
cd /tmp/homebrew-mado

# 3. Cask ファイルを書き換え
sed -i '' -E "s/^(  version )\"[^\"]+\"/\1\"$VERSION\"/" Casks/mado.rb
sed -i '' -E "s/^(  sha256 )\"[0-9a-f]{64}\"/\1\"$SHA256\"/" Casks/mado.rb

# 4. 差分確認してコミット & push
git diff Casks/mado.rb
git add Casks/mado.rb
git commit -m "chore: bump mado to v$VERSION"
git push
```

## ドライラン（workflow_dispatch）

本番 release を汚さず workflow 自体の正常性を確認したい場合:

1. `https://github.com/hummer98/mado/actions/workflows/release.yml` を開く
2. **Run workflow** → `tag` 入力欄に過去のリリース tag (例: `v0.0.2`) を指定
3. 実行ログで `No changes (already up-to-date)` と出力されれば OK
   （同値書き換えのため `Commit & push` step でスキップされる）

## 将来の改善案

- **GitHub App + installation token**: PAT ではなく GitHub App のインストール
  トークンで push すると、トークン失効を気にせず運用できる（scope もより狭く設定可能）
- **codesign / notarize 対応**: Apple Developer ID 取得後、workflow 内で
  codesign → notarize → staple を実施する step を追加し、unsigned 配布を解消する
