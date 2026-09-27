# None of the strings in this file are docstrings.

x = """plain"""

println("""plain""")
foo("""plain""")
foo(a,
    """plain""")

dict["x"] = """plain"""

arr = [
"""a""",
"""b"""
]

cont =
"""plain"""
foo1(x) = x

sum1 = 1 +
"""plain"""
foo2(x) = x

"""blank line"""

foo3(x) = x

"""whitespace-only line"""
    
foo4(x) = x

"""comment line"""
# comment
foo5(x) = x

"""block comment line"""
#= c =#
foo6(x) = x

"""semicolon"""; foo7(x) = x

"""semicolon then newline""";
foo8(x) = x

raw"""raw string"""
foo9(x) = x

doc"""doc string macro"""
foo10(x) = x

md"""markdown string macro"""
foo11(x) = x

```command string```
foo12(x) = x

function f()
"""return value"""
end

if true
"""followed by else"""
else
end

s = "\"\"\"\nfoo(x)\n\"\"\""
foo13(x) = x

cmd = `echo # Arguments`
t = "```julia\n# Heading\n```"

"""followed by an operator""" * suffix
foo14(x) = x

"""followed by end of file"""
