# StandarGraph

[![CI](https://github.com/miralabs-tech/standargraph/actions/workflows/ci.yml/badge.svg)](https://github.com/miralabs-tech/standargraph/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/@standarx/graph)](https://www.npmjs.com/package/@standarx/graph) [![downloads](https://img.shields.io/npm/dm/@standarx/graph?color=blue)](https://www.npmjs.com/package/@standarx/graph) [![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE) [![node](https://img.shields.io/badge/node-%3E%3D20-green)](https://nodejs.org)

> "Diagrammes déclaratifs à partir de JSON (graphes, séquences, machines à états, entité-relation et arbres), rendus en SVG, HTML interactif, PNG et PDF, avec WebGL au-delà de 2000 nœuds de graphe."

📖 [English](./README.md) · Français

[Démarrage rapide](#-démarrage-rapide) · [Installation](#-installation) · [Fonctionnalités](#-fonctionnalités) · [Types de diagrammes](#-types-de-diagrammes) · [Thèmes](./docs/theming.md) · [Limites](#-limites) · [Cœur headless](./docs/headless.md) · [Benchmark](./docs/bench.md) · [Changelog](./CHANGELOG.md)

[![Settings page flow](./docs/assets/architecture.svg)](./docs/assets/architecture.html)

[![OAuth 2.0 authorization code flow with PKCE](./docs/assets/protocol.svg)](./docs/assets/protocol.html)

Les deux images ci-dessus sont produites par la CLI (`examples/architecture.json` et `examples/protocol.json`). Chacune renvoie vers un visualiseur interactif autonome : téléchargez le fichier `.html` et ouvrez-le dans un navigateur.

**Démo en ligne** : le [playground](https://miralabs-tech.github.io/standargraph/) affiche la syntaxe texte ou le JSON pendant la frappe, hors ligne une fois chargé, et chaque exemple a une page interactive : [architecture](https://miralabs-tech.github.io/standargraph/examples/architecture.html), [protocol](https://miralabs-tech.github.io/standargraph/examples/protocol.html).

---

## 🧠 Qu'est-ce que StandarGraph ?

Vous décrivez un diagramme dans un document JSON (`version: 1`, `kind` parmi `"graph"`, `"sequence"`, `"state"`, `"er"` ou `"tree"`), et StandarGraph le met en page et le rend. Les nœuds, arêtes et groupes peuvent porter des métadonnées facultatives : provenance (source, confiance, outil), couverture et fraîcheur, pour qu'un diagramme produit par un outil ou un agent dise à quel point on peut s'y fier.

La mise en page et la vue (caméra, hit testing, culling, niveau de détail, survol, sélection, recherche) forment un cœur headless qui ne touche jamais au DOM. Des adaptateurs se posent dessus : un rendu SVG, une page HTML interactive, et un rendu WebGL basé sur [Sigma.js](https://www.sigmajs.org) pour les grands graphes.

Les sorties sont le SVG, une page HTML en un seul fichier qui fonctionne hors ligne (polices et runtime embarqués, aucun accès réseau), le PNG et le PDF. Le PNG et le PDF sont rendus sans navigateur.

**Statut : 1.2.0.**

---

## 🚀 Démarrage rapide

Un document de graphe minimal, `graph.json` :

```json
{
  "version": 1,
  "kind": "graph",
  "title": "Hello",
  "nodes": [
    { "id": "a", "label": "Client" },
    { "id": "b", "label": "Server" }
  ],
  "edges": [{ "from": "a", "to": "b", "label": "requests", "directed": true }]
}
```

### CLI

```sh
standargraph validate graph.json
standargraph export graph.json                              # graph.svg et graph.html à côté du fichier d'entrée
standargraph export graph.json --format svg,html,png,pdf --out out --theme dark
standargraph export graph.json --renderer webgl             # force la page WebGL
standargraph export graph.json --markdown                   # affiche aussi un extrait Markdown d'aperçu
standargraph export graph.json --format mermaid             # graph.mmd, pour le Markdown de GitHub (voir docs/mermaid.md)
standargraph export graph.json --layout stress              # mise en page stress pour un graphe en étoile
standargraph layout graph.json                              # graph.positioned.json : chaque nœud reçoit sa position calculée
standargraph convert graph.json                             # graph.sg, le même document en syntaxe texte
standargraph convert graph.sg --to json --out out/graph.json
```

Chaque commande lit du JSON ou la [syntaxe texte](#syntaxe-texte) : le format est détecté par le contenu, jamais par l'extension du fichier. `validate` sort avec le code 0 quand le document est valide, 1 avec une ligne `chemin: message` par erreur JSON (ou une ligne `fichier:ligne:col: message [code]` par erreur de texte) sinon, 2 quand le fichier n'est pas lisible. `layout` écrit toujours du JSON. `convert` écrit l'autre format que celui de l'entrée, sauf si `--to json|text` en décide autrement, et sort avec le code 2 et `Output would overwrite the input` quand la sortie est le fichier d'entrée.

| Option | Rôle |
| --- | --- |
| `--format <liste>` | Liste séparée par des virgules : `svg`, `html`, `png`, `pdf`, `mermaid` (défaut `svg,html`) ; `mermaid` écrit `<base>.mmd` et affiche ses avertissements sur stderr |
| `--out <dir>` | Dossier de sortie (défaut : le dossier du fichier d'entrée) |
| `--name <base>` | Nom de base des sorties (défaut : le nom du fichier d'entrée sans `.json` ni `.sg`) |
| `--theme <thème>` | `auto` (défaut), un nom de palette (`light`, `dark`, `nord`, `solarized-light`, `solarized-dark`, `high-contrast`) ou un fichier de thème `.json`, voir [docs/theming.md](./docs/theming.md) ; s'applique aussi à `mermaid`, où un thème ajoute des lignes `linkStyle` pour les arêtes d'un `graph` |
| `--no-palette` | Coupe la couleur automatique par `type` d'élément ; s'applique aussi à `mermaid` |
| `--scale <n>` | Facteur d'échelle du PNG (défaut 2) |
| `--renderer <nom>` | Rendu HTML : `auto`, `svg` ou `webgl` (défaut `auto`) |
| `--layout <layered\|stress>` | Remplace le `layout` d'un document `graph` (voir [`graph` et `sequence`](#graph-et-sequence)) ; une valeur invalide sort avec 2, un document qui n'est pas un `graph` sort avec 1 |
| `--markdown` | Affiche `[![titre](base.svg)](base.html)`, un extrait Markdown qui lie l'aperçu SVG à la page HTML ; avec `mermaid` dans `--format`, un bloc de code `mermaid` suit |

### JavaScript

Chaque sous-chemin est un point d'entrée distinct de `@standarx/graph`.

```ts
import { validate } from "@standarx/graph/format";
import { layout } from "@standarx/graph/layout";
import { renderSvg } from "@standarx/graph/svg";
import { renderHtml } from "@standarx/graph/html";

const result = validate(JSON.parse(text));
if (!result.ok) throw new Error(result.errors.map((e) => `${e.path}: ${e.message}`).join("\n"));

const scene = await layout(result.document);
const svg = renderSvg(scene, { theme: "light" });
const html = renderHtml(result.document, scene, { theme: "auto", renderer: "auto" });
```

Tous les formats en un appel, depuis `/export` :

```ts
import { exportDocument } from "@standarx/graph/export";

const out = await exportDocument(graphDocument, { formats: ["svg", "png", "pdf"], theme: "light", scale: 2 });
// out.svg est une chaîne, out.png et out.pdf sont des Uint8Array
```

Du texte Mermaid pour le Markdown de GitHub, depuis `/mermaid` (`formats: ["mermaid"]` dans `exportDocument()` renvoie le même texte sous forme de chaîne, sans les avertissements) :

```ts
import { toMermaid } from "@standarx/graph/mermaid";

const { text, warnings } = toMermaid(graphDocument);
const styled = toMermaid(graphDocument, { theme: "nord" }); // ajoute une ligne linkStyle par arête stylée
```

Monter un graphe interactif dans une page (`mount(container, document, { theme, title, renderer })`). Quand chaque nœud a une `position`, ELK est ignoré ; sinon la mise en page tourne dans un Web Worker et le thread principal reste libre. Plusieurs instances peuvent coexister sur une page :

```ts
import { mount } from "@standarx/graph/html";

const { view, destroy } = await mount(document.getElementById("graph")!, graphDocument, { renderer: "auto" });
```

Pipelines Markdown, avec le plugin remark (il transforme les blocs de code ` ```standargraph ` et ` ```sg ` contenant un document JSON ou la syntaxe texte en SVG en ligne, lié à une page HTML autonome quand `outDir` est défini) :

```ts
import { unified } from "unified";
import remarkParse from "remark-parse";
import { remarkStandargraph } from "@standarx/graph/remark";

unified().use(remarkParse).use(remarkStandargraph, { outDir: "public/diagrams", publicPath: "/diagrams", theme: "auto" });
```

Le cœur headless, pour votre propre rendu (voir [docs/headless.md](./docs/headless.md)) :

```ts
import { createView, layout } from "@standarx/graph/core";

const view = createView(await layout(graphDocument));
view.setViewport(1280, 800);
view.fit();
view.subscribe(() => draw(view));
```

Les fonctions d'éditeur de la syntaxe texte, sans dépendance à un serveur de langage (voir [docs/language-service.md](./docs/language-service.md)) :

```ts
import { codeActions, complete, diagnostics, format } from "@standarx/graph/language";

const items = complete(source, { line: 2, character: 3 });
const edits = format(source);
const problems = diagnostics(source);
const fixes = codeActions(source, problems[0].range);
```

---

## 🧩 Types de diagrammes

Chaque document porte `version: 1` et un `kind`. Les fichiers de [examples](./examples) sont des documents complets pour chaque type.

### `graph` et `sequence`

`graph` contient des `nodes`, des `edges` et des `groups` imbriqués ; `sequence` contient des `participants` et des `messages`. Voir le démarrage rapide plus haut, ainsi que `examples/architecture.json` et `examples/protocol.json`.

Un document `graph` peut définir `"layout": "layered"` (par défaut, la mise en page en couches d'ELK) ou `"layout": "stress"`, écrit `layout=stress` dans l'en-tête `.sg`. `stress` place les nœuds pour que les distances dessinées suivent les distances du graphe : à choisir pour les graphes en étoile, où `layered` dessine de longs détours. Les groupes sont mis en page en deux passes, l'intérieur de chaque groupe d'abord, puis les groupes et les nœuds libres les uns par rapport aux autres, et deux groupes voisins ne se chevauchent jamais. Les arêtes sont droites quand la voie est libre ; une arête qui traverserait un groupe ne contenant aucun de ses deux bouts contourne les coins de ce groupe, à 12 px de son bord, et reste libre de sortir de ses groupes et d'entrer dans ceux de sa cible. Les arêtes sont rognées aux formes des nœuds. L'étiquette glisse le long de l'arête, les arêtes les plus courtes d'abord, pour éviter les autres étiquettes, les nœuds, les titres de groupes et, quand elle le peut, les autres arêtes ; les étiquettes sont dessinées au-dessus de toutes les arêtes, donc une arête qui croise encore une étiquette passe dessous ; quand aucune place n'est libre le long de l'arête, elle se pose à côté de son milieu, à 24, 48 ou 72 px, reliée à l'arête par un trait de rappel de 1 px (`labelLeader` dans la sortie du placement). Deux arêtes entre les deux mêmes nœuds suivent le même chemin côte à côte, à 8 px de part et d'autre. `direction` n'a aucun effet avec `stress`. Limite connue : une étiquette sans place libre le long de son arête ni à côté peut encore recouvrir un nœud ou une autre étiquette. `state` et `er` refusent `layout` ; `tree` garde `tree` et `mindmap`.

### `state`

Des états, des pseudo-états facultatifs (`initial`, `final`, `choice`, `fork`, `join`, `history`), des états composites par `parent`, et des transitions avec `event`, `guard` et `action`. Extrait de `examples/order-state.json` :

```json
{
  "version": 1,
  "kind": "state",
  "title": "Order lifecycle",
  "direction": "right",
  "states": [
    { "id": "__initial", "pseudo": "initial" },
    { "id": "pending", "label": "Pending", "actions": ["entry / reserve stock"] },
    { "id": "paid", "label": "Paid" },
    { "id": "__final", "pseudo": "final" }
  ],
  "transitions": [
    { "from": "__initial", "to": "pending" },
    { "from": "pending", "to": "paid", "event": "payment received" },
    { "from": "paid", "to": "__final" }
  ]
}
```

### `er`

Des entités à attributs (`keys` : `pk`, `fk`, `uk` ; `nullable` ; `note`) et des relations dessinées avec des cardinalités en pattes de corbeau (`one`, `zero-or-one`, `one-or-more`, `zero-or-more`). Extrait de `examples/shop-er.json` :

```json
{
  "version": 1,
  "kind": "er",
  "title": "Shop orders",
  "entities": [
    {
      "id": "customer",
      "label": "Customer",
      "attributes": [
        { "name": "id", "type": "uuid", "keys": ["pk"] },
        { "name": "email", "type": "varchar(255)", "keys": ["uk"] }
      ]
    },
    {
      "id": "order",
      "label": "Order",
      "attributes": [
        { "name": "id", "type": "uuid", "keys": ["pk"] },
        { "name": "customer_id", "type": "uuid", "keys": ["fk"] }
      ]
    }
  ],
  "relations": [
    { "from": "customer", "to": "order", "fromCardinality": "one", "toCardinality": "zero-or-more", "label": "places" }
  ]
}
```

### `tree`

Une liste plate de nœuds liés par `parent`, mise en page en arbre « tidy » (`"layout": "tree"`, par défaut, avec une `direction`) ou en mindmap à deux côtés autour de la racine (`"layout": "mindmap"`). Extrait de `examples/repo-tree.json` et `examples/roadmap-mindmap.json` :

```json
{
  "version": 1,
  "kind": "tree",
  "title": "Repository layout",
  "layout": "mindmap",
  "nodes": [
    { "id": "repo", "label": "standargraph", "shape": "pill" },
    { "id": "src", "label": "src", "parent": "repo" },
    { "id": "format", "label": "format", "parent": "src" },
    { "id": "tests", "label": "tests", "parent": "repo" }
  ]
}
```

### Formes

`shape` sur un nœud `graph` ou `tree` vaut `box` (par défaut), `rect`, `pill`, `diamond`, `circle`, `ellipse`, `hexagon`, `parallelogram`, `cylinder`, `document` ou `subroutine`. Les arêtes s'arrêtent sur le contour de la forme : un flowchart est donc un `graph` avec des formes (`examples/deploy-flowchart.json`) :

```json
{
  "version": 1,
  "kind": "graph",
  "direction": "down",
  "nodes": [
    { "id": "build", "label": "Build image", "shape": "rect" },
    { "id": "green", "label": "Green?", "shape": "diamond" },
    { "id": "done", "label": "Live", "shape": "pill" }
  ],
  "edges": [
    { "from": "build", "to": "green", "directed": true },
    { "from": "green", "to": "done", "label": "yes", "directed": true }
  ]
}
```

Les formes sont dans le document ; les couleurs n'y sont jamais. Elles viennent du thème.

### Champs d'arête

Une arête de `graph` (pas un message, une transition, une relation ni une arête d'arbre) peut porter `type`, `weight`, `description` et `link` :

- `weight` est un nombre supérieur ou égal à 0. L'épaisseur du trait croît linéairement de 1,5 (le plus petit poids du document) à 6 (le plus grand) ; une arête sans poids, ou un document où tous les poids sont égaux, reste à 1,5.
- `description` s'affiche dans le panneau latéral de la page HTML et comme info-bulle native de l'arête SVG.
- `link` enveloppe l'arête dans un `<a href>` en SVG et apparaît comme lien dans le panneau. Une URL dangereuse comme `javascript:` est refusée, comme pour les nœuds.

```json
{ "from": "api", "to": "db", "type": "closed", "weight": 8, "description": "Reads and writes", "link": "https://example.com/db", "directed": true }
```

```
api -> db [type=closed, weight=8, description="Reads and writes", link="https://example.com/db"]
a -> b -> c [weight=2]
```

Les couleurs et les tirets des types d'arête viennent du thème (`edgeTypes`, voir [docs/theming.md](./docs/theming.md)).

### Syntaxe texte

Chaque type se laisse aussi écrire en texte brut, dans des fichiers nommés `.sg` par convention. Un graphe en forme à symboles :

```
graph "Release flow" [direction=right]

live "Live" [shape=pill]
group ci "CI" {
  build "Build image" [shape=rect]
  check "Green?" [shape=diamond]
}

build -> check
check -> live "yes"
```

Le même graphe en forme à mots, où `to`, `with`, `async`, `reply` et `via` remplacent les opérateurs et `do` ... `end` remplace les accolades :

```
graph "Release flow" [direction=right]

live "Live" [shape=pill]
group ci "CI" do
  build "Build image" [shape=rect]
  check "Green?" [shape=diamond]
end

build to check
check to live "yes"
```

Les deux formes se lisent comme le même document. `examples/` contient un jumeau `.sg` de chaque exemple JSON. Le sous-chemin `/text` exporte `parse`, `print`, `canonicalize`, `sniff` et `loadSource` ; une chaîne passée à `mount()` ou à `exportDocument()` passe par `loadSource`, et `standargraph convert` transforme un format en l'autre. Dans un Markdown, un bloc ` ```sg ` (ou ` ```standargraph `) contient l'un ou l'autre format :

````md
```sg
graph "Release flow"

build -> check
```
````

#### Coloration syntaxique

Le paquet livre une grammaire TextMate (`@standarx/graph/grammars/standargraph.tmLanguage.json`, scope `source.standargraph`), un `language-configuration.json` et `highlight(source)` dans le sous-chemin `/text`, qui renvoie des jetons typés avec les types de jetons sémantiques du LSP. La démo en ligne colore son éditeur avec `highlight()`. Une extension VS Code les consommera depuis son propre dépôt. Voir [docs/syntax-highlighting.md](./docs/syntax-highlighting.md) (en anglais).

### Thèmes

Un thème est un ensemble de jetons de couleur plus des couleurs facultatives par `type` de nœud, donné par `--theme <fichier.json>` dans la CLI ou par l'option `theme` de l'API. Six palettes sont prêtes à l'emploi, en `theme: "nord"` ou `--theme nord` : `light`, `dark`, `nord`, `solarized-light`, `solarized-dark` et `high-contrast`, chacune avec un contraste d'au moins 4,5:1 pour son texte.

- Un élément typé sans couleur propre en reçoit une de la palette du thème, choisie par un hachage stable de son `type`. Deux types d'un même document ne partagent jamais une entrée tant que la palette a de la place. `palette: false` dans le thème, ou `--no-palette`, la coupe, et une entrée de `types` l'emporte toujours.
- Avec `"auto"` ou une paire `{ light, dark }`, la page interactive et `mount()` affichent dans la barre d'outils un bouton qui fait défiler `auto`, `light` et `dark`, gardé dans `localStorage`.
- La démo en ligne a un panneau de thème : une palette, les jetons, une couleur par type, et un `theme.json` à télécharger pour `--theme`.

Voir [docs/theming.md](./docs/theming.md) (en anglais).

### GitHub Action

L'action composite à la racine du dépôt rend vos fichiers `.sg` avec la CLI publiée. Elle ne commite ni ne pousse jamais.

```yaml
- uses: actions/checkout@v4
- uses: miralabs-tech/standargraph@v1
  with:
    files: "docs/**/*.sg"
    mode: check
```

| Entrée | Défaut | Rôle |
| --- | --- | --- |
| `files` | `**/*.sg` | Fichiers à rendre |
| `formats` | `svg` | Formats d'export |
| `theme` | `light` | Thème du rendu |
| `out` | vide (à côté du source) | Dossier de sortie |
| `version` | la version du paquet de la ref de l'action | Version npm de `@standarx/graph` lancée |
| `mode` | `write` | `write` rend ; `check` rend puis échoue, en listant les fichiers, si une sortie diffère de l'arbre de travail ou manque |
| `cli-path` | vide | Chemin d'un `dist/cli.js` construit localement, utilisé à la place du paquet npm (CI de ce dépôt) |

[docs/diagrams-workflow.yml](./docs/diagrams-workflow.yml) est un workflow d'exemple qui rend à chaque push et commite le résultat avec de simples commandes `git`. Copiez-le dans `.github/workflows/diagrams.yml`.

---

## 📦 Installation

```sh
npm install @standarx/graph
bun add @standarx/graph
```

Node >= 20. La CLI est le binaire `standargraph`. Une fois le paquet installé, `npx standargraph` ou `bunx standargraph` la lance ; sans installation, nommez le paquet :

```sh
npx @standarx/graph export graph.json
bunx @standarx/graph export graph.json
npm install -g @standarx/graph   # puis : standargraph export graph.json
```

---

## ✨ Fonctionnalités

- **Format v1** : documents JSON de cinq types, `graph` (nœuds, arêtes, groupes imbriqués, `position` fixe facultative), `sequence` (participants, messages), `state`, `er` et `tree` (voir [Types de diagrammes](#-types-de-diagrammes)), validés par un [JSON Schema](./schema/graph-document.v1.json) publié, avec un `validate()` qui renvoie une erreur par problème et son chemin.
- **Métadonnées** : provenance (`confirmed`, `inferred`, `unknown`), couverture et fraîcheur sur les documents, nœuds, arêtes et groupes ; les éléments à faible confiance sont dessinés atténués.
- **Mise en page** : layout ELK en couches pour les graphes, les groupes, les machines à états et les diagrammes entité-relation, layout dédié aux diagrammes de séquence, layout arbre ou mindmap pour les arbres, texte mesuré avec les métriques d'Inter embarquées pour que SVG et HTML s'accordent.
- **Formes** : 11 formes de nœud sur les nœuds `graph` et `tree`, dessinées en SVG et coupées au contour par les arêtes (voir [Formes](#formes)).
- **Thèmes** : six palettes nommées, une couleur automatique par `type` de nœud, un sélecteur clair, sombre et auto, des jetons de couleur et des couleurs par `type` de nœud, un seul objet pour le SVG, le HTML, le PNG et le PDF, option `--theme <nom|fichier.json>` (voir [docs/theming.md](./docs/theming.md), en anglais).
- **Style des arêtes** : `weight`, `description` et `link` sur les arêtes de graphe, couleurs et tirets par `type` d'arête via `edgeTypes`, couleur automatique d'arête par type, pointes de flèche de la couleur de leur arête (voir [Champs d'arête](#champs-darête)).
- **Rendus** : SVG, HTML interactif (déplacement, zoom, survol, sélection, recherche, panneau, clavier, thèmes clair et sombre), et WebGL via Sigma.js.
- **WebGL au-delà de 2000 nœuds** : l'export HTML d'un `graph` bascule automatiquement en WebGL au-delà de 2000 nœuds (`--renderer` force le choix). Sur la porte v1, 10 000 nœuds en WebGL tiennent une médiane de 303 FPS (p5 285,7) plafonnée par le rafraîchissement de l'écran, et une médiane de 58,1 FPS (p5 54,3) sans plafond, sur un Intel Core i7-14700KF avec une NVIDIA GeForce RTX 4070 Ti SUPER dans Microsoft Edge 157. Détails dans [docs/bench.md](./docs/bench.md).
- **HTML hors ligne en un fichier** : polices et runtime embarqués, rien n'est téléchargé.
- **Export** : SVG, HTML, PNG et PDF depuis la CLI ou `exportDocument()`, PNG et PDF sans navigateur (resvg WASM et PDFKit).
- **Cœur headless** : contrôleur de vue avec caméra, hit testing, culling, niveau de détail et surbrillance, utilisable dans Node, Bun, un worker ou un navigateur.
- **Syntaxe texte** : chaque type en texte brut (`.sg`), en forme à symboles ou à mots, avec des erreurs en ligne et colonne, `print()` pour revenir au texte et `standargraph convert` entre les deux formats (voir [Syntaxe texte](#syntaxe-texte)).
- **Export Mermaid** : chaque type en texte Mermaid avec `toMermaid()` ou `--format mermaid`, les pertes étant signalées par des avertissements (voir [docs/mermaid.md](./docs/mermaid.md), en anglais).
- **Intégration** : `mount()` pour les applications, avec un worker de mise en page à la demande, et un plugin remark pour le Markdown.

---

## 🚧 Limites

- **La mise en page des grands graphes est lente.** ELK met en page 10 000 nœuds en environ 44 s (5 000 nœuds : 13 s, 2 000 : 3,7 s ; voir [docs/bench.md](./docs/bench.md)). Le rendu n'est pas le goulot. Une mise en page plus rapide pour les grands graphes arrive bientôt.
- **Précalculez les positions des grands graphes.** Dès que chaque nœud a une `position`, ELK est ignoré par `layout()`, `mount()` et les exports. `standargraph export` calcule la mise en page une fois et la page HTML qu'il écrit porte le résultat : l'ouvrir ne remet jamais rien en page. Pour garder les positions dans vos documents, lancez `standargraph layout graph.json` (ou `--out <fichier>`) : la commande écrit le même document avec une `position` sur chaque nœud, qui s'affiche ensuite sans ELK.

- La sortie du plugin remark ne s'affiche pas sur GitHub. Dans un README, utilisez le SVG écrit par la CLI, lié à sa page HTML (`--markdown` affiche l'extrait).
- Le rendu WebGL ne dessine ni les légendes de type de nœud, ni les libellés d'arêtes, ni les traits de rappel, ni les pointes de flèche, ne dessine pas non plus les tirets d'arête, trace les arêtes droites d'un nœud à l'autre même quand la mise en page `stress` les fait contourner des groupes, et les diagrammes `sequence`, `state`, `er` et `tree` sont toujours dessinés en SVG.

---

## 📚 Documentation

- [Cœur headless et adaptateurs](./docs/headless.md) (anglais)
- [Thèmes](./docs/theming.md) (anglais)
- [Coloration syntaxique de `.sg`](./docs/syntax-highlighting.md) (anglais)
- [Service de langage pour `.sg`](./docs/language-service.md) (anglais)
- [Export Mermaid](./docs/mermaid.md) (anglais)
- [Benchmark et temps de mise en page](./docs/bench.md) (anglais)
- [JSON Schema du format v1](./schema/graph-document.v1.json)
- [Exemples](./examples)
- [Changelog](./CHANGELOG.md) (anglais)

---

## 🛠️ Build et tests

```sh
bun install
bun run typecheck
bun test
bun run build
bun run smoke               # le paquet empaqueté, sous Node
STANDARGRAPH_BROWSER_CHANNEL=msedge bun run test:browser   # Playwright, indiquez le canal d'un navigateur installé
bun run bench               # benchmark (Microsoft Edge, avec fenêtre)
bun run runtime             # régénère les runtimes HTML et WebGL embarqués
bun run site               # construit le site GitHub Pages dans site-dist/
```

La CI épingle bun 1.4.2 pour que les bundles générés correspondent à ceux versionnés ; utilisez la même version avant de lancer `bun run runtime`.

---

## 🤝 Contribuer

Les issues et pull requests sont les bienvenues sur [github.com/miralabs-tech/standargraph](https://github.com/miralabs-tech/standargraph). Lancez typecheck, tests, build et smoke test avant d'ouvrir une pull request.

---

## ❤️ Soutien

Si StandarGraph vous aide :

👉 [Mettre une étoile](https://github.com/miralabs-tech/standargraph) · [Ouvrir une issue](https://github.com/miralabs-tech/standargraph/issues)

---

## 📜 Licence

[MIT](./LICENSE) - Copyright (c) 2026 Wesley Cormier.

Les composants tiers gardent leurs propres licences : voir [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) et les textes dans [licenses/](./licenses) (elkjs est EPL-2.0 OU GPL-3.0-or-later, resvg est MPL-2.0, Inter est SIL OFL 1.1).
