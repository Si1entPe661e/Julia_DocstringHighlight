# Methods of operators as docstring targets. `@doc` arguments are separated by spaces, like the
# elements of `[a +b]`: an operator after whitespace and directly before its operand starts the
# target. An operator that is only unary (`!`, `√`) starts it after any docstring.

import Base: +, -, ~, !, √

struct Money
    cents::Int
end

@doc "Adds two amounts." +(a::Money, b::Money) = Money(a.cents + b.cents)

@doc """
Negates an amount.
""" -(a::Money) = Money(-a.cents)

@doc raw"Subtracts one amount from another." -(a::Money, b::Money) = Money(a.cents - b.cents)

Base.@doc "Complements the cents." ~(a::Money) = Money(~a.cents)

"Whether the amount is zero." !(a::Money) = iszero(a.cents)

"""The square root of the cents.""" √(a::Money) = sqrt(a.cents)

# Not docstrings: the string is the left operand of a binary operator. (Blank lines keep the parser
# from documenting the next line with the whole `@doc` argument.)

@doc "not a docstring" + a

@doc "not a docstring"+a

@doc "not a docstring" *(a::Money) = a

"not a docstring" +(a::Money) = a

# An operator where an operand is expected, with nothing after it on the line, is a value: the
# statement is complete, and the next line can hold a docstring.

import Base: *, ^
"""The product of an amount and a number."""
*

const ≤ = <=
"""Compares two amounts."""
compare(a::Money, b::Money) = a.cents ≤ b.cents
