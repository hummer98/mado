<p align="center">
  <img src="./docs/banner.svg" alt="mado" width="100%" />
</p>

<p align="center">
  <a href="./README.ja.md">日本語版</a>
</p>

# mado

> A CLI-first native Markdown viewer for macOS, powered by Electrobun.

<!-- TODO: screenshot -->

## Why mado?

Markdown editors are everywhere — but when you're coding with an AI agent, you almost never *edit* Markdown. Editor features just get in the way. Opening VS Code for a quick preview feels like overkill.

Browser-based viewers (the localhost kind) are fine, but they mix in with your everyday tabs. Launching one via a URL scheme gives you no control over which window or browser profile catches it.

Most existing viewers also lack proper GFM and Mermaid v11 support.

What I actually wanted: one dedicated native window per project, launched from the terminal, that stays put while I work.

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

To upgrade an existing install:

```bash
brew update && brew upgrade --cask mado
```

Cask releases are auto-updated by GitHub Actions when a new version is published.

mado is signed and notarized with an Apple Developer ID, so it launches on macOS without any extra workaround.

For source builds, see [Development](#development) below.

### Manual install (without Homebrew)

Download `mado-v*-macos-arm64.zip` from the [Releases](https://github.com/hummer98/mado/releases) page, unzip `mado.app` into `/Applications`, and add a shell wrapper to your `PATH` that exports `MADO_FILE` before `exec`ing `/Applications/mado.app/Contents/MacOS/launcher`. See [`bin/mado`](./bin/mado) for reference.

### Setting mado as the default `.md` viewer

mado declares itself as a Markdown handler in its `Info.plist`, so once it's
installed in `/Applications` you can wire it up via Finder without `duti`:

1. In Finder, right-click any `.md` file → **Get Info**.
2. Expand **Open with** and pick `mado` from the dropdown (it appears under
   "Other applications" since mado registers as `LSHandlerRank=Alternate`).
3. Click **Change All…**, then confirm the prompt that asks whether to apply
   the change to all similar documents.

If `mado` doesn't appear in the dropdown right after install, refresh
LaunchServices once:

```bash
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f /Applications/mado.app
```

mado registers itself as `Alternate` rather than `Default` so it doesn't
silently steal `.md` away from your existing editor (Typora, Obsidian, VS Code,
…). You opt in explicitly via "Change All…" above.

## Usage

```bash
mado README.md           # open a local file
mado docs/seed.md        # relative paths resolved against cwd
mado https://...         # open a URL (planned)
```

Changes to the file are detected automatically and the view updates without losing your scroll position.

The window keeps running after you close the terminal or press Ctrl+C in the
shell. Set `MADO_FOREGROUND=1` to keep mado attached to the foreground for
debugging.

## How it works

mado is built on [Electrobun](https://electrobun.dev) — a lightweight framework combining [Bun](https://bun.sh) with the native macOS WKWebView. A thin Bun process parses CLI args, watches the file, and pushes updates over WebSocket to the WebView, which renders Markdown with `marked` + `mermaid`.


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
