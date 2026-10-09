# Typed Run mapper golden corpus

31 real HandlerFact-shaped cases feed the ONE TS mapper in `parity-2b.ts`.
`expected.json` pins canonical rows and quarantine decisions, including null
snapshot options. The in-process vitest row reproduces it byte for byte.
There is no SQL mapper or SQL parity script. Database storage is rehearsed
with TS-generated data in `rehearse-a-fixture.sql`, not another derivation.
Duplicate run IDs follow the storage uniqueness rule. Refusal markers are
not Runs; the sweep records a compact terminal skipped disposition so they
cannot starve later facts. Missing legacy identity policy remains explicit
in mapper tests. No database-derived current revision is substituted.
