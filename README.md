# StandarGraph — declarative graph and diagram rendering

Describe nodes, edges and groups in a declarative document and render them as a static, interactive, offline HTML page.
Export the same graph to SVG, PNG or PDF, from small hand-written diagrams to graphs of thousands of nodes.

Status: pre-v1

## Headless core

The layout and the view (camera, hit testing, culling, level of detail, highlight) live in `@miralabs-tech/standargraph/core` and never touch the DOM, so any renderer can be built on them. See [docs/headless.md](docs/headless.md).

## License

Licensed under the [MIT license](LICENSE).

Bundled third-party assets keep their own licenses: Inter font (SIL OFL 1.1, `assets/fonts/OFL.txt`).
