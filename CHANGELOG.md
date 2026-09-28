# Changelog

All notable changes to this extension are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-09-28

### Changed

- Every theme colors docstrings the way it colors Markdown and Julia: the text of a docstring is scoped like
  a Markdown file and its signature and examples like Julia code, outside the string scope. Prose uses the
  theme's Markdown text color instead of its string color; the quotes keep the string color. Signatures and
  examples no longer take on the string color, or the color of Markdown code blocks, in themes such as GitHub,
  Catppuccin or Atom One Dark, and headings, lists, links and inline code get the colors the theme gives them in
  Markdown files.
- To recolor docstring prose, use the scope `embed.docstring.julia meta.paragraph.markdown` (was
  `text.docstring.julia`).
- Markdown and Julia highlighting also covers `@doc raw"""…"""` (without escapes or interpolation, since
  backslashes and dollar signs are literal there), `@doc "…"`, docstrings that start on the line of their
  opening `"""`, one-line `"""…"""` docstrings, and the text before the closing quotes.

## [0.1.2] - 2026-09-27

### Changed

- Strings before the fields of a `struct` no longer get a docstring region.
- String statements in function bodies and `if` / `for` / `while` / `let` / `try` / `do` / `macro` blocks no
  longer get a docstring region either: Julia does not treat them as docstrings. While a block's `end` is not
  typed yet, the docstrings below it keep their region.

### Fixed

- A docstring is detected after a line that ends in an operator used as a value, such as an operator
  documented on its own (`==`), an import or export list (`import Base: ^`) or an assignment
  (`const ≤ = <=`), and after a line that ends in a splat (`attributes...` in a Makie recipe).

## [0.1.1] - 2026-09-26

### Fixed

- Markdown highlighting no longer runs past a docstring whose closing quotes follow an even number of
  backslashes (`\\"""`), which colored the code after it as documentation.
- Long docstrings without inline code no longer slow down scanning: the search for backticks stays on its
  line. On an Apple Silicon laptop, a 50,000-line docstring took about 1.5 s to scan and now takes about 15 ms.
- A docstring right after a statement that ends in a number with a trailing dot (`x = 1.`) is detected.
- Docstrings of operator methods are detected: `@doc "…" +(a::T, b::T) = …` and `"…" !(a::T) = …`.

## [0.1.0] - 2026-09-26

### Added

- Docstring detection that follows Julia's parser: statement position, exactly one line break before the
  documented expression, `@doc` forms (`@doc raw"""…"""`, `Base.@doc`, `@doc str ->`, `@doc(str, target)`),
  struct field docstrings.
- Whole-line region background, a 1px left guide and inline code chips, with colors from the theme color slots
  `juliaDocstring.background`, `juliaDocstring.guide` and `juliaDocstring.inlineCodeBackground`
  (defaults for dark, light, high contrast and high contrast light themes).
- Markdown and Julia highlighting inside docstrings through a grammar injected into `string.docstring.julia`:
  headings, lists, emphasis, links, inline code, Documenter admonitions, the indented signature, and fenced Julia
  examples (`julia`, `jldoctest`, `julia-repl`, `@example`, `@repl`, `@setup`, unlabelled) with a separate scope
  for the `julia>` prompt.
- Settings `juliaDocstringHighlight.enabled`, `showBackground`, `showGuide` and `showInlineCodeBackground`.
