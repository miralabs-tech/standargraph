# Mermaid export

`toMermaid()` writes a document of any kind as Mermaid text, so a diagram can be pasted in a GitHub Markdown file. The export is lossy: Mermaid has no counterpart for part of the format, and every loss met is reported as a warning.

## API

```ts
import { toMermaid } from "@standarx/graph/mermaid";

const { text, warnings } = toMermaid(document);
```

`toMermaid(document: Document): { text: string; warnings: string[] }` takes a validated document (see `validate()` and `loadSource()`) and never touches the DOM. `text` ends with a newline.

Two other entry points use it:

- `exportDocument(input, { formats: ["mermaid"] })` returns the text as `out.mermaid`, a string, without the warnings. A call with only `mermaid` does not run the layout.
- `standargraph export <file> --format mermaid` writes `<base>.mmd`, prints each warning on stderr as `warning: <message>` and exits 0. With `--markdown`, the Markdown snippet is followed by a fenced `mermaid` code block holding the export, ready to paste.

## Common rules

- **Title.** A title goes in a front matter: `---`, `title: "<title>"` (backslashes and quotes escaped, line breaks turned into spaces), `---`.
- **Ids.** `mid(id)` turns every character outside `[A-Za-z0-9_]` into `_`; an id that starts with a digit or is a reserved word (`end`, `graph`, `flowchart`, `subgraph`, `style`, `classdef`, `class`, `click`, `linkstyle`, `direction`, `state`, `note`, `default`, `call`, `href`, in any case) gets the prefix `n_`; a collision gets `_2`, `_3`, and so on, in document order. One table serves every reference of a document.
- **Labels.** A label is wrapped in `"`, with `"` written `#quot;` and a line break written `<br>`. In a sequence diagram, texts are not wrapped and `#` and `;` become `#35;` and `#59;`. The same escape applies to the actions and transition labels of a state diagram.

## Mapping by kind

| Kind | Mermaid | Mapping | Lost |
| --- | --- | --- | --- |
| `graph` | `flowchart TD`, `LR`, `BT` or `RL` (down, right, up, left) | Shapes, with `L` the escaped label: `box` `("L")`, `rect` `["L"]`, `pill` `(["L"])`, `diamond` `{"L"}`, `circle` and `ellipse` `(("L"))`, `hexagon` `{{"L"}}`, `parallelogram` `[/"L"/]`, `cylinder` `[("L")]`, `subroutine` `[["L"]]`, `document` `["L"]`. A group is `subgraph gid ["label"]` ... `end`, nested, with its nodes declared inside. An edge is `-->`, or `---` when undirected, or `-.->` and `-.-` when its `confidence` is `inferred` or `unknown`; its label is `-->\|"L"\|`. | `type`, `description`, `link`, `position`, edge `description`, `link` and `weight`, meta (except the dotted line for the confidence), ellipse (becomes a circle), document (becomes a rectangle). `@{ shape: doc }` is not used: it needs Mermaid 11.3 or later, and the version GitHub serves is not guaranteed. |
| `sequence` | `sequenceDiagram` | `participant mid as L`. Messages are `A->>B: L` (sync), `A-)B: L` (async) and `A-->>B: L` (reply). | `type`, meta |
| `state` | `stateDiagram-v2` and `direction TB`, `LR`, `BT` or `RL` | A state is `state "L" as mid`, with one `mid : action` line per action. A composite state is declared the same way, then followed by a `state mid {` ... `}` block. The `initial` pseudo-state of a region R is `[*] --> x` in the block of R; a `final` one is `x --> [*]` in the block of its region. `choice`, `fork` and `join` are `state mid <<choice>>` and equivalents. `history` is `state "H" as mid`. A transition is `a --> b : label`, written in the lowest region that holds both ends. | `type`, `description`, `link`, meta, the kind of `history`, the split between event, guard and action (the label is `event [guard] / action`). Mermaid refuses a transition between internal states of different composites: it is written anyway, with a warning. |
| `er` | `erDiagram` and `direction` | An entity is `mid["L"] {` ... `}`, with the alias `["L"]` only when the label differs from the identifier. An attribute is `type name PK, FK "note"`: a missing type is `any`, any character outside `[A-Za-z0-9_()[]-]` of a type or a name becomes `_` (so `decimal(10,2)` gives `decimal(10_2)`), a type that does not start with a letter gets `t_`, and quotes are removed from the note. A relation is `a <left><op><right> b : "L"`, with `--` for an identifying relation and `..` otherwise. Left: one `\|\|`, zero-or-one `\|o`, one-or-more `}\|`, zero-or-more `}o`. Right: one `\|\|`, zero-or-one `o\|`, one-or-more `\|{`, zero-or-more `o{`. A missing cardinality is written `\|\|`, with a warning. A relation without a label is written `: ""`. | entity `type`, `description`, `link`, meta, `nullable` (the `?` suffix needs Mermaid 11.16), missing cardinalities |
| `tree`, layout `tree` | `flowchart`, direction as for `graph` | Nodes and shapes as for `graph`; edges are `parent --- child`. | as for `graph` |
| `tree`, layout `mindmap` | `mindmap` | Two spaces per depth, the root at two. A node is `mid` and a shape: `box` and `pill` `(L)`, `rect` `[L]`, `circle` `((L))`, `hexagon` `{{L}}`, any other shape `[L]`. A label that contains `()[]{}` or starts with `"` is written as a Markdown string, ``"`L`"``, inside the delimiters, with its backticks removed. | `type`, `description`, `link`, meta, the left and right sides (Mermaid chooses), unsupported shapes |

## Warnings

Each warning is reported once, however many times its cause occurs.

| Warning | Meaning |
| --- | --- |
| `metadata dropped` | A `meta` object was met. Provenance, coverage, freshness and `data` are never written; only a low `confidence` on a `graph` edge survives, as a dotted line. |
| `type dropped`, `description dropped`, `link dropped`, `position dropped`, `weight dropped` | The field was met on an item, a `graph` edge included, and is not written. |
| `shape "ellipse" written as a circle`, `shape "document" written as a rectangle` | A `graph` or flowchart `tree` shape without a Mermaid counterpart. |
| `shape "<name>" written as a rectangle` | A mindmap shape without a counterpart. |
| `nullable dropped` | An ER attribute carried `nullable`. |
| `relation cardinality missing, written as "one"` | An ER relation lacks a cardinality on one side. |
| `pseudo-state "history" written as a plain state` | A `history` pseudo-state. |
| `a transition between internal states of different composites may be refused by Mermaid` | See the `state` row. |
| `More than 500 edges: Mermaid's default maxEdges may refuse to render` | More than 500 edges, transitions, relations, messages or tree links. |
| `Mermaid's default maxTextSize (50000) is exceeded` | The text is longer than 50 000 characters. |

## Fallbacks

If GitHub refuses a construct, the output is changed in this order, one construct at a time:

1. The ER entity alias is dropped and only the identifier stays.
2. The `state "L" as mid` declaration of a composite state is dropped, and its label is lost.
3. In a mindmap, the Markdown string is replaced by the label without `()[]{}`.
4. The quoted edge label `|"L"|` becomes `|L|`, without any `|` in it.

## Verification

No Mermaid parser is a dependency of the package, and the tests compare the output of every example with a snapshot (`tests/mermaid.test.ts`) without rendering it. Rendering on GitHub is checked by hand, by pasting the export of each example in a Markdown file or a pull request comment.

Result of the check (2026-11-14): the Mermaid output of all 8 examples renders without error with Mermaid 11 (`mermaid.render` in Microsoft Edge). Rendering on github.com itself is not recorded.
