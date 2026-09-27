# Julia parser oracle for the docstring detector (06 §5).
#
# Usage: julia parser-oracle.jl file1.jl [file2.jl ...]
#        julia parser-oracle.jl --list paths.txt
#
# Parses each file with `Meta.parseall` (JuliaSyntax in Julia ≥ 1.10) and prints one JSON object
# mapping each file name to the 0-based lines of every `@doc` / `Core.@doc` macrocall that has both
# a docstring and a target, i.e. every string the parser attached as documentation. With `--list`,
# the files are read from paths.txt (one per line) and keyed by their full path; a file that cannot
# be read or parsed maps to null (test/tools/corpus-check.mjs).
#
# Known cases the parser does not report but the detector decorates on purpose are annotated in the
# fixtures' expected.json files: `@doc str ->` newline `target` (one argument for the parser, expanded
# by the docsystem) and the deviations of 03 §9. Struct field docstrings are neither reported by the
# parser nor decorated.

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

function jsonstring(s)
    io = IOBuffer()
    print(io, '"')
    for c in s
        if c == '"' || c == '\\'
            print(io, '\\', c)
        elseif c < ' '
            print(io, "\\u", string(UInt32(c); base = 16, pad = 4))
        else
            print(io, c)
        end
    end
    print(io, '"')
    return String(take!(io))
end

function doc_lines(path)
    ex = Meta.parseall(read(path, String); filename = path)
    return sort!(unique!(collect_docs!(Int[], ex)))
end

entries = String[]
if length(ARGS) == 2 && ARGS[1] == "--list"
    for path in readlines(ARGS[2])
        lines = try
            jsonlist(doc_lines(path))
        catch
            "null"
        end
        push!(entries, jsonstring(path) * ":" * lines)
    end
else
    for path in ARGS
        push!(entries, jsonstring(basename(path)) * ":" * jsonlist(doc_lines(path)))
    end
end
println("{" * join(entries, ",") * "}")
