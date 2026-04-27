# CHANGELOG

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-04-28

### Added
- View メニュー: 拡大 (⌘+) / 縮小 (⌘-) / 実寸 (⌘0) で Markdown 本文を 50%〜200% にズーム (T032)
- detach mado launcher by default; MADO_FOREGROUND=1 escape hatch (T039)

### Fixed
- zoom-in keybinding on JIS keyboard (⌘+ now uses Plus accelerator) (T032)

### Changed
- app icon added to bundle

## [0.2.0] - 2026-04-21

### Added
- automate Homebrew Cask update via GitHub Actions (T024)
- list Markdown files in left pane when given a directory; support `-r/--recursive` (T027)
- Edit menu enabling Cmd+C copy in Markdown view (T028)
- right-click context menu on sidebar file entries (T029)

### Fixed
- resolve relative image paths in Markdown rendering
- `bin/mado <file>` was falling back to `README.md` on stale builds because the
  launcher doesn't forward argv; the current source already reads `MADO_FILE`
  correctly. Added a permanent `startup_invocation` diagnostic log (argv / cwd /
  env_MADO_FILE) so the same symptom can be triaged in one line next time.
  Re-run `bun run build:dev` on any checkout that still exhibits the old
  behavior. (T025)

### Changed
- release skill: add git fetch / pull --ff-only / push sync steps before bump

## [0.1.0] - 2026-04-19

### Added
- persist window size and position per project (T022)

### Changed
- docs: require logging raw external inputs before parsing
- Merge T023: Homebrew Cask tap v0.0.2
- docs: recommend Homebrew Cask install for mado (T023)
- Merge T022: per-project window state persistence

## [0.0.2] - 2026-04-13

### Added
- welcome window on no-args launch (T020)
- implement macOS native menu bar (File/Window/App)
- accordion sidebar toggle with animation
- window title as "mado - <project> - <file path>"

### Fixed
- correct CHANGELOG extraction in release skill for latest section


## [0.0.1] - 2026-04-12
### Added
- Initial MVP: CLI-first Markdown viewer (`mado <file.md>` / `mado <url>` / `mado render <file>`)
- GitHub-Flavored Markdown rendering via marked v18
- Mermaid v11 diagram support with inline error display
- Hot Reload: WebSocket-based file-watching with scroll preservation
- Left sidebar file list with switch/remove operations
- Structured logging (ISO 8601 with TZ, event-based)
- CLI file forwarding via `MADO_FILE` env var (launcher wrapper in `bin/mado`)
- Bilingual README (EN/JA), LICENSE (MIT), banner asset, npm package metadata
