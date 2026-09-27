import * as assert from 'node:assert/strict';
import { scan } from '../../src/detector';

const Q = '"""';

/** [start line, end line, target line] of every detected docstring. */
function regions(src: string): Array<[number, number, number]> {
  return scan(src).docstrings.map((d) => [d.start.line, d.end.line, d.targetLine]);
}

function cases(table: ReadonlyArray<readonly [string, string, Array<[number, number, number]>]>): void {
  for (const [name, src, expected] of table) {
    it(name, () => assert.deepEqual(regions(src), expected));
  }
}

describe('detector: true positives', () => {
  cases([
    ['1. function', `${Q}docs${Q}\nfunction foo() end\n`, [[0, 0, 1]]],
    ['2. short-form function', `${Q}docs${Q}\nfoo(x) = x\n`, [[0, 0, 1]]],
    ['3a. struct', `${Q}docs${Q}\nstruct Foo end\n`, [[0, 0, 1]]],
    ['3b. mutable struct', `${Q}docs${Q}\nmutable struct Foo end\n`, [[0, 0, 1]]],
    ['3c. abstract type', `${Q}docs${Q}\nabstract type Foo end\n`, [[0, 0, 1]]],
    ['3d. primitive type', `${Q}docs${Q}\nprimitive type Foo 32 end\n`, [[0, 0, 1]]],
    ['4. macro', `${Q}docs${Q}\nmacro foo() end\n`, [[0, 0, 1]]],
    ['5a. const', `${Q}docs${Q}\nconst X = 1\n`, [[0, 0, 1]]],
    ['5b. global', `${Q}docs${Q}\nglobal g = 1\n`, [[0, 0, 1]]],
    ['5c. assignment', `${Q}docs${Q}\nx = 1\n`, [[0, 0, 1]]],
    ['6. module', `${Q}docs${Q}\nmodule M end\n`, [[0, 0, 1]]],
    ['7a. bare symbol', `${Q}docs${Q}\nfoo\n`, [[0, 0, 1]]],
    ['7b. qualified name', `${Q}docs${Q}\nBase.foo\n`, [[0, 0, 1]]],
    ['7c. signature', `${Q}docs${Q}\nfoo(x::Int)\n`, [[0, 0, 1]]],
    ['8a. @enum', `${Q}docs${Q}\n@enum E a b\n`, [[0, 0, 1]]],
    ['8b. Base.@kwdef', `${Q}docs${Q}\nBase.@kwdef struct K; a::Int = 1; end\n`, [[0, 0, 1]]],
    ['9. single-quoted string', `"docs"\nfoo(x) = x\n`, [[0, 0, 1]]],
    ['10. target on the same line', `${Q}docs${Q} foo(x) = x\n`, [[0, 0, 0]]],
    ['11a. trailing line comment', `${Q}docs${Q} # comment\nfoo(x) = x\n`, [[0, 0, 1]]],
    ['11b. trailing block comment', `${Q}docs${Q} #= c =#\nfoo(x) = x\n`, [[0, 0, 1]]],
    ['12a. @doc same line', `@doc ${Q}docs${Q} foo\n`, [[0, 0, 0]]],
    ['12b. @doc next line', `@doc ${Q}docs${Q}\nfoo(x) = x\n`, [[0, 0, 1]]],
    ['12c. @doc raw', `@doc raw${Q}docs${Q}\nfoo(x) = x\n`, [[0, 0, 1]]],
    ['12d. @doc doc', `@doc doc${Q}docs${Q}\nfoo(x) = x\n`, [[0, 0, 1]]],
    ['12e. Base.@doc', `Base.@doc ${Q}docs${Q}\nfoo(x) = x\n`, [[0, 0, 1]]],
    ['12f. @doc ->', `@doc ${Q}docs${Q} ->\nfoo(x) = x\n`, [[0, 0, 1]]],
    ['12g. @doc(str, target)', `@doc(${Q}docs${Q}, foo)\n`, [[0, 0, 0]]],
    ['13a. module', `module M\n${Q}\ndocs\n${Q}\nf(x) = x\nend\n`, [[1, 3, 4]]],
    ['13b. baremodule', `baremodule M\n${Q}docs${Q}\nf(x) = x\nend\n`, [[1, 1, 2]]],
    ['13c. begin, indented', `begin\n    ${Q}\n    docs\n    ${Q}\n    f(x) = x\nend\n`, [[1, 3, 4]]],
    ['13d. quote', `quote\n    ${Q}docs${Q}\n    f(x) = x\nend\n`, [[1, 1, 2]]],
    ['13e. @testset begin', `@testset "t" begin\n    ${Q}docs${Q}\n    f(x) = x\nend\n`, [[1, 1, 2]]],
    ['15a. file starts with the docstring', `${Q}\ndocs\n${Q}\nf(x) = x\n`, [[0, 2, 3]]],
    ['15b. target is the last line, no trailing newline', `${Q}docs${Q}\nfoo(x) = x`, [[0, 0, 1]]],
    ['16. CRLF', `${Q}\r\ndocs\r\n${Q}\r\nfoo(x) = x\r\n`, [[0, 2, 3]]],
    ['17a. Greek identifier', `${Q}docs${Q}\nθ̂(x) = x\n`, [[0, 0, 1]]],
    ['17b. emoji identifier', `${Q}docs${Q}\n🚀(x) = x\n`, [[0, 0, 1]]],
    ['18a. escaped \\"""', `${Q}\na \\""" b\n${Q}\nf(x) = x\n`, [[0, 2, 3]]],
    ['18b. $("x")', `${Q}\na $("x") b\n${Q}\nf(x) = x\n`, [[0, 2, 3]]],
    ['18c. $("""x""")', `${Q}\na $(${Q}x${Q}) b\n${Q}\nf(x) = x\n`, [[0, 2, 3]]],
    ['18d. escaped quote right before the closing quotes', `${Q}\nsays \\"hi\\"${Q}\nf(x) = x\n`, [[0, 1, 2]]],
    ['19a. after end', `f() = begin\nend\n${Q}docs${Q}\ng(x) = x\n`, [[2, 2, 3]]],
    ['19b. after an identifier', `x = y\n${Q}docs${Q}\ng(x) = x\n`, [[1, 1, 2]]],
    ['19c. after )', `f(1)\n${Q}docs${Q}\ng(x) = x\n`, [[1, 1, 2]]],
    ['19d. after @inline', `@inline\n${Q}docs${Q}\ng(x) = x\n`, [[1, 1, 2]]],
    ['19e. after a multi-line call', `f(a,\n  b)\n${Q}docs${Q}\ng(x) = x\n`, [[2, 2, 3]]],
    [
      '20. two consecutive docstrings',
      `${Q}a${Q}\nf(x) = x\n${Q}b${Q}\ng(x) = x\n`,
      [
        [0, 0, 1],
        [2, 2, 3],
      ],
    ],
  ]);
});

