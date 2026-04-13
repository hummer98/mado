# mado — プロダクトコンセプト

> 窓（mado）を通して Markdown を見る、CLI ファーストのネイティブビューワー

---

## コンセプト

`mado` は、エンジニアが日常的に扱う Markdown ファイルを **瞬時に・正確に・美しく** 表示するための macOS ネイティブビューワーです。

ブラウザを開かず、エディタを起動せず、ターミナルから一発でウィンドウが開く。それだけ。

```bash
mado README.md          # ファイルを開く（変更を検知して自動リロード）
mado https://...        # URL を開く
mado render file.md     # PNG として書き出す（AI へ渡す用）
mado                    # 引数なし / Finder / Launchpad → ウェルカムウィンドウ (⌘O で開く)
```

---

## やること・やらないこと

```
やること:
  ✅ GFM（GitHub Flavored Markdown）完全対応
  ✅ Mermaid v11 ダイアグラム対応
  ✅ Hot Reload（ファイル変更を即座に反映）
  ✅ file:/// / https:// 対応
  ✅ CLI ランチャー（mado file.md）
  ✅ 通常ウィンドウアプリ（ブラウザ UI なし）
  🔲 画像変換（mado render、AI に完了形を見せる用途）

やらないこと:
  ❌ 編集機能
  ❌ MCP サーバー（用途不明確）
  ❌ ブラウザベース
```

---

## アーキテクチャ

### フレームワーク: Electrobun

**Electron・Tauri 2・Electrobun・Swift を比較検討した結果、Electrobun を選択。**

決断根拠は後述の §決断根拠 を参照。

### 全体構成

```
mado binary（Bun + Electrobun）

┌─────────────────────────────────────────────────────┐
│  Bun プロセス                                        │
│  ├── CLI 引数パース                                  │
│  ├── fs.watch（ファイル監視・Hot Reload トリガー）   │
│  ├── HTTP サーバー（E2E テスト用・画像変換用）       │
│  └── Electrobun WebView 管理                         │
└──────────────────────────┬──────────────────────────┘
                           │ IPC / evaluateJavascriptWithResponse
┌──────────────────────────┴──────────────────────────┐
│  WKWebView                                           │
│  ├── marked.js（GFM + 拡張）                        │
│  ├── mermaid.js v11                                  │
│  ├── highlight.js（コードブロック）                  │
│  └── Hot Reload クライアント（WebSocket 受信）       │
└─────────────────────────────────────────────────────┘
```

### レンダリングエンジン（プラットフォーム非依存）

レンダリングは純粋な JavaScript であり、WebView エンジンに依存しない。

| ライブラリ | 用途 |
|---|---|
| `marked` + `marked-gfm-heading-id` | GFM パース |
| `mermaid` v11 | ダイアグラム描画 |
| `highlight.js` | コードブロックのシンタックスハイライト |
| `github-markdown-css` | GitHub 互換スタイリング |

### Hot Reload フロー

```
file.md 変更
  → Bun の fs.watch が検知
  → Bun がファイルを読み込む
  → WebSocket で新しい Markdown テキストを push
  → JS: marked で再パース → mermaid.run() 完了
  → スクロール位置を保持したまま DOM 差し替え
```

ページ全体リロードではなく **DOM 差し替え** にすることでスクロール位置が保持される。

### 画像変換（オプション）

```
mado render file.md --out preview.png

→ 非表示 WKWebView を生成
→ marked + mermaid でレンダリング
→ JS から "mermaid 完了" コールバックを受け取る
→ WKWebView の takeSnapshot API で PNG キャプチャ
→ ファイル書き出し
```

Playwright・headless Chromium 不要。WKWebView のネイティブ API のみ使用。

---

## E2E テスト戦略

Electrobun には公式の E2E テストフレームワークが存在しない（2026-04 時点で確認済み）。
以下の2層構成でテストを実現する。

### Layer 1: レンダリング層（Playwright + 通常ブラウザ）

