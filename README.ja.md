<p align="center">
  <img src="./docs/banner.svg" alt="mado" width="100%" />
</p>

<p align="center">
  <a href="./README.md">English</a>
</p>

# mado

> ターミナルから一発で開く、macOS ネイティブの Markdown ビューワー。

<!-- TODO: スクリーンショット -->

## 特長

- **GFM 完全対応** — `marked` + `marked-gfm-heading-id` による GitHub Flavored Markdown
- **Mermaid v11** — ダイアグラムをネイティブに描画
- **シンタックスハイライト** — `highlight.js` 使用
- **GitHub 互換スタイル** — `github-markdown-css` 使用
- **Hot Reload** — `fs.watch` + WebSocket + スクロール位置保持
- **CLI ランチャー** — `mado README.md` でネイティブウィンドウを即起動
- **ファイル履歴サイドバー** — 最近開いたファイルへの即アクセス
- **構造化ログ** — ローカル TZ の ISO 8601 タイムスタンプ付き 1 行 1 イベント

## インストール

> 注: 現時点では registry へ未公開です。ソースから clone & build してください (Development 参照)。下記コマンドは公開後に利用可能になります。

```bash
bun install -g mado
```

## 使い方

```bash
mado README.md           # ローカルファイルを開く
mado docs/seed.md        # 相対パスは cwd 基準で解決
mado https://...         # URL を開く(将来対応)
```

ファイルの変更は自動検知され、スクロール位置を保ったまま再描画されます。

## 仕組み

mado は [Electrobun](https://electrobun.dev) — [Bun](https://bun.sh) と macOS ネイティブ WKWebView を組み合わせた軽量フレームワーク — の上に構築されています。Bun プロセスが CLI 引数をパースし、ファイルを watch し、WebSocket 経由で WebView に更新を push します。WebView 側では `marked` + `mermaid` が Markdown を描画します。

プロダクト全体のコンセプトとアーキテクチャは [docs/seed.md](./docs/seed.md) を参照してください。

## 開発

前提: macOS (arm64)、[Bun](https://bun.sh) 1.0 以上。

```bash
bun install              # 依存インストール
bun start                # dev 起動
bun test                 # ユニットテスト
bun test:rendering       # Playwright によるレンダリングテスト
bun test:e2e             # Electrobun 統合テスト
```

## ライセンス

MIT — [LICENSE](./LICENSE) を参照。

## コントリビューション

Issue ベースのコントリビューションを歓迎します。大きな変更の前にはスコープ相談のため Issue を立ててください。軽微な修正は直接 PR で構いません。
