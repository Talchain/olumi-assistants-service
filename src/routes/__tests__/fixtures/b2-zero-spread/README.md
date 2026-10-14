# B2 d2 zero-spread regression fixture

These are the acceptance lane's own witness captures for scenario
`5e0fbc03-8af8-488e-b02f-82c25499e59e`, served by CEE staging
`f8ed674dec63758a2945acaffebe67e26a5f0a4a`.

- `run.json` is copied byte-for-byte from
  `/Users/paulslee/olumi-work/accept-f/a2-b2w-d2/run.json`.
- `read-graph-1791489457020.json` is the newest stored `wire/read-graph-*.json`
  when this regression was authored, copied byte-for-byte from the same lane.
- `starter-point-staging.json` freezes the producer, transport, canonical view
  and Agent-reader outputs from staging's own code at
  `69ff73cf180efb4099c10446197661a33f9777da` (#2878), on the same graph and Run.

The public Run already had Keep's unearned exact zero removed by the transport.
The regression restores only `Keep.probability_of_goal = 0`, the exact value
observed by the lane and supplied in the build brief, to exercise the producer
before applying the real transport again. This is a reconstruction of the
producer input from the witness, not a fresh engine draw. Raise and Starter
retain their stored scoped warnings; neither has a licensed point.

The Starter-point control additionally sets only
`Starter.probability_of_goal = 0.97`. Its stored range continues to dominate the
canonical cell, and every stored warning remains intact. The staging snapshot
records this precise derivation. The rebound control asserts byte identity for
the producer, transport, Agent facts, screen lines and every non-Keep canonical
cell. It requires Keep's canonical cell to carry the `zero_spread` reason,
face `Chance not shown yet`, and
`why = Not shown yet: needs month-by-month changes`.

The regenerated staging snapshot records Keep with `reason_not_recorded`, the
same short face, and the run-wide identity sentence from Raise's scoped
`GOAL_FIGURES_TARGET_NOT_TESTABLE` warning in `why`. All witness warnings remain
untouched. The fixture records that actual staging result; it does not replace
the sentence with the branch's required Keep line.
The current rebased branch carries Keep's `zero_spread` reason but still selects
that Raise sentence for Keep's `why`, so its required Keep-identity assertion
remains RED.

## Reproduce the pinned staging control

`generate-staging-control.ts` uses only Node built-ins plus absolute dynamic
imports of the producer, transport, canonical projector and Agent readers in
`/private/tmp/b2zs-staging-69ff`. It asserts that the execution directory is
that detached worktree, HEAD is the full staging SHA above, every directly
imported source file matches that commit, and the tracked worktree is clean
before and after generation. Inputs and output live beside the script; no code
is imported from this branch. The witness hashes are asserted unchanged.

The ordinary preparation command is:

```sh
git worktree add --detach /private/tmp/b2zs-staging-69ff 69ff73cf180efb4099c10446197661a33f9777da < /dev/null
ln -s /private/tmp/accel-er-event-cee/node_modules /private/tmp/b2zs-staging-69ff/node_modules
```

In this sandbox the first command returned 128 because its shared Git metadata
is outside writable roots. The actual regeneration used a temporary shared
bare repository, then the same detached-worktree operation; upstream Git
metadata was not changed:

```sh
git clone --shared --bare /private/tmp/accel-er-b2scope-cee /private/tmp/b2zs-staging-git-69ff.git < /dev/null
git --git-dir=/private/tmp/b2zs-staging-git-69ff.git worktree add --detach /private/tmp/b2zs-staging-69ff 69ff73cf180efb4099c10446197661a33f9777da < /dev/null
ln -s /private/tmp/accel-er-event-cee/node_modules /private/tmp/b2zs-staging-69ff/node_modules
```

Run from the detached staging worktree. The fresh load check's exit code gates
the generator, which uses a single script and no test batch:

```sh
cd /private/tmp/b2zs-staging-69ff
node -e 'const load = require("os").loadavg()[0]; console.log(JSON.stringify({load, threshold:25})); process.exit(Number.isFinite(load) && load < 25 ? 0 : 1)' < /dev/null && node --import tsx /private/tmp/accel-er-b2scope-cee/src/routes/__tests__/fixtures/b2-zero-spread/generate-staging-control.ts < /dev/null
```

The successful gate, process result, exact preparation commands, input/code
hashes and actual canonical cells are recorded in
`acceptance-evidence/b2-zero-spread/rebind-generator.log` and
`rebind-generator.json`. Generator SHA-256:
`ea11003c9957cf674a7b8363563bd26e7fe94f25d59eca5bdff21323c9fe723d`.
Generated fixture SHA-256:
`3dbbdc4b02038cac8e965cf7c202c93c00a0e131397a9af4a7dee59b1f8a499d`.

The no-spread control replaces only Keep's fixed outcome with a spread. The
selector control temporarily substitutes the existing no-horizon wording via
the named selector, restores it immediately and verifies that only Keep's line
changes. The production selector stays on Science 93's binding §(o′) wording.
