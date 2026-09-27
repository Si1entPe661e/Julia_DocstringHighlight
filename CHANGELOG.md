# Changelog

All notable changes to this extension are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-09-26

### Changed

- Strings before the fields of a `struct` no longer get a docstring region.
- String statements in function bodies and `if` / `for` / `while` / `let` / `try` / `do` / `macro` blocks no
  longer get a docstring region either: Julia does not treat them as docstrings. While a block's `end` is not
  typed yet, the docstrings below it keep their region.

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
