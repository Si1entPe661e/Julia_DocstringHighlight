# Number literals that end a statement right before a docstring. A trailing dot belongs to the
# number (`1.` is a Float64), so the statement is complete and the next string is a docstring.

trailing_dot = 1.
"""After `1.`."""
after_trailing_dot(x) = x

fraction = 1.0
"""After `1.0`."""
after_fraction(x) = x

with_exponent = 1.e3
"""After `1.e3`."""
after_exponent(x) = x

single = 1.f0
"""After `1.f0`."""
after_single(x) = x

commented = 1. # a comment
"""After `1.` and a comment."""
after_comment(x) = x

vector = [1., 2.]
"""After a vector of `1.` literals."""
after_vector(x) = x

transposed = 1.'
"""After the adjoint of `1.`."""
after_transposed(x) = x

# Not docstrings: a broadcast operator or `..` at the end of a line continues the expression.

joined = ["a"] .*
"""joined to the vector by `.*`"""
not_after_broadcast(x) = x

interval = 1..
"""the right operand of `..`"""
not_after_range(x) = x
