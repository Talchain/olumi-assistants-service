# B2 d2 zero-spread regression fixture

These are the acceptance lane's own witness captures for scenario
`5e0fbc03-8af8-488e-b02f-82c25499e59e`, served by CEE staging
`f8ed674dec63758a2945acaffebe67e26a5f0a4a`.

- `run.json` is copied byte-for-byte from
  `/Users/paulslee/olumi-work/accept-f/a2-b2w-d2/run.json`.
- `read-graph-1791489457020.json` is the newest stored `wire/read-graph-*.json`
  when this regression was authored, copied byte-for-byte from the same lane.
- `starter-point-staging.json` freezes the staging producer, transport, canonical
  view and Agent-reader outputs before this fix, on the same graph and Run.

The public Run already had Keep's unearned exact zero removed by the transport.
The regression restores only `Keep.probability_of_goal = 0`, the exact value
observed by the lane and supplied in the build brief, to exercise the producer
before applying the real transport again. This is a reconstruction of the
producer input from the witness, not a fresh engine draw. Raise and Starter
retain their stored scoped warnings; neither has a licensed point.

The Starter-point control additionally sets only
`Starter.probability_of_goal = 0.97`. Its stored range continues to dominate the
canonical cell, and every stored warning remains intact. The staging snapshot
records this precise derivation. The snapshot asserts producer and transport
byte identity; the canonical Keep cell gains the previously stranded reason and
line, while every other cell remains byte-identical.

The no-spread control replaces only Keep's fixed outcome with a spread. The
selector control temporarily substitutes the existing no-horizon wording via
the named selector, restores it immediately and verifies that only Keep's line
changes. The production selector stays on Science 93's binding §(o′) wording.
