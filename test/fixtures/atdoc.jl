# @doc forms (03 §2.5).

@doc """Same line.""" same_line(x) = x

@doc """
Next line.
"""
next_line(x) = x

@doc raw"""
Raw string: \alpha
"""
raw_doc(x) = x

@doc doc"""
doc string macro.
"""
doc_doc(x) = x

Base.@doc """
Qualified @doc.
"""
qualified(x) = x

Core.@doc "Core-qualified." core_qualified

@doc """
Arrow form.
""" ->
arrow_form(x) = x

@doc("""
Call form.
""", call_form)

call_form(x) = x

# Not docstrings: blank line, comment line, `end`, end of file.

@doc """Blank line after."""

blank_after(x) = x

@doc """Comment line after."""
# comment
comment_after(x) = x

begin
    @doc """Followed by end."""
end

@doc """At the end of the file."""
