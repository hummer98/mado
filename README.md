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

Install via Homebrew Cask (macOS on Apple Silicon):

```bash
brew install --cask hummer98/mado/mado
```

This installs `mado.app` into `/Applications` and the `mado` CLI into `$(brew --prefix)/bin`.

> mado is currently unsigned. If macOS Gatekeeper blocks the first launch, run:
> `xattr -dr com.apple.quarantine /Applications/mado.app`

For source builds, see [Development](#development) below.

### Manual install (without Homebrew)

Download `mado-v*-macos-arm64.zip` from the [Releases](https://github.com/hummer98/mado/releases) page, unzip `mado.app` into `/Applications`, and add a shell wrapper to your `PATH` that exports `MADO_FILE` before `exec`ing `/Applications/mado.app/Contents/MacOS/launcher`. See [`bin/mado`](./bin/mado) for reference.

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
