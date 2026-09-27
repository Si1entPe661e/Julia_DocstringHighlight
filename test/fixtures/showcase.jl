module Estimation

using LinearAlgebra

export Model, run_mle

"""
    Model(θ, name)

A statistical model with parameter vector `θ`.

# Fields

- `θ::Vector{Float64}`: parameters
- `name::String`: a label used in reports
"""
struct Model
    "Parameter vector."
    θ::Vector{Float64}
    "Label used in reports."
    name::String
end

"""
    run_mle(l, θ₀; maxiter = 100)

Runs MLE estimation with a given likelihood function `l`.

# Arguments

- `l`: likelihood function
- `θ₀`: initial parameter vector
- `maxiter`: maximum number of iterations

# Returns

A tuple `(θ̂, Σ̂)` with the estimate and its covariance; see [`Model`](@ref).

!!! note "Convergence"
    The optimizer stops early when the **gradient norm** is below `1e-8`.

# Examples

```jldoctest
julia> θ̂, Σ̂ = run_mle(θ -> -sum(abs2, θ), [1.0, 2.0]);

julia> round.(θ̂; digits = 3)
2-element Vector{Float64}:
 0.0
 0.0
```

```julia
θ̂, Σ̂ = run_mle(l, θ₀)
```
"""
function run_mle(l, θ₀; maxiter = 100)
    θ = copy(θ₀)
    for _ in 1:maxiter
        g = gradient(l, θ)
        norm(g) < 1e-8 && break
        θ .+= 0.1 .* g
    end
    report = """
    # not a docstring
    θ = $(θ)
    """
    return θ, inv(hessian(l, θ)), report
end

@doc raw"""
    gradient(f, x)

Central finite-difference gradient ``\nabla f(x)``.
"""
function gradient(f, x; h = 1e-6)
    return [(f(x .+ h .* e) - f(x .- h .* e)) / 2h for e in eachcol(I(length(x)))]
end

"Numerical Hessian of `f` at `x` (see `gradient`)."
hessian(f, x) = reduce(hcat, (gradient(y -> gradient(f, y)[i], x) for i in eachindex(x)))

end # module
