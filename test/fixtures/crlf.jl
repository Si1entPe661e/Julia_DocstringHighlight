"""
    crlf(x)

# Arguments

- `x`: a value
"""
crlf(x) = x

"""
Blank line with CRLF breaks the docstring.
"""

not_documented(x) = x

@doc """
CRLF @doc.
"""
atdoc_crlf(x) = x
