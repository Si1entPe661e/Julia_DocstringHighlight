module Outer

"""
Docstring at module level.
"""
module_level(x) = x

    """
    Indented docstring inside a module.
    """
    indented(x) = x

baremodule Bare
"""
Inside a baremodule.
"""
bare_fn(x) = x
end

module Nested
"""
Inside a nested module.
"""
nested_fn(x) = x
end

end # module Outer

begin
    """
    Inside begin.
    """
    in_begin(x) = x
end

quote
    """
    Inside quote.
    """
    in_quote(x) = x
end

using Test
@testset "set" begin
    """
    Inside @testset begin.
    """
    in_testset(x) = x
end

function outer()
    """
    Deviation: a string statement inside a function body.
    """
    inner(x) = x
end

if true
    """
    Deviation: inside an if block.
    """
    in_if(x) = x
end

for i in 1:2
    """
    Deviation: inside a for loop.
    """
    in_for(x) = x
end
