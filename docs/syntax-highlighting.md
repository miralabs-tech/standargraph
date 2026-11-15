# Syntax highlighting for `.sg`

The package ships three things for editors and web pages that show the text syntax:

- a TextMate grammar, `grammars/standargraph.tmLanguage.json` (scope `source.standargraph`, file type `sg`);
- a language configuration, `language-configuration.json` (comments, brackets, auto-closing pairs, indentation, folding, word pattern);
- `highlight(source)` in the `/text` subpath, which returns tokens typed with the standard LSP semantic token types.

The grammar and `highlight()` follow the lexicon of the syntax (see the section on the text syntax in the README). A test tokenizes every `examples/*.sg` file, in the symbol and in the word style, and checks that the category of the grammar scope matches the type given by `highlight()` on every character of every token.

## TextMate scopes

All scope names end with `.standargraph`. Only standard scope prefixes are used.

| Text | Scope |
| --- | --- |
| `# comment` | `comment.line.number-sign` |
| `"string"`, escapes `\"` `\\` `\n` `\t` `\u{…}` | `string.quoted.double`, `constant.character.escape` (an unknown escape is `invalid.illegal.escape`) |
| `` `quoted id` `` | `variable.other` (a backtick id is a variable, not a string) |
| kind keyword of the header (`graph`, `sequence`, `state`, `er`, `tree`) | `keyword.other.kind` |
| `group` | `storage.type.group` |
| `do`, `end` | `keyword.control.block` |
| `->`, `-->`, `->>`, `--`, `..`, `*` (state endpoint) | `keyword.operator.arrow`, `.reply`, `.async`, `.line`, `.dots`, `.star` |
| `to`, `with`, `async`, `reply`, `via`, `initial`, `final` in operator position | `keyword.operator.word` |
| `=` in attributes | `keyword.operator.assignment` |
| `{` `}`, `[` `]` of attributes and lists, `(` `)`, `,` | `punctuation.section.block.*`, `punctuation.definition.attributes.*`, `punctuation.definition.list.*`, `punctuation.section.parens.*`, `punctuation.separator.comma` |
| attribute key, including `data.<k>` | `variable.parameter.attribute` |
| attribute number | `constant.numeric` |
| `true`, `false` | `constant.language.boolean` |
| `shape`, `pseudo`, `confidence`, `direction`, `layout` bare value | `constant.other.enum` |
| any other bare attribute value (`type=page`) | `string.unquoted` |
| ER flags `pk`, `fk`, `uk`, `null` | `storage.modifier` |
| ER cardinalities `0..1`, `1..*`, `0..*`, and `1` in a relation | `constant.numeric.cardinality` |
| ER type and type arguments (`varchar(255)`) | `entity.name.type`, `constant.numeric` |
| first id of a line | `entity.name.tag` |
| id of a `group` | `entity.name.namespace` |
| other ids | `variable.other` |
| bare label of a tree line | `string.unquoted.label` |

### What the regular expressions cannot see

The grammar is pure regular expressions, with no injection, so a few cases are approximations. `highlight()` is exact on them, because it reads the real tokens.

- The header is the first non-comment line and must start with a kind keyword. After a line that is not a header, the rest of the file is left plain, as `highlight()` does.
- A word operator is colored only when it follows an id, a cardinality or a `*` after one to three spaces and is followed by something. A word used as an id in another place (`` `to` ``, or `a to to`) stays an id.
- `do` is a keyword at the end of a line, and `end` alone on a line is a keyword, whether or not a block is open. A node named `end` alone on a line, with no open block, is colored as a keyword by the grammar and as an id by `highlight()`.
- `initial` is an operator at the start of a line followed by an operator, and `final` right after `->` or `to`.
- An attribute key is an id followed by `=` on the same line; a key and its `=` split over two lines are not colored as a key.
- Word operators and flags are not recognized inside the bracket lists of attributes, which is correct, since no operator is allowed there.

## Semantic tokens

`highlight(source)` never throws. It returns the tokens of the valid part, sorted and without overlap; text it does not understand is left out, and everything after a line that is not a header is plain.

```ts
import { highlight, SEMANTIC_TOKEN_MODIFIERS, SEMANTIC_TOKEN_TYPES } from "@standarx/graph/text";

const tokens = highlight('graph "Flow"\n\na -> b "yes"\n');
// { start, end, line, column, type, modifiers? }
```

- `start` and `end` are UTF-16 offsets into the string you passed, a BOM and `\r\n` included.
- `line` and `column` are 1-based, like the errors of `parse()`.
- Brackets, braces, parentheses and commas get no token, since the LSP legend has no punctuation type.

`SEMANTIC_TOKEN_TYPES` and `SEMANTIC_TOKEN_MODIFIERS` are the legend, in LSP order. Send them as is in the `SemanticTokensLegend` of a language server.

| Type | Used for | Grammar scope |
| --- | --- | --- |
| `namespace` | id of a `group` | `entity.name.namespace` |
| `type` | ER type and type arguments | `entity.name.type` |
| `variable` | ids | `entity.name.tag`, `variable.other` |
| `property` | attribute keys | `variable.parameter.attribute` |
| `enumMember` | bare `shape`, `pseudo`, `confidence`, `direction`, `layout` values | `constant.other.enum` |
| `keyword` | kind keyword, `group`, `do`, `end`, `true`, `false`, ER flags | `keyword.other.kind`, `storage.type.group`, `keyword.control`, `constant.language.boolean`, `storage.modifier` |
| `comment` | comments | `comment` |
| `string` | strings, bare tree labels, bare attribute values that are not enums | `string`, `constant.character.escape` |
| `number` | numbers, type arguments, cardinalities | `constant.numeric` |
| `operator` | symbols, word forms, `*`, `=` | `keyword.operator` |

| Modifier | Used for |
| --- | --- |
| `declaration` | the id of a declaration line (node, participant, state, entity, ER attribute, `group`) |
| `defaultLibrary` | the kind keyword of the header |

## Using it in an editor extension

An extension for VS Code (planned in its own repository) points `contributes.grammars` and `contributes.languages` at the two files, which resolve from the installed package:

```json
{
  "contributes": {
    "languages": [{ "id": "standargraph", "extensions": [".sg"], "configuration": "./language-configuration.json" }],
    "grammars": [{ "language": "standargraph", "scopeName": "source.standargraph", "path": "./grammars/standargraph.tmLanguage.json" }]
  }
}
```

Copy the two files from `@standarx/graph/grammars/standargraph.tmLanguage.json` and `@standarx/graph/language-configuration.json` at build time. Other tools read the same grammar: Shiki and TextMate load it by scope name, and a GitHub Linguist entry can reference it.

A semantic token provider calls `highlight(document.getText())` and converts each token to the editor's own position model. A language server answers `textDocument/semanticTokens/full` with the same call.

A full language server (completion, hover, rename, formatting through `print()`) is planned for later; the extension starts with the grammar, the parser diagnostics and a preview panel.

## In a web page

The online demo colors its editor with `highlight()` alone: a `<pre>` sits behind a transparent `<textarea>` with the same font and padding, the scroll is copied from one to the other, and each token becomes a `<span class="tk-<type>">`. The colors come from the tokens of the current theme, so the editor follows the palette and the light and dark switch.
