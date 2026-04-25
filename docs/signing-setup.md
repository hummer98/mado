# Signing & Notarization Setup

mado を Apple Developer ID で署名し、Apple Notary Service で公証して Homebrew
Cask で配布するための初回セットアップ手順。

- **想定読者**: mado の新規メンテナー、または鍵・証明書・トークンを更新する既存メンテナー
- **想定頻度**: 基本的に一度きり（鍵の有効期限切れ・紛失時のみ再訪）

## 構成の役割分担

| 工程 | 担当 | 設定箇所 |
|---|---|---|
| codesign（helper / launcher / framework / dmg を deep に署名） | **Electrobun** | `electrobun.config.ts` の `build.mac.codesign: true` |
| `xcrun notarytool submit` + staple | **fastlane** | `fastlane/Fastfile` の `notarize_app` lane |
| `.p8` の path 化（PEM → tempfile） | **fastlane** | `app_store_connect_api_key` action が自動で tempfile 管理（永続化しない） |

> 「なぜ Electrobun の notarize（`build.mac.notarize: true`）を使わないのか」
> Electrobun は `ELECTROBUN_APPLEAPIKEYPATH` に **絶対パス** を要求するが、
> `~/git/.envrc` 等で `APP_STORE_CONNECT_API_KEY_KEY` が PEM 文字列として
> 定義されているケースだと、PEM → ファイル化を別途運用する必要が出る。
> fastlane の `app_store_connect_api_key` は PEM 文字列を受け取って内部で
> tempfile 管理してくれるので、この経路に揃えると `.p8` が disk に永続化されない。

---

## 0. 前提

- macOS 開発機（Apple Silicon 推奨。mado は arm64 のみ build）
- Xcode Command Line Tools（`xcode-select --install` 済み）
- `gh` CLI（`gh auth login` 完了）
- `direnv` 導入済み（`brew install direnv` + シェル統合）
- `fastlane` 導入済み（`brew install fastlane` または `bundle install`）
- Apple Developer Program に登録済み

---

## 1. Apple Developer Program — Team ID の確認

1. https://developer.apple.com/account を開く
2. `Membership details` → `Team ID`
3. 10 文字の英数字（例: `ABCD1234EF`）を控える

Apple Developer アカウントのホームに `Program License Agreement` 等の同意待ち警告
が出ていないか確認する（出ていると証明書発行や notarize が拒否される）。

---

## 2. Developer ID Application 証明書の取り込み

公証対象のバイナリは **Developer ID Application** 証明書で署名する必要がある。

### 作成（どちらか一方）

**(a) Xcode から作成（推奨）**

1. Xcode → Settings → Accounts → 対象チームを選択 → `Manage Certificates…`
2. 左下の `+` → **`Developer ID Application`** を選ぶ
3. 作成完了すると自動で login keychain に入る

> `Developer ID Application (Managed)` のような **Cloud Managed 証明書は公証に使えない**。

**(b) developer.apple.com から作成（CSR 自前生成）**

Keychain Access の Certificate Assistant で `.certSigningRequest` を生成 → Apple
Developer Portal にアップロード → `.cer` をダウンロードして login keychain に取り込む。

### 確認 & ELECTROBUN_DEVELOPER_ID 取得

```bash
security find-identity -v -p codesigning
```

出力例:

```
2) B0194F966DEB12B3E605DA9247E0B65062EF4707 "Developer ID Application: Your Name (ABCD123456)"
```

この **`Developer ID Application: ...` の文字列**全体が `ELECTROBUN_DEVELOPER_ID` の値。
mado/.envrc などで以下のように export する（後述 §4）:

```bash
export ELECTROBUN_DEVELOPER_ID="Developer ID Application: Your Name (ABCD123456)"
```

### `.p12` への書き出し（CI 用、Phase 2 で使用）

GitHub Actions の CI で署名するには証明書を秘密鍵ごと `.p12` に書き出す必要がある。

1. Keychain Access → `login` → `My Certificates` カテゴリ
2. `Developer ID Application: <Name> (<TEAM>)` を展開し、**証明書と秘密鍵の両方**を選択
3. 右クリック → `Export 2 items…` → 形式 `Personal Information Exchange (.p12)` で保存
4. パスワードを設定（後で `DEVELOPER_ID_P12_PASSWORD` Secret に登録）

### 有効期限の管理