describe('detector: false positives', () => {
  cases([
    ['1. assignment', `x = ${Q}plain${Q}\n`, []],
    ['2a. println argument', `println(${Q}plain${Q})\nfoo(x) = x\n`, []],
    ['2b. call argument', `foo(${Q}plain${Q})\nfoo(x) = x\n`, []],
    ['2c. second line of a call', `foo(a,\n${Q}plain${Q})\nfoo(x) = x\n`, []],
    ['3. indexed assignment', `dict["x"] = ${Q}plain${Q}\nfoo(x) = x\n`, []],
    ['4. array literal', `x = [\n${Q}a${Q},\n${Q}b${Q}\n]\nfoo(x) = x\n`, []],
    ['5. continuation after =', `x =\n${Q}plain${Q}\nfoo(x) = x\n`, []],
    ['6. continuation after +', `x = 1 +\n${Q}plain${Q}\nfoo(x) = x\n`, []],
    ['7a. blank line', `${Q}docs${Q}\n\nfoo(x) = x\n`, []],
    ['7b. whitespace-only line', `${Q}docs${Q}\n   \nfoo(x) = x\n`, []],
    ['8a. comment line', `${Q}docs${Q}\n# comment\nfoo(x) = x\n`, []],
    ['8b. block comment line', `${Q}docs${Q}\n#= c =#\nfoo(x) = x\n`, []],
    ['9a. semicolon', `${Q}docs${Q}; foo(x) = x\n`, []],
    ['9b. semicolon then newline', `${Q}docs${Q};\nfoo(x) = x\n`, []],
    ['10a. bare raw string', `raw${Q}docs${Q}\nfoo(x) = x\n`, []],
    ['10b. bare doc string macro', `doc${Q}docs${Q}\nfoo(x) = x\n`, []],
    ['10c. bare md string macro', `md${Q}docs${Q}\nfoo(x) = x\n`, []],
    ['11. command string', '```cmd```\nfoo(x) = x\n', []],
    ['12. return value before end', `function f()\n${Q}return value${Q}\nend\n`, []],
    ['13a. end of file', `${Q}docs${Q}`, []],
    ['13b. newline then end of file', `${Q}docs${Q}\n`, []],
    ['14a. @doc + blank line', `@doc ${Q}docs${Q}\n\nfoo(x) = x\n`, []],
    ['14b. @doc + comment line', `@doc ${Q}docs${Q}\n# c\nfoo(x) = x\n`, []],
    ['14c. @doc + end of file', `@doc ${Q}docs${Q}`, []],
    ['14d. @doc + end', `begin\n@doc ${Q}docs${Q}\nend\n`, []],
    ['15. followed by else', `if true\n${Q}docs${Q}\nelse\nend\n`, []],
    ['16. unclosed """', `${Q}\ndocs\nfoo(x) = x\n`, []],
    ['17a. """ in a line comment', `# ${Q}\nfoo(x) = x\n`, []],
    ['17b. """ in a block comment', `#= ${Q} =#\nfoo(x) = x\n`, []],
    ['17c. character literal', `c = '"'\nfoo(x) = x\n`, []],
    ['17d. adjoint then a string', `y = x' * "'"\nfoo(x) = x\n`, []],
    ['18. escaped quotes inside a string', 's = "\\"\\"\\"\\nfoo(x)\\n\\"\\"\\""\nfoo(x) = x\n', []],
    ['19a. Markdown in a command', 'c = `echo # Arguments`\nfoo(x) = x\n', []],
    ['19b. Markdown in a string', 't = "```julia\\n# Heading\\n```"\nfoo(x) = x\n', []],
    ['21. struct field strings', `struct S\n    "docs"\n    x::Int\nend\n`, []],
  ]);
});

