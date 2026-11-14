# Third-party notices

Runtime dependencies and bundled assets, with the license each package declares.

| Component | Version | License |
| --- | --- | --- |
| elkjs | 0.12.1 | EPL-2.0 OR GPL-3.0-or-later |
| @sinclair/typebox | 0.34.52 | MIT |
| @resvg/resvg-wasm | 2.6.2 | MPL-2.0 |
| pdfkit | 0.20.2 | MIT |
| svg-to-pdfkit | 0.1.8 | MIT |
| sigma | 4.0.6 | MIT |
| graphology | 0.26.0 | MIT |
| graphology-utils (via sigma) | 2.5.2 | MIT |
| events (via sigma and graphology) | 3.3.0 | MIT |
| Inter (`assets/fonts/`) | — | SIL OFL 1.1 (`assets/fonts/OFL.txt`) |

## Where each component ends up

- The self-contained HTML pages written by the CLI embed sigma, graphology and their MIT dependencies in the WebGL page only (`--renderer webgl`, or `auto` above the node threshold), and Inter in every page. They never embed ELK: positions are computed by the CLI before the page is written, so the pages carry no ELK notice.
- `mount` (`standargraph/html`) runs the layout of a document without positions in a Web Worker. The worker source is an inline bundle of the layout code and elkjs, shipped inside the `mount` module and loaded from a Blob URL. Applications that bundle `mount` therefore ship elkjs (EPL-2.0 OR GPL-3.0-or-later) in their own bundle and take on its notice, as they do with any use of `standargraph/layout`.
- playwright-core 1.65.1 (Apache-2.0) is a development dependency of the benchmark in `bench/` and is not part of the published package.
