# Every kind of documented expression (03 §2.3).

"""Struct."""
struct Foo end

"""Mutable struct."""
mutable struct Bar
    x::Int
end

"""Abstract type."""
abstract type AbstractThing end

"""Primitive type."""
primitive type Prim 32 end

"""Macro."""
macro mymacro() end

"""Constant."""
const X = 1

"""Global."""
global g = 1

"""Assignment."""
y = 1

"""Module."""
module Inner end

"""Bare symbol."""
foo

"""Qualified name."""
Base.sum

"""Signature."""
foo(x::Int)

"""Enum."""
@enum Fruit apple orange

"""Keyword struct."""
Base.@kwdef struct K
    a::Int = 1
end

"""Struct with field docstrings."""
struct WithFields
    "The x field."
    x::Int
    """
    The y field.
    """
    y::Float64
end

"""Multi-line target."""
multiline(x) =
    x

"""Greek identifier."""
θ̂(x) = x

"""Emoji identifier."""
🚀(x) = x

"""An assignment ending in the field name `type`, which is not a keyword here."""
field_type = el.type
"""After a line ending in the identifier `type`."""
after_type(x) = x