describe('detector: known deviations from the parser', () => {
  // An unindented block body cannot be told from the code after a block whose `end` is not typed yet.
  cases([
    ['1. deviation: unindented function body', `function outer()\n${Q}docs${Q}\ninner(x) = x\nend\n`, [[1, 1, 2]]],
    ['2. deviation: unindented if body', `if cond\n${Q}docs${Q}\nf(x) = x\nend\n`, [[1, 1, 2]]],
  ]);
});

describe('detector: block context (verified against the Julia 1.13 parser)', () => {
  cases([
    ['a function body is not a docstring block', `function outer()\n    ${Q}docs${Q}\n    inner(x) = x\nend\n`, []],
    [
      'if, @static if, for and while bodies',
      `if c\n    ${Q}d${Q}\n    f(x) = x\nend\n@static if c\n    ${Q}d${Q}\n    g(x) = x\nend\nfor i in 1:2\n    ${Q}d${Q}\n    h(x) = x\nend\nwhile false\n    ${Q}d${Q}\n    k(x) = x\nend\n`,
      [],
    ],
    [
      'let, try, do and macro bodies',
      `let\n    y = 1\n    ${Q}d${Q}\n    f(x) = x\nend\ntry\n    ${Q}d${Q}\n    g(x) = x\ncatch\nend\nmap(xs) do x\n    y = x\n    ${Q}d${Q}\n    x\nend\nmacro m()\n    ${Q}d${Q}\n    h(x) = x\nend\n`,
      [],
    ],
    [
      'begin and quote inside a function are docstring blocks again',
      `function g()\n    begin\n        ${Q}doc${Q}\n        f(x) = x\n    end\n    quote\n        ${Q}doc${Q}\n        h(x) = x\n    end\nend\n`,
      [[2, 2, 3], [6, 6, 7]],
    ],
    ['a docstring after the end of a block', `function f()\n    x = 1\nend\n${Q}doc${Q}\ng(x) = x\n`, [[3, 3, 4]]],
    ['@doc in a function body is still a docstring', `function outer()\n    @doc "doc" f\nend\n`, [[1, 1, 1]]],
    ['`end` inside brackets is an index', `function f(v)\n    v[end]\n    ${Q}not doc${Q}\n    g(x) = x\nend\n`, []],
    ['`for` and `if` in a comprehension have no `end`', `xs = [x for x in 1:3 if x > 1]\n${Q}doc${Q}\nf(x) = x\n`, [[1, 1, 2]]],
    ['a block inside brackets', `y = (begin; 1; end)\n${Q}doc${Q}\nf(x) = x\n`, [[1, 1, 2]]],
    ['abstract and primitive types end with `end`', `abstract type A end\nprimitive type P 8 end\n${Q}doc${Q}\nf(x) = x\n`, [[2, 2, 3]]],
    [
      'an unindented `@eval begin` body in a loop still takes docstrings',
      `for f in (:a, :b)\n    @eval begin\n    ${Q}doc${Q}\n    $f(x) = x\n    end\nend\n`,
      [[2, 2, 3]],
    ],
  ]);
});

