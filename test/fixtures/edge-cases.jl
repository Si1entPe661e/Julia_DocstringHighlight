"""
The file starts with a docstring (no leading newline).
"""
at_file_start(x) = x

"""
Contains escaped quotes: \""" and \"\"\" stay inside.
"""
escaped(x) = x

"""
Interpolation with nested strings: $("x") and $("""y""") and $(join(["a", "b"])).
"""
interpolated(x) = x

"""
Ends with an escaped quote right before the closing quotes: \""""
escaped_quote_at_end(x) = x

	"""
	Tab-indented docstring.
	"""
	tab_indented(x) = x

# """ a triple quote in a comment is ignored
#= """ also in a block comment =#

c = '"'
"""
After a character literal containing a double quote.
"""
after_char(x) = x

b = a' * "'"
"""
After an adjoint followed by a string containing an apostrophe.
"""
after_adjoint(x) = x

run(`echo "not a string"`)
"""
After a command string containing quotes.
"""
after_cmd(x) = x

"""
A block comment that spans lines is trivia, so the target is one newline away.
""" #= multi
line =#
after_block_comment(x) = x

"""
The last docstring documents the last expression, with no trailing newline.
"""
at_file_end(x) = x