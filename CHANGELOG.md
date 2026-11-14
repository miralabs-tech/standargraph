# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-14

### Added

- Graph document format v1 for `graph`, `sequence`, `state`, `er` and `tree` documents, with optional provenance, coverage and freshness metadata, a published JSON Schema (`schema/graph-document.v1.json`) and `validate()` with per-error paths.
- ELK layered layout for graphs, groups, state machines and entity-relation diagrams, a sequence diagram layout, and a tidy tree and mindmap layout, all measuring text with embedded Inter metrics.
- SVG renderer with light and dark themes.
- State machine diagrams (`kind: "state"`): pseudo-states, composite states through `parent`, transitions with event, guard and action.
- Entity-relation diagrams (`kind: "er"`): entities with attributes and keys, relations drawn with crow's foot cardinalities.
- Tree and mindmap diagrams (`kind: "tree"`): a flat list of nodes linked by `parent`, laid out as a tidy tree in any direction or as a two-sided mindmap.
- Eleven node shapes (`shape`) on `graph` and `tree` nodes, with edges cut at the outline, so a flowchart is a `graph` with shapes.
- Theming: color tokens and colors per node `type` in one `Theme` object for SVG, HTML, PNG and PDF, and `--theme <file.json>` on the CLI (see `docs/theming.md`).
- Headless core (`@miralabs-tech/standargraph/core`) with a view controller: camera, hit testing, culling, level of detail, hover, selection and search, with `sceneItemCount`, `HOVERABLE` and container-aware hit testing for every kind.
- Interactive single-file HTML viewer built on the core with frame batching, label level of detail and culling, and `mount()` for applications: several instances per page, layout in an on-demand Web Worker, listeners removed on `destroy()`.
- WebGL adapter built on Sigma.js, with an automatic switch from the SVG renderer above 2000 nodes and a `--renderer` override.
- CLI `standargraph` with `validate`, `layout` (writes the document with every node position computed) and `export` to SVG, HTML, PNG and PDF, and a `--markdown` option that prints a preview snippet.
- Remark plugin (`@miralabs-tech/standargraph/remark`) that renders ` ```standargraph ` and ` ```sg ` code blocks, holding JSON or the text syntax, as inline SVG, linked to a standalone HTML page.
- Text syntax for every kind (`.sg`), in a symbol form and a word form, with `parse()`, `print()`, `canonicalize()`, `sniff()` and `loadSource()` in `@miralabs-tech/standargraph/text`, errors reported as `line:column: message [code]`, and a `.sg` twin of every example.
- CLI `convert <file> [--to json|text] [--out <file>]` between JSON and the text syntax; `validate`, `export` and `layout` read either format, detected from the content.
- `mount()` and `exportDocument()` accept a string in JSON or the text syntax.
- Mermaid export for the five kinds: `toMermaid()` in `@miralabs-tech/standargraph/mermaid`, the `mermaid` format of `exportDocument()` and `--format mermaid` on the CLI (`<base>.mmd`, warnings on stderr, and a fenced `mermaid` block after `--markdown`), with the losses documented in `docs/mermaid.md`.
- GitHub Action (`action.yml`, composite) that renders `.sg` files with the published CLI in `write` or `check` mode without committing, an example workflow in `docs/diagrams-workflow.yml`, and a CI job that runs it from the local checkout.
- Playwright benchmark (`bun run bench`) with results published in `docs/bench.md`: 10 000 nodes in WebGL hold a median of 303 FPS capped and 58.1 FPS uncapped.
- Node smoke test of the packed package, browser tests of `mount()`, a CLI `--markdown` test and GitHub CI.
- MIT license, third-party notices and the EPL-2.0 and MPL-2.0 texts in `licenses/`.
- Package published as `@miralabs-tech/standargraph`, with provenance, from a workflow triggered by `v*` tags.

[1.0.0]: https://github.com/miralabs-tech/standargraph/releases/tag/v1.0.0