describe('detector: an operator as a value at the end of a line (verified against the Julia 1.13 parser)', () => {
  cases([
    ['an operator alone as the target', `${Q}doc${Q}\n==\n${Q}doc2${Q}\nf(x) = x\n`, [[0, 0, 1], [2, 2, 3]]],
    ['`>:` alone, then a blank line', `${Q}doc${Q}\n>:\n\n${Q}doc2${Q}\nf(x) = x\n`, [[0, 0, 1], [3, 3, 4]]],
    ['`in` and `isa` alone', `${Q}a${Q}\nin\n${Q}b${Q}\nisa\n${Q}c${Q}\nf(x) = x\n`, [[0, 0, 1], [2, 2, 3], [4, 4, 5]]],
    [
      'import, using and export lists ending in an operator',
      `import Base: copy,\n    hvcat, ^\n${Q}a${Q}\nf(x) = x\nimport Core: >:\n${Q}b${Q}\ng(x) = x\nusing Base: ==\n${Q}c${Q}\nh(x) = x\nexport +, -\n${Q}d${Q}\nk(x) = x\n`,
      [[2, 2, 3], [5, 5, 6], [8, 8, 9], [11, 11, 12]],
    ],
    [
      'an operator assigned to a name',
      `const ≤ = <=\n${Q}a${Q}\nf(x) = x\nx = -\n${Q}b${Q}\ng(x) = x\ny = .+ # comment\n${Q}c${Q}\nh(x) = x\n`,
      [[1, 1, 2], [4, 4, 5], [7, 7, 8]],
    ],
    ['a public list (Julia 1.11)', `module M\npublic +\n${Q}doc${Q}\nf(x) = x\nend\n`, [[2, 2, 3]]],
    ['`public` as a variable', `public = 1\n${Q}doc${Q}\nf(x) = x\n`, [[1, 1, 2]]],
    [
      'a splat ends the line (a Makie recipe)',
      `@recipe Arc (a, b) begin\n    documented_attributes(Lines)...\n    "The number of line points."\n    resolution = 100\nend\n`,
      [[2, 2, 3]],
    ],
    ['a binary operator or keyword after a value continues the expression', `a ==\n${Q}doc${Q}\nf(x) = x\nx isa\n${Q}doc${Q}\ng(x) = x\n`, []],
    ['a dotted operator after a value, and `..`', `x = a .+\n${Q}doc${Q}\nf(x) = x\n\nr = x..\n${Q}doc${Q}\ng(x) = x\n`, []],
    ['`=` after an operator standing alone is the assignment', `const ≠ =\n${Q}doc${Q}\nf(x) = x\n`, []],
    ['`::` takes its operand from the next line', `x = ::\n${Q}doc${Q}\nf(x) = x\n`, []],
  ]);
});

