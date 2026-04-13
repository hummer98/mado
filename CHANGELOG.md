# CHANGELOG

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
