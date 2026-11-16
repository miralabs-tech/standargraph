# Language service for `.sg`

The `/language` subpath of `@standarx/graph` holds the editor features of the text syntax as plain functions: completion, hover, go to definition, references, rename, document symbols, folding ranges, a formatter, diagnostics and quick fixes. It has no dependency on a language server library and no I/O. Every function takes the source text as a string and returns plain data, so the same code serves a VS Code extension, a Monaco or CodeMirror editor, a web playground or a language server over stdio.

```ts
import {
  codeActions,
  complete,
  definition,
  diagnostics,
  documentSymbols,
  foldingRanges,
  format,
  formatText,
  hover,
  prepareRename,
  references,
  rename,
} from "@standarx/graph/language";
```

The types `Position`, `Range`, `TextEdit`, `WorkspaceEdit`, `Location`, `Hover`, `CompletionItem`, `CompletionItemKind`, `DocumentSymbol`, `SymbolKind`, `FoldingRange`, `Diagnostic` and `CodeAction` are exported with them. They have the shape of the matching Language Server Protocol types, so a result can usually be returned from a handler as is.

## Positions

Positions follow the LSP convention: `{ line, character }`, both **0-based**, with `character` counted in **UTF-16 code units**, the unit of a JavaScript string index. A `Range` is `{ start, end }` with an exclusive end.

- Lines end with `\n` or `\r\n`; both are read as one line break.
- A leading BOM counts as one character of line 0, as editors report it.
- A line or a character out of range is clamped to the document instead of throwing.