describe('detector: struct bodies (field strings are not decorated)', () => {
  cases([
    [
      'the struct docstring is decorated, its field strings are not',
      `${Q}Model docs${Q}\nstruct Model\n    "Parameter vector."\n    θ::Vector{Float64}\n    "Label."\n    name::String\nend\n`,
      [[0, 0, 1]],
    ],
    ['mutable struct and Base.@kwdef struct', `mutable struct M\n    "f"\n    x::Int\nend\nBase.@kwdef struct K\n    "f"\n    a::Int = 1\nend\n`, []],
    [
      'an inner constructor does not end the struct',
      `struct S\n    x::Int\n    function S()\n        new(0)\n    end\n    "field"\n    y::Int\nend\n${Q}doc${Q}\nf(x) = x\n`,
      [[8, 8, 9]],
    ],
    ['`end` in an index inside the struct', `struct S\n    v::Vector{Int}\n    S() = new([1, 2][end:end])\n    "field"\n    w::Int\nend\n`, []],
    ['a one-line struct', `struct S; "field"; x::Int; end\n`, []],
  ]);
});

describe('detector: cases verified against the Julia 1.13 parser', () => {
  cases([
    ['a triple-quoted string ends at the first """', `${Q}\nabc${Q}"\nf(x) = x\n`, []],
    ['a block comment spanning lines after the string is trivia', `${Q}doc${Q} #= a\nb =#\nf(x) = x\n`, [[0, 0, 2]]],
    ['a block comment before the target on its line is trivia', `${Q}doc${Q}\n#= c =# f(x) = x\n`, [[0, 0, 1]]],
    ['a binary operator on the same line', `"doc" * x\nf(x) = x\n`, []],
    ['$ on the same line is a binary operator', `quote\n"doc" $f(x) = x\nend\n`, []],
    ['a call on the string', `"doc"(x)\nf(x) = x\n`, []],
    ['indexing the string', `"doc"[1]\nf(x) = x\n`, []],
    ['where / isa after the string', `"doc" where T\nf\n"doc" isa String\ng\n`, []],
    ['a comma after the string', `"doc", f\n`, []],
    ['adjoint of the string', `"doc"'\nf\n`, []],
    ['begin on the same line', `begin "doc" f(x) = x end\n`, [[0, 0, 0]]],
    ['string after a semicolon on the same line', `x = 1; "doc"\nf(x) = x\n`, [[0, 0, 1]]],
    ['@doc with a macro call target', `@doc "doc" @enum E a b\n`, [[0, 0, 0]]],
    ['@doc call form across lines', `@doc(\n  "doc",\n  f)\n`, [[0, 1, 2]]],
    ['@doc on its own line: the string is a plain docstring', `@doc\n${Q}doc${Q}\nf(x) = x\n`, [[1, 1, 2]]],
    ['a symbol keyword before the string', `x = :function\n${Q}doc${Q}\nf(x) = x\n`, [[1, 1, 2]]],
    ['a field named type before the string', `y = el.type\n${Q}doc${Q}\nf(x) = x\n`, [[1, 1, 2]]],
    ['`abstract type` continues onto the next line', `abstract type\n${Q}doc${Q}\nf(x) = x\n`, []],
    ['an identifier ending in ! before the string', `push!\n${Q}doc${Q}\nf(x) = x\n`, [[1, 1, 2]]],
    ['!= before the string', `a !=\n${Q}doc${Q}\nf(x) = x\n`, []],
    ['a Unicode operator before the string', `a = b ∘\n${Q}doc${Q}\nf(x) = x\n`, []],
    ['a transpose before the string', `y = x'\n${Q}doc${Q}\nf(x) = x\n`, [[1, 1, 2]]],
    ["an escaped '\\'' character before the string", `c = '\\''\n${Q}doc${Q}\nf(x) = x\n`, [[1, 1, 2]]],
    ['var"…" before the string', `var"x y" = 1\n${Q}doc${Q}\nf(x) = x\n`, [[1, 1, 2]]],
    ['1e-3 before the string', `x = 1e-3\n${Q}doc${Q}\nf(x) = x\n`, [[1, 1, 2]]],
    ['a ternary : before the string', `x = a ? b :\n${Q}doc${Q}\nf(x) = x\n`, []],
    ['a comment inside an interpolation', `${Q}doc $(x # c\n) more${Q}\nf(x) = x\n`, [[0, 1, 2]]],
    ['an interpolated target on the next line', `"doc"\n$(name)(x) = x\n`, [[0, 0, 1]]],
    ['`$name` target after one newline', `quote\n"doc"\n$f(x) = x\nend\n`, [[1, 1, 2]]],
    ['a blank line containing a tab', `${Q}doc${Q}\n\t\nf(x) = x\n`, []],
    ['followed by elseif', `if a\n${Q}doc${Q}\nelseif b\nend\n`, []],
    ['followed by finally', `try\nx\ncatch\n${Q}doc${Q}\nfinally\nend\n`, []],
    ['a nested, indented module', `module A\n    module B\n        ${Q}doc${Q}\n        f(x) = x\n    end\nend\n`, [[2, 2, 3]]],
    ['a chain of two docstrings', `"a"\n"b"\nf\n`, [[0, 0, 1], [1, 1, 2]]],
  ]);
});

