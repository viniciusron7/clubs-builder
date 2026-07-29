# HiGHS browser runtime

Vendored from the `highs` npm package, version 1.15.2.

- Project: https://github.com/lovasoa/highs-js
- Solver: https://github.com/ERGO-Code/HiGHS
- License: MIT (see `LICENSE.txt`)

The optimizer loads these files lazily in its Web Worker only when it has
already certified the best multi-position OVR objective and needs to minimize
the AP cost of that objective.
