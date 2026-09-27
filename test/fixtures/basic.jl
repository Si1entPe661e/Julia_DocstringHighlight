# Basic docstring forms: a triple-quoted string on its own lines + function / short-form function.

"""
    foo()

Returns nothing.
"""
function foo() end

"""
    bar(x)

Identity.
"""
bar(x) = x

"""Single-line docstring."""
baz(x) = 2x

"Single-quoted docstring."
qux(x) = x + 1

"""Same-line target.""" same_line(x) = x

"""
Trailing line comment after the closing quotes.
""" # comment
with_comment(x) = x

"""
Trailing block comment after the closing quotes.
""" #= c =#
with_block_comment(x) = x

"""
First of two consecutive docstrings.
"""
first_fn(x) = x
"""
Second of two consecutive docstrings.
"""
second_fn(x) = x

y = 1
"""
After a complete expression on the previous line.
"""
after_assignment(x) = x

@inline
"""
After a macro call line.
"""
after_macro(x) = x

println(1,
        2)
"""
After the closing line of a multi-line call.
"""
after_call(x) = x
