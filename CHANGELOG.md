# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-14

### Added

- Graph document format v1 for `graph` and `sequence` documents, with optional provenance, coverage and freshness metadata, a published JSON Schema (`schema/graph-document.v1.json`) and `validate()` with per-error paths.
- ELK layered layout for graphs and groups, and a sequence diagram layout, both measuring text with embedded Inter metrics.
- SVG renderer with light and dark themes.
- Headless core (`@miralabs-tech/standargraph/core`) with a view controller: camera, hit testing, culling, level of detail, hover, selection and search.
- Interactive single-file HTML viewer built on the core with frame batching, label level of detail and culling, and `mount()` for applications: several instances per page, layout in an on-demand Web Worker, listeners removed on `destroy()`.
- WebGL adapter built on Sigma.js, with an automatic switch from the SVG renderer above 2000 nodes and a `--renderer` override.
- CLI `standargraph` with `validate` and `export` to SVG, HTML, PNG and PDF, and a `--markdown` option that prints a preview snippet.
- Remark plugin (`@miralabs-tech/standargraph/remark`) that renders ` ```standargraph ` code blocks as inline SVG, linked to a standalone HTML page.
- Playwright benchmark (`bun run bench`) with results published in `docs/bench.md`: 10 000 nodes in WebGL hold a median of 303 FPS capped and 58.1 FPS uncapped.
- Node smoke test of the packed package, browser tests of `mount()`, a CLI `--markdown` test and GitHub CI.
- MIT license, third-party notices and the EPL-2.0 and MPL-2.0 texts in `licenses/`.
- Package published as `@miralabs-tech/standargraph`, with provenance, from a workflow triggered by `v*` tags.

[1.0.0]: https://github.com/miralabs-tech/standargraph/releases/tag/v1.0.0