All functions are pure and never throw on a document with syntax errors: they work on the part of the document that parses (see [Partial parsing](#partial-parsing)).

The examples below use this document, with `web` on line 2 (0-based) and `api` on lines 2, 3 and 5:

```sg
graph "Flow"

web -> api "calls"   # public entry
api -> db
group backend do
  api
end
```

## Functions

### `complete(source, position): CompletionItem[]`

Completion items for the cursor, chosen from the context: the kind keywords on the header, statement keywords and operators of the kind, attribute keys inside `[ … ]` (including `data.<key>`), the values allowed for a key (`shape=`, `direction=`, `confidence=`, …), ER flags and cardinalities, and the ids already declared where a reference is expected. It returns an empty array inside a comment or a string.

```ts
complete('graph "x"\n\na [', { line: 2, character: 3 });
// [{ label: "confidence", kind: "property", documentation: "…", insertText: "confidence=" }, …]
```

An item is `{ label, kind, detail?, documentation?, insertText? }` with `kind` one of `keyword`, `operator`, `property`, `value` or `reference`. `documentation` is Markdown.

### `hover(source, position): Hover | undefined`

Markdown documentation of what is under the cursor: an attribute key, a keyword, an operator, a cardinality, or an item with its label, type, attributes and the number of incoming and outgoing connections.

```ts
hover(source, { line: 2, character: 0 });
// { contents: "**node** `web`\n\nLabel: web\n\nConnections: 0 incoming, 1 outgoing", range: … }
```

### `definition(source, position): Location | undefined`

The range where the item under the cursor is declared. A node that is only used in an edge is declared by its first use.

```ts
definition(source, { line: 3, character: 0 });
// { range: { start: { line: 5, character: 2 }, end: { line: 5, character: 5 } } }
```

### `references(source, position, includeDeclaration = true): Location[]`

Every occurrence of the item under the cursor, in document order. With `includeDeclaration = false` the declaration is left out. The result is empty when the cursor is not on an item.

```ts
references(source, { line: 3, character: 0 }).length; // 3 occurrences of `api`
```

### `prepareRename(source, position): { range, placeholder } | undefined`

The range and the current id of the item under the cursor, or `undefined` when nothing can be renamed there. Use it to answer `textDocument/prepareRename`.

### `rename(source, position, newName): WorkspaceEdit | undefined`

A `{ changes: TextEdit[] }` that replaces every occurrence of the item with `newName`.

```ts
rename(source, { line: 3, character: 0 }, "gateway");
// { changes: [ { range: …, newText: "gateway" }, … ] }   // three edits
```

It returns `undefined`, and leaves the document alone, when the cursor is not on an item, when `newName` is not a bare id (a name that needs backticks is refused), when another item already has this id, or when the renamed document would have more parse errors, or errors of a new kind, than the current one.

### `documentSymbols(source): DocumentSymbol[]`

The outline: one `module` symbol for the document (named by its title, with the kind as `detail`) whose children are the groups, nodes, participants, states, entities and tree nodes, nested as the document nests them. Each symbol has a `range`, a `selectionRange` and optional `children`. `SymbolKind` is one of `class`, `object`, `field`, `event`, `namespace`, `struct` or `module`.

### `foldingRanges(source): FoldingRange[]`

`{ startLine, endLine, kind? }` for the blocks that span several lines: groups, composite states, entity attribute lists and tree nodes with children. Lines are 0-based.

```ts
foldingRanges(source);
// [{ startLine: 4, endLine: 5, kind: "region" }]
```

### `formatText(source, options?): string | undefined` and `format(source, options?): TextEdit[]`

`formatText` returns the formatted document, or `undefined` when it refuses. `format` wraps it for LSP: an empty array when the document is already formatted or refused, else one `TextEdit` that replaces the whole document. `options.indent` is the indent width of a block, 2 by default.

```ts
formatText('graph "Flow"\n\nweb   ->  api "calls"   # keep\n');
// 'graph "Flow"\n\nweb -> api "calls" # keep\n'
```

### `diagnostics(source): Diagnostic[]`

The errors of `parse()` and the hints of the service in one list, with LSP ranges. A `Diagnostic` is `{ range, severity, code, message }`, where `severity` is `error` or `hint` and `code` is a stable `E_*` code or a hint code. `parse()` itself is unchanged and reports errors only.

The text syntax declares a node on its first use, so a typo in an edge silently creates a new node. The `H_SIMILAR_ID` hint flags an id that is never declared, only mentioned, when a declared id of the same kind is close to it: at most 2 edits away, and at most a third of its length. It is set on every mention of the id.

```ts
diagnostics('graph "Flow"\n\napi "API"\nweb -> apj "calls"\n');
// [{ range: { start: { line: 3, character: 7 }, end: { line: 3, character: 10 } },
//    severity: "hint", code: "H_SIMILAR_ID", message: '"apj" is never declared; did you mean "api"?' }]
```

### `codeActions(source, range): CodeAction[]`

Quick fixes for the diagnostics that touch `range`. A `CodeAction` is `{ title, kind: "quickfix", diagnostic, edit }`, with `edit` a `WorkspaceEdit`.

- `E_STRING`: **Close the string**, by inserting the opening quote at the end of the line.
- `E_DUPLICATE`: **Remove the duplicate declaration**, by deleting its line.
- `H_SIMILAR_ID`: **Replace with "x"**, on every mention of the id, and **Declare "id"**, by inserting a declaration line before its first mention, at the same indentation.

Every edit is checked by parsing the document after it: an action that would add errors is left out.

```ts
codeActions(source, { start: { line: 3, character: 7 }, end: { line: 3, character: 7 } });
// [{ title: 'Replace with "api"', kind: "quickfix", … },
//  { title: 'Declare "apj"', kind: "quickfix", … }]
```

## Formatter rules

- **It refuses on syntax errors.** If the document has any error other than a validation error (`E_VALIDATE`), the result is `undefined` or `[]`, so a half-typed document is never rewritten.
- **It keeps comments.** Full-line comments stay where they are and trailing comments stay on their line.
- **It is idempotent.** Formatting a formatted document gives the same text, so `format` returns `[]` on it.
- It keeps the line ending of the document (`\n` or `\r\n`) and a leading BOM, ends the file with one line break, drops blank lines at the start and the end, and collapses runs of blank lines into one.
- It changes spacing and indentation only: ids, labels, attributes and the order of statements are untouched.

## Partial parsing

Editors work on documents that are wrong most of the time. The parser behind `/language` keeps the valid statements around a broken one, including a group and its valid inner statements, and keeps a broken edge as an incomplete statement. Completion, hover, symbols, folding and references therefore keep working while the user types, and a broken line does not blank the outline.

## Wiring it into a language server

The functions map one to one to the handlers of `vscode-languageserver`. The package does not depend on it; the sketch below assumes you add it to your own server.

```ts
import { createConnection, ProposedFeatures, TextDocuments, TextDocumentSyncKind } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  codeActions, complete, definition, diagnostics, documentSymbols, foldingRanges, format, hover,
  prepareRename, references, rename,
} from "@standarx/graph/language";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize(() => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    completionProvider: { triggerCharacters: ["[", " ", "="] },
    hoverProvider: true,
    definitionProvider: true,
    referencesProvider: true,
    renameProvider: { prepareProvider: true },
    documentSymbolProvider: true,
    foldingRangeProvider: true,
    documentFormattingProvider: true,
    codeActionProvider: { codeActionKinds: ["quickfix"] },
  },
}));

const text = (uri: string) => documents.get(uri)?.getText() ?? "";

connection.onCompletion(({ textDocument, position }) => complete(text(textDocument.uri), position));
connection.onHover(({ textDocument, position }) => hover(text(textDocument.uri), position) ?? null);
connection.onDefinition(({ textDocument, position }) => {
  const found = definition(text(textDocument.uri), position);
  return found ? { uri: textDocument.uri, range: found.range } : null;
});
connection.onReferences(({ textDocument, position, context }) =>
  references(text(textDocument.uri), position, context.includeDeclaration).map((found) => ({
    uri: textDocument.uri,
    range: found.range,
  })),
);
connection.onPrepareRename(({ textDocument, position }) => prepareRename(text(textDocument.uri), position) ?? null);
connection.onRenameRequest(({ textDocument, position, newName }) => {
  const edit = rename(text(textDocument.uri), position, newName);
  return edit ? { changes: { [textDocument.uri]: edit.changes } } : null;
});
connection.onDocumentSymbol(({ textDocument }) => documentSymbols(text(textDocument.uri)));
connection.onFoldingRanges(({ textDocument }) => foldingRanges(text(textDocument.uri)));
connection.onDocumentFormatting(({ textDocument, options }) =>
  format(text(textDocument.uri), { indent: options.tabSize }),
);

connection.onCodeAction(({ textDocument, range }) =>
  codeActions(text(textDocument.uri), range).map((action) => ({
    title: action.title,
    kind: action.kind,
    diagnostics: [{ ...action.diagnostic, severity: action.diagnostic.severity === "error" ? 1 : 4 }],
    edit: { changes: { [textDocument.uri]: action.edit.changes } },
  })),
);

documents.onDidChangeContent(({ document }) => {
  connection.sendDiagnostics({
    uri: document.uri,
    diagnostics: diagnostics(document.getText()).map((found) => ({
      ...found,
      severity: found.severity === "error" ? 1 : 4,
    })),
  });
});

documents.listen(connection);
connection.listen();
```

`documentSymbols` returns symbols with `children`, so it fits `DocumentSymbol[]`, and `FoldingRange` and `CompletionItem` fit the LSP types with `kind` mapped to the numeric enums of your library if it requires them. Semantic highlighting is a separate feature: `highlight()` in `/text` returns the tokens (see [syntax-highlighting.md](./syntax-highlighting.md)).

## Known limits

- **Tree documents have no ids.** A line of a `tree` document is a label, not an id that other lines refer to, so `definition`, `references`, `prepareRename` and `rename` return `undefined` or `[]` there. `complete`, `documentSymbols`, `foldingRanges` and `format` work on trees, and `hover` answers on the attributes of a tree line.
- **`rename` refuses a result that adds parse errors.** It parses the document after the edit and returns `undefined` if there are more errors than before or an error of a new kind. It also refuses an id that another item already has.
- **A multi-line duplicate has no quick fix.** Removing one line of a duplicated group or entity block would break the block, so the re-parse check drops the action.
- **The formatter refuses on syntax errors.** It never formats a document it cannot fully read, so format-on-save does nothing until the errors are fixed.
- **Single document.** There is no cross-file index: every call analyses the text it is given (the last analysis is cached for the same text), and a `.sg` file is one document.
- **JSON documents are out of scope.** The functions expect the text syntax; JSON input is not analysed.
