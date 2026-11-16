# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.0] - 2026-11-16

### Added

- Six named palettes, `light`, `dark`, `nord`, `solarized-light`, `solarized-dark` and `high-contrast`, accepted wherever a theme name is: the API, the `remark` plugin, `--theme <name>` and the `base` of a theme file. Each reaches a 4.5:1 contrast for its text, checked by a test.
- Automatic palette per item type: a typed node, participant, state, entity or tree node with no `theme.types` entry gets a stable color from the palette of its theme, in the SVG attributes, the CSS rules of both blocks of an adaptive theme and WebGL. `palette: false` in a `Theme` and `--no-palette` turn it off; explicit `types` entries and `unknown` confidence still win.
- Light, dark and auto switch in the toolbar of the interactive HTML page and of `mount()` for an adaptive theme, set by `data-sg-scheme` on `.sg-app`, kept in `localStorage` (`standargraph-scheme`), with forced-scheme blocks that win over the media query.
- Theme panel in the online demo: palette, light, dark and auto switch, a color input per token and per type of the document, "palette off", live render and a `theme.json` download accepted by `--theme`.
- TextMate grammar `grammars/standargraph.tmLanguage.json` (scope `source.standargraph`) and `language-configuration.json` for `.sg`, shipped in the package and exported as `@standarx/graph/grammars/standargraph.tmLanguage.json` and `@standarx/graph/language-configuration.json`.
- `highlight(source)` in `/text`, with `SEMANTIC_TOKEN_TYPES` and `SEMANTIC_TOKEN_MODIFIERS`: tokens with offsets, line, column and a standard LSP semantic token type, tolerant to errors. A test keeps the grammar and `highlight()` in agreement on the examples.
- The online demo colors its editor with `highlight()`, in the colors of the current theme (see [docs/syntax-highlighting.md](./docs/syntax-highlighting.md)).
- `diagnostics(source)` in `/language`: the errors of `parse()` and `H_SIMILAR_ID` hints for an id that is only mentioned and close to a declared id of the same kind, all as LSP ranges (0-based, UTF-16).
- `codeActions(source, range)` in `/language`: quick fixes for `E_STRING` (close the string), `E_DUPLICATE` (remove the duplicate declaration) and `H_SIMILAR_ID` (replace with the close id, or declare the id), each checked by re-parsing.

### Changed

- A typed item with no color of its own is now colored by the automatic palette, so the SVG output of typed documents changes unless `palette: false` is set.
- WebGL draws a typed node with the fill of its type as is, and re-reads the theme colors on each color scheme switch.
- `Theme.base` accepts every palette name, and `resolveTheme()` also returns the `palette` of the theme.

## [1.0.0] - 2026-11-15

This is the first release of `@standarx/graph`. The package was first published by mistake as `@miralabs-tech/standargraph` and is now `@standarx/graph`.

### Added

- Graph document format v1 for `graph`, `sequence`, `state`, `er` and `tree` documents, with optional provenance, coverage and freshness metadata, a published JSON Schema (`schema/graph-document.v1.json`) and `validate()` with per-error paths.
- ELK layered layout for graphs, groups, state machines and entity-relation diagrams, a sequence diagram layout, and a tidy tree and mindmap layout, all measuring text with embedded Inter metrics.
- SVG renderer with light and dark themes.
- State machine diagrams (`kind: "state"`): pseudo-states, composite states through `parent`, transitions with event, guard and action.
- Entity-relation diagrams (`kind: "er"`): entities with attributes and keys, relations drawn with crow's foot cardinalities.
- Tree and mindmap diagrams (`kind: "tree"`): a flat list of nodes linked by `parent`, laid out as a tidy tree in any direction or as a two-sided mindmap.
- Eleven node shapes (`shape`) on `graph` and `tree` nodes, with edges cut at the outline, so a flowchart is a `graph` with shapes.
- Theming: color tokens and colors per node `type` in one `Theme` object for SVG, HTML, PNG and PDF, and `--theme <file.json>` on the CLI (see `docs/theming.md`).
- Headless core (`@standarx/graph/core`) with a view controller: camera, hit testing, culling, level of detail, hover, selection and search, with `sceneItemCount`, `HOVERABLE` and container-aware hit testing for every kind.
- Interactive single-file HTML viewer built on the core with frame batching, label level of detail and culling, and `mount()` for applications: several instances per page, layout in an on-demand Web Worker, listeners removed on `destroy()`.
- WebGL adapter built on Sigma.js, with an automatic switch from the SVG renderer above 2000 nodes and a `--renderer` override.
- CLI `standargraph` with `validate`, `layout` (writes the document with every node position computed) and `export` to SVG, HTML, PNG and PDF, and a `--markdown` option that prints a preview snippet.
- Remark plugin (`@standarx/graph/remark`) that renders ` ```standargraph ` and ` ```sg ` code blocks, holding JSON or the text syntax, as inline SVG, linked to a standalone HTML page.
- Text syntax for every kind (`.sg`), in a symbol form and a word form, with `parse()`, `print()`, `canonicalize()`, `sniff()` and `loadSource()` in `@standarx/graph/text`, errors reported as `line:column: message [code]`, and a `.sg` twin of every example.
- CLI `convert <file> [--to json|text] [--out <file>]` between JSON and the text syntax; `validate`, `export` and `layout` read either format, detected from the content.
- `mount()` and `exportDocument()` accept a string in JSON or the text syntax.
- Mermaid export for the five kinds: `toMermaid()` in `@standarx/graph/mermaid`, the `mermaid` format of `exportDocument()` and `--format mermaid` on the CLI (`<base>.mmd`, warnings on stderr, and a fenced `mermaid` block after `--markdown`), with the losses documented in `docs/mermaid.md`.
- GitHub Action (`action.yml`, composite) that renders `.sg` files with the published CLI in `write` or `check` mode without committing, an example workflow in `docs/diagrams-workflow.yml`, and a CI job that runs it from the local checkout.
- GitHub Pages demo at https://miralabs-tech.github.io/standargraph/: a playground (`site/`) that renders the text syntax or JSON with `mount()` as you type, with SVG, JSON, `.sg` and `.mmd` downloads, plus the interactive HTML page of every example. `bun run site` builds it into the git-ignored `site-dist/`, and `.github/workflows/pages.yml` deploys it on every push to `main`.
- Playwright benchmark (`bun run bench`) with results published in `docs/bench.md`: 10 000 nodes in WebGL hold a median of 303 FPS capped and 58.1 FPS uncapped.
- Node smoke test of the packed package, browser tests of `mount()`, a CLI `--markdown` test and GitHub CI.
- MIT license, third-party notices and the EPL-2.0 and MPL-2.0 texts in `licenses/`.
- Package published as `@standarx/graph`, with provenance, from a workflow triggered by `v*` tags.
- Language service on the `/language` subpath, with no language server dependency: `complete`, `hover`, `definition`, `references`, `prepareRename`, `rename`, `documentSymbols`, `foldingRanges`, `format` and `formatText` (see [docs/language-service.md](./docs/language-service.md)).
- LSP positions on `/language`: `line` and `character` are 0-based, and `character` counts UTF-16 code units.
- Comment-preserving formatter: `formatText()` and `format()` keep comments, are idempotent and refuse a document with syntax errors.
- Partial parsing for editors: the valid statements around a broken line are kept, so completion, hover, symbols, folding and references keep working while the user types.

[1.1.0]: https://github.com/miralabs-tech/standargraph/releases/tag/v1.1.0
[1.0.0]: https://github.com/miralabs-tech/standargraph/releases/tag/v1.0.0