Developer ID Application 証明書の有効期限は **5 年**。失効予定日を
`docs/release-automation.md` に記録しておく。

---

## 3. App Store Connect API Key の発行

`xcrun notarytool` の認証は API Key 方式を採用。

1. https://appstoreconnect.apple.com/access/integrations/api を開く → `Keys` タブ
2. `Generate API Key` をクリック
   - Name: `mado Notarize`（任意）
   - Access: `Developer` 以上（`App Manager` 推奨）
3. 以下 3 点を控える:
   - `.p8` ファイル（**ダウンロードは 1 回限り**。紛失したら revoke して再発行）
   - **Key ID**（10 文字英数字）
   - **Issuer ID**（UUID 形式）

### env への登録

mado では fastlane の `app_store_connect_api_key` action が以下 3 つの env を自動で
読み取る。**`~/git/.envrc` 等の親 direnv で既に定義されているなら追加作業は不要**。

| env | 内容 |
|---|---|
| `APP_STORE_CONNECT_API_KEY_KEY_ID` | Key ID（10 文字英数字） |
| `APP_STORE_CONNECT_API_KEY_ISSUER_ID` | Issuer ID（UUID） |
| `APP_STORE_CONNECT_API_KEY_KEY` | `.p8` ファイルの中身（PEM、改行込み）をそのまま |

未定義の場合は親 direnv（例: `~/git/.envrc`）に追加する:

```bash
export APP_STORE_CONNECT_API_KEY_KEY_ID="ABCD1234EF"
export APP_STORE_CONNECT_API_KEY_ISSUER_ID="69a6de7f-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
# .p8 の中身をそのまま埋め込む（heredoc が改行を含めて保持してくれる）
export APP_STORE_CONNECT_API_KEY_KEY="$(cat <<'EOF'
-----BEGIN PRIVATE KEY-----
MIGTAg...全 5 行ほどの PEM...
-----END PRIVATE KEY-----
EOF
)"
```

> `.p8` ファイル自体をディスクに残したくない場合は、env に PEM を入れた後で
> `.p8` ファイルを削除しても fastlane の動作には影響しない（fastlane が
> 起動時に tempfile を再生成する）。

---

## 4. ローカル環境の direnv 設定

### `~/git/.envrc`（親）

`APP_STORE_CONNECT_API_KEY_*` の 3 つ（§3 参照）。`fastlane match` 等を併用している
場合は他の env と同居していて構わない。

### `mado/.envrc`（プロジェクト）

最低限の構成:

```bash
source_up
export ELECTROBUN_DEVELOPER_ID="Developer ID Application: Your Name (ABCD123456)"
```

`source_up` で親 direnv の `APP_STORE_CONNECT_API_KEY_*` を継承し、
`ELECTROBUN_DEVELOPER_ID` だけ mado リポジトリ固有として追加する。

設定後:

```bash
direnv allow
```

### 確認

```bash
# 4 つの値（の有無）を確認
direnv exec . bash -c '
  for v in ELECTROBUN_DEVELOPER_ID APP_STORE_CONNECT_API_KEY_KEY_ID \
           APP_STORE_CONNECT_API_KEY_ISSUER_ID APP_STORE_CONNECT_API_KEY_KEY; do
    test -n "${!v}" && echo "  $v: ✓ set" || echo "  $v: ✗ MISSING"
  done
'
```

### コミットしないファイル

- `.envrc` / `.env*` — direnv 関連は全て `.gitignore` 済み
- `*.p8` / `*.p12` / `*.cer`

---

## 5. ローカル署名・公証の動作確認

mado は fastlane を `Gemfile` で固定せず、システム / rbenv のグローバル install を
そのまま使う。`brew install fastlane` または rbenv 環境で `gem install fastlane` 済みなら追加準備不要。

```bash
# 1. codesign 込みで Prod ビルド（Electrobun が helper / launcher も全署名）
bun run build:prod
APP_PATH="build/stable-macos-arm64/mado.app"

# 2. fastlane で公証 + staple（5〜15 分）
fastlane mac notarize_app

# 3. 検証
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
spctl --assess --type execute --verbose=2 "$APP_PATH"
stapler validate "$APP_PATH"

# 4. 起動スモークテスト
bash scripts/smoke-test.sh "$APP_PATH"
```