describe('detector: number literals before the string (verified against the Julia 1.13 parser)', () => {
  cases([
    ['a trailing dot belongs to the number: 1.', `x = 1.\n${Q}doc${Q}\nf(x) = x\n`, [[1, 1, 2]]],
    ['1.0', `x = 1.0\n${Q}doc${Q}\nf(x) = x\n`, [[1, 1, 2]]],
    ['1.e3 and 1.f0', `x = 1.e3\ny = 1.f0\n${Q}doc${Q}\nf(x) = x\n`, [[2, 2, 3]]],
    ['1. before a comment', `x = 1. # c\n${Q}doc${Q}\nf(x) = x\n`, [[1, 1, 2]]],
    ['1. inside brackets', `x = [1., 2.]\n${Q}doc${Q}\nf(x) = x\n`, [[1, 1, 2]]],
    ['a broadcast operator after a number continues the expression', `x = 1 .+\n${Q}doc${Q}\nf(x) = x\n`, []],
    ['.. after a number continues the expression', `r = 1..\n${Q}doc${Q}\nf(x) = x\n`, []],
    ['a binary operator after 1.0 continues the expression', `x = 1.0 +\n${Q}doc${Q}\nf(x) = x\n`, []],
  ]);
});

describe('detector: operators after the string (verified against the Julia 1.13 parser)', () => {
  cases([
    ['@doc: an operator method is the target', `@doc "doc" +(x::T) = x\n`, [[0, 0, 0]]],
    ['a plain string followed by + is a binary operation', `"doc" +(x::T) = x\n`, []],
    ['Base.@doc and @doc raw with an operator target', `Base.@doc "doc" -(x::T) = x\n@doc raw"doc" ~(x::T) = x\n`, [[0, 0, 0], [1, 1, 1]]],
    ['@doc: unary-capable operators directly before their operand', `@doc "doc" -1\n@doc "doc" $f(x) = x\n@doc "doc" &(x::T) = x\n@doc "doc" :x\n@doc "doc" ±(x::T) = x\n`, [[0, 0, 0], [1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 4]]],
    ['@doc: a comment before the operator counts as whitespace', `@doc "doc" #= c =# +(x) = x\n`, [[0, 0, 0]]],
    ['@doc: whitespace after the operator makes it binary', `@doc "doc" + x\n\n@doc "doc" - (x)\n\n@doc "doc" +#= c =#(x) = x\n`, []],
    ['@doc: no whitespace before the operator makes it binary', `@doc "doc"+x\n`, []],
    ['@doc: binary-only operators continue the string', `@doc "doc" *(x::T) = x\n\n@doc "doc" <:(x::T) = x\n\n@doc "doc" ::T\n`, []],
    ['@doc: compound and suffixed operators continue the string', `@doc "doc" +=(x)\n\n@doc "doc" &&x\n\n@doc "doc" +₁(x) = x\n\n@doc "doc" -->x\n`, []],
    ['@doc: a dotted operator continues the string', `@doc "doc" .+(x::T) = x\n`, []],
    ['@doc: != continues the string', `@doc "doc" != x\n`, []],
    ['a unary-only operator starts the target', `"doc" !(x::T) = x\n"doc" √(x::T) = x\n"doc"!x\n`, [[0, 0, 0], [1, 1, 1], [2, 2, 2]]],
    ['@doc: a unary-only operator starts the target', `@doc "doc" ¬ x\n`, [[0, 0, 0]]],
    ['!= and !== after a plain string continue it', `"doc" != x\n"doc" !== x\n`, []],
  ]);
});