marked + mermaid の JS ロジックは WebView に依存しないため、Playwright + Chromium で独立テストできる。

```typescript
// レンダリングの正確性テスト
const page = await browser.newPage()
await page.setContent(renderMarkdown(input))
await page.locator('.mermaid svg').waitFor()
expect(await page.locator('h1').textContent()).toBe('Expected Title')
```

### Layer 2: アプリ統合テスト（自前 E2E 基盤）

Hot Reload・URL 読み込み等の「アプリとしての動作」は、`evaluateJavascriptWithResponse()` を使った自前基盤でテストする。

```
Bun test
  ↕ HTTP POST /command
Bun プロセス内 テストサーバー
  ↕ view.rpc.request.evaluateJavascriptWithResponse()
WKWebView DOM
```

このパターンは `~/git/Dear/line-miniapp-sdk`（Claude Code 実装済み）の設計を移植する。

```typescript
// Hot Reload のテスト例
await writeFile(testFile, '# Before')
await waitForSelector('.mado-content h1', 'Before')

await writeFile(testFile, '# After')
await waitForSelector('.mado-content h1', 'After')  // Hot Reload を確認
```

### 将来的な OSS 化

この E2E 基盤は `electrobun-test` として OSS パッケージ化できる可能性がある。
Electrobun エコシステムに同等のパッケージが存在しない空白地帯（2026-04 調査済み）。

---

## 配布方法（検討中）

- `brew install hummer98/tap/mado`
- `bun install -g mado`
- `.dmg` 直接配布

---

## 決断根拠

*詳細: `output/markdown-viewer-architecture-discussion.md`（blog リポジトリ）*

### フレームワーク選定の経緯

**比較対象**: Electron / Tauri 2 / Electrobun / Swift / Flutter

**Flutter を除外した理由:**
Mermaid を動かすには WebView が必要になり、Flutter の独自レンダリングエンジンの強みが失われる。

**Electron を選ばなかった理由:**
AI エージェント実装前提での検討では Electron が有利だったが、Electrobun の以下の特性が決め手になった。

**Electrobun を選んだ理由:**

1. **TypeScript のみで完結**: Rust を書かずに Tauri 同等の軽量さを得られる
2. **Bun ランタイム**: 高速・モダンな JS ランタイム
3. **バンドルサイズ**: ~14MB（Electron の ~150MB と比較）
4. **E2E の技術的ブロッカーがない**: `evaluateJavascriptWithResponse()` による自前実装が可能
5. **CEF オプション**: `bundleCEF: true` にすれば CDP 経由で Playwright 接続の可能性もある（未検証）

**Tauri 2 を選ばなかった理由:**
AI エージェント実装前提では Rust の学習コストと E2E の未成熟さがネック。TypeScript のみで完結できる Electrobun が優位。

**Swift を選ばなかった理由:**
CLI ファースト設計との相性がやや悪い（NSApplication 起動が必要）。macOS 専用でよいが、CLI ツールとしての配布のしやすさで Electrobun が優位。

### Electrobun のリスクと許容判断

| リスク | 評価 | 許容判断 |
|---|---|---|
| API が `-beta` 段階で変動 | 中 | 個人ツール・単一開発者なので追従可能 |
| E2E フレームワーク不在 | 中 | line-miniapp-sdk パターンで自前実装可能 |
| 学習データが薄い | 低〜中 | 既存パターンのポートなので許容範囲 |
| 11,000 stars・毎日コミット | ポジティブ | エコシステムは成長中 |

---

## 実装ロードマップ（仮）

- [ ] Phase 1: 基本レンダリング（marked + mermaid + Electrobun ウィンドウ）
- [ ] Phase 2: Hot Reload（fs.watch + WebSocket）
- [ ] Phase 3: CLI インターフェース（`mado file.md`、`mado https://...`）
- [ ] Phase 4: テスト基盤（Layer 1 + Layer 2）
- [ ] Phase 5: 画像変換（`mado render`）
- [ ] Phase 6: 配布（brew tap 等）