`spctl --assess` の出力に **`accepted source=Notarized Developer ID`** と出れば
公証まで全部 OK。

---

## 6. トラブルシューティング

### `security find-identity` に Developer ID Application が出ない

§2 で証明書が login keychain に取り込まれていない。Keychain Access を開き直して
`My Certificates` カテゴリを確認。

### `Env var ELECTROBUN_DEVELOPER_ID is required to codesign`

direnv が読み込まれていない。`direnv status` で `Loaded RC allowed` が 1 か確認。
0 なら `direnv allow` を再実行。シェル統合（`eval "$(direnv hook zsh)"`）が
`.zshrc` / `.bashrc` に入っているかも要確認。

### fastlane の `notarize` が `Invalid` を返す

fastlane は `print_log: true` で notarize log を出す。`xcrun notarytool log <uuid>`
を手動実行することも可能。よくある原因:

- Hardened Runtime が無効 → `electrobun.config.ts` の entitlements を確認
- 依存バイナリが未署名 → `codesign --verify --deep` の verbose 出力で詳細確認
- `bundle_id` が `electrobun.config.ts` の `app.identifier` と不一致

### `stapler staple` が `Could not validate ticket`

Apple CDN への反映待ち。1〜2 分後に `xcrun stapler staple "$APP_PATH"` を再実行。

### `bundle exec fastlane` で「Could not find fastlane」

`bundle install --path vendor/bundle` をまず実行する。`vendor/bundle` は
`.gitignore` 済み。

---

## 7. 失効・紛失時の対応

| 事象 | 対応 |
|---|---|
| Developer ID Application 証明書の失効（5 年） | §2 を再実行。`mado/.envrc` の `ELECTROBUN_DEVELOPER_ID` を更新 |
| Apple Developer Program の年次更新失念 | 年会費を払って復活、証明書も自動で再有効化 |
| `.p8` 紛失 | App Store Connect で revoke → 新規発行（§3）。`~/git/.envrc` の `APP_STORE_CONNECT_API_KEY_*` を更新 |
| `.p8` 流出疑い | 即 revoke + 新規発行 |

---

## 8. （Phase 2 で実施）GitHub Secrets の登録

CI 側の設定は Phase 2（`.github/workflows/build-release.yml` 作成時）に行う。
登録予定の Secret:

| Secret | 内容 | 取得元 |
|--------|------|--------|
| `ELECTROBUN_DEVELOPER_ID` | `"Developer ID Application: ..."` 文字列 | §2 |
| `DEVELOPER_ID_P12_BASE64` | `.p12` を `base64 -i` した文字列 | §2 |
| `DEVELOPER_ID_P12_PASSWORD` | `.p12` エクスポート時のパスワード | §2 |
| `APP_STORE_CONNECT_API_KEY_KEY_ID` | API Key ID | §3 |
| `APP_STORE_CONNECT_API_KEY_ISSUER_ID` | Issuer ID | §3 |
| `APP_STORE_CONNECT_API_KEY_KEY` | `.p8` の中身（PEM） | §3 |
| `KEYCHAIN_PASSWORD` | CI 一時 keychain 用 | `openssl rand -base64 24` |
| `HOMEBREW_TAP_TOKEN` | tap 自動更新用 | 既存 |

CI 詳細は `docs/release-automation.md` および `.github/workflows/build-release.yml`
（Phase 2 で追加）を参照。

---

## Appendix: 必要 env の早見表

ローカル mado ビルド時に必要な 4 変数:

| env | 配置場所 | 用途 |
|---|---|---|
| `ELECTROBUN_DEVELOPER_ID` | `mado/.envrc`（mado 固有） | Electrobun が codesign 実行時に参照 |
| `APP_STORE_CONNECT_API_KEY_KEY_ID` | `~/git/.envrc` などの親（fastlane 共通） | fastlane の `app_store_connect_api_key` action |
| `APP_STORE_CONNECT_API_KEY_ISSUER_ID` | 〃 | 〃 |
| `APP_STORE_CONNECT_API_KEY_KEY` | 〃 | 〃 (PEM 中身そのまま) |

参照箇所:
- Electrobun の codesign 実装: `node_modules/electrobun/src/cli/index.ts:4430`
- fastlane の notarize action: `fastlane action notarize` で確認可能
- mado の Fastfile: [`../fastlane/Fastfile`](../fastlane/Fastfile)
