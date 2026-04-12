<p align="center">
  <img src="./docs/banner.svg" alt="mado" width="100%" />
</p>

<p align="center">
  <a href="./README.ja.md">日本語版</a>
</p>

# mado

> A CLI-first native Markdown viewer for macOS, powered by Electrobun.

<!-- TODO: screenshot -->

## Features

- **GFM support** — GitHub Flavored Markdown via `marked` + `marked-gfm-heading-id`
- **Mermaid v11** — Diagrams rendered natively
- **Syntax highlighting** — via `highlight.js`
- **GitHub-compatible styling** — via `github-markdown-css`
- **Hot Reload** — `fs.watch` + WebSocket + scroll-preserving DOM swap
- **CLI launcher** — `mado README.md` opens a native window instantly
- **File history sidebar** — quick access to recently opened files
- **Structured logging** — one-line events with local ISO 8601 timestamps

## Install

> Note: mado is not yet published to a registry. For now, clone and build from source (see Development). The command below will work once published.

```bash
bun install -g mado
```

## Usage

```bash
mado README.md           # open a local file
mado docs/seed.md        # relative paths resolved against cwd
mado https://...         # open a URL (planned)
```

Changes to the file are detected automatically and the view updates without losing your scroll position.

## How it works

mado is built on [Electrobun](https://electrobun.dev) — a lightweight framework combining [Bun](https://bun.sh) with the native macOS WKWebView. A thin Bun process parses CLI args, watches the file, and pushes updates over WebSocket to the WebView, which renders Markdown with `marked` + `mermaid`.

See [docs/seed.md](./docs/seed.md) for the full product concept and architecture.

## Development

Prerequisites: macOS (arm64), [Bun](https://bun.sh) >= 1.0.

```bash
bun install              # install deps
bun start                # run the dev app
bun test                 # unit tests
bun test:rendering       # Playwright rendering tests
bun test:e2e             # Electrobun integration tests
```

## License

MIT — see [LICENSE](./LICENSE).

## Contributing

Issue-based contributions welcome. Please file an issue before large changes so we can discuss scope. For small fixes, feel free to open a PR directly.
