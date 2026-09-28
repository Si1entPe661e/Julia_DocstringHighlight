@doc raw"""
    kl(p, q)

The divergence ``\sum_i p_i \log(p_i / q_i)`` costs $x$ and \$ dollars.

```jldoctest
julia> kl([0.5, 0.5], [0.5, 0.5])
0.0
```
"""
kl(p, q) = sum(p .* log.(p ./ q))
@doc raw"""Escaped \""" quotes stay inside; \alpha is literal.""" g
w = 1
