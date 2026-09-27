# Julia parser oracle for the docstring detector (06 §5).
#
# Usage: julia parser-oracle.jl file1.jl [file2.jl ...]
#
# Parses each file with `Meta.parseall` (JuliaSyntax in Julia ≥ 1.10) and prints one JSON object
# mapping each file name to the 0-based lines of every `@doc` / `Core.@doc` macrocall that has both
# a docstring and a target, i.e. every string the parser attached as documentation.
#
# Known cases the parser does not report but the detector decorates on purpose are annotated in the
# fixtures' expected.json files: `@doc str ->` newline `target` (one argument for the parser, expanded
# by the docsystem), struct field docstrings (collected by the docsystem), and the deviations of 03 §9.

function macroname(m)
    m isa GlobalRef && return string(m.name)
    m isa Symbol && return string(m)
    if m isa Expr && m.head === :. && length(m.args) == 2 && m.args[2] isa QuoteNode
        return string(m.args[2].value)
    end
    return ""
end

function collect_docs!(lines::Vector{Int}, ex)
    ex isa Expr || return lines
    if ex.head === :macrocall && length(ex.args) >= 2 && macroname(ex.args[1]) == "@doc"
        lnn = ex.args[2]
        nargs = length(ex.args) - 2
        if nargs >= 2 && lnn isa LineNumberNode
            push!(lines, lnn.line - 1)
        end
    end
    for a in ex.args
        collect_docs!(lines, a)
    end
    return lines
end

function jsonlist(xs)
    return "[" * join(string.(xs), ",") * "]"
end

entries = String[]
for path in ARGS
    src = read(path, String)
    ex = Meta.parseall(src; filename = path)
    lines = sort!(unique!(collect_docs!(Int[], ex)))
    push!(entries, "\"" * basename(path) * "\":" * jsonlist(lines))
end
println("{" * join(entries, ",") * "}")