describe('detector: incomplete input while typing', () => {
  it('an unclosed """ pairs with the next opening quotes, as in Julia and the host grammar', () => {
    const src = `${Q}\ntyping\n\n${Q}\ndoc\n${Q}\nf(x) = x\n`;
    // The string runs from line 0 to line 3; `doc` then becomes its target.
    assert.deepEqual(regions(src), [[0, 3, 4]]);
  });
  it('docstring closed but no target yet', () => {
    assert.deepEqual(regions(`${Q}\ndoc\n${Q}\n`), []);
  });
  it('an unclosed bracket does not hide the docstrings after it', () => {
    const src = `foo((x)\n${Q}\ndoc\n${Q}\nf(x) = x\n`;
    assert.deepEqual(regions(src), [[1, 3, 4]]);
  });
  it('an unclosed bracket still blocks strings that continue its own expression', () => {
    const src = `x = [\n${Q}a${Q},\n${Q}b${Q}\n`;
    assert.deepEqual(regions(src), []);
  });
  it('balanced brackets after an unclosed one keep their pairing', () => {
    const src = `foo(a\nbar(\n${Q}not doc${Q}\n)\n${Q}doc${Q}\nf(x) = x\n`;
    assert.deepEqual(regions(src), [[4, 4, 5]]);
  });
  it('a struct without its `end` yet: the fields are not decorated, the docstrings below it are', () => {
    const src = `struct S\n    "field"\n    x::Int\n\n${Q}doc${Q}\nf(x) = x\n`;
    assert.deepEqual(regions(src), [[4, 4, 5]]);
  });
  it('a function without its `end` yet does not take in the rest of the module', () => {
    // The module's `end` closes the function instead; the docstring below is at the function's own indentation.
    const src = `module M\nfunction b()\n    x = 1\n\n${Q}doc${Q}\nc() = 1\nend\n`;
    assert.deepEqual(regions(src), [[4, 4, 5]]);
  });
});

describe('detector: docstring record', () => {
  it('reports kind, quote, prefix and positions (UTF-16 columns)', () => {
    const src = `x = 1\n@doc raw${Q}θ docs${Q}\nf(x) = x\n`;
    const [d] = scan(src).docstrings;
    assert.ok(d);
    assert.equal(d.kind, 'atdoc');
    assert.equal(d.quote, 'triple');
    assert.equal(d.prefix, 'raw');
    assert.deepEqual(d.start, { line: 1, col: 0 });
    assert.deepEqual(d.contentStart, { line: 1, col: 11 });
    assert.deepEqual(d.contentEnd, { line: 1, col: 17 });
    assert.deepEqual(d.end, { line: 1, col: 20 });
    assert.equal(d.targetLine, 2);
  });
  it('columns count emoji as two UTF-16 code units', () => {
    const src = `"🚀 doc" f(x) = x\n`;
    const [d] = scan(src).docstrings;
    assert.deepEqual(d?.end, { line: 0, col: 8 });
  });
  it('Mod.@doc regions start at the module name', () => {
    const [d] = scan(`  Core.@doc "x" f\n`).docstrings;
    assert.deepEqual(d?.start, { line: 0, col: 2 });
  });
  it('an empty or docstring-free file', () => {
    assert.deepEqual(scan('').docstrings, []);
    assert.deepEqual(scan('x = 1\n').docstrings, []);
  });
});
