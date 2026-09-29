# Coaching activation readiness: RED/GREEN transcripts (component 4 appendix)

Durable archive of the one-off RED-first transcripts cited by
[coaching-activation-readiness-evidence.md](coaching-activation-readiness-evidence.md). The committed tests re-prove
the GREEN state on every CI run; the RED forms below were one-off discriminating runs (assertions temporarily
inverted), so they live here rather than in an ephemeral scratchpad.

## Gap A RED: the flag-seam test genuinely reaches the real conditional

Discriminating form committed first: with `CEE_ADD_RISK_REJECTION_GUIDANCE_ENABLED` ON and a matching
reachability rejection, assert the wire text equals the GENERIC suppression copy. If the turn reaches the real
flag branch, this MUST fail with the placeholder as the received value. It did:

```
FAIL  tests/unit/orchestrator/edit-graph-add-risk-flag-seam.test.ts
  > flag ON + targeted add-risk reachability rejection → placeholder guidance on the wire
AssertionError: expected 'I wasn't able to add that as describ…' to be 'I wasn't able to apply that change —…'
Expected: "I wasn't able to apply that change — it would create an inconsistency in the model structure.
           You could try describing the change differently, or I can rebuild the model from an updated brief."
Received: "I wasn't able to add that as described, because the new risk isn't connected into the model yet,
           so it has no path through to your goal and can't affect the result. To add it, connect it through
           to your goal — for example by linking it to a factor that already feeds into your goal. Which factor
           should it relate to, or which outcome does it threaten?"
Tests  1 failed | 3 passed (4)
```

A methodological note recorded for honesty: the very first RED run PASSED vacuously, because the mocked
proposal put the node identity only in `value` while the patch applier treats `op.path` as authoritative —
the turn never reached the flag branch. The RED discipline caught its own vacuous test before it could
certify anything.

## Gap B RED: both capability branches execute under the combined flag posture

Each leg first committed asserting the both-flags run does NOT activate its capability. Both failed, proving
both branches fire together:

```
× Cap-1 leg: both flags ON → identical grounded answer and gate telemetry as Cap-1 alone
AssertionError: expected true to be false            (gate matched=true under both flags)
× Cap-2A leg: both flags ON → identical placeholder guidance and chips as Cap-2A alone
AssertionError: expected '…' not to be '…'           (placeholder rendered under both flags)
Tests  2 failed | 1 passed (3)
```

## GREEN (final committed form, re-proven in CI on every run)

```
✓ tests/unit/orchestrator/edit-graph-add-risk-flag-seam.test.ts (4 tests)
✓ tests/unit/ai-harness/coaching-flags-combined.test.ts (3 tests)
Tests  7 passed (7)
```

## Review fixes applied after the 2026-07-02 adversarial code review

- The combined test's session-store mock ignored scenario identity, so the Cap-2A leg ran the real
  turn-context build against Cap-1's saved model and a foreign fresh analysis fact (an
  impossible-in-production state under the non-interference proof). The mock is now scenario-keyed
  (and fact reads are keyed by the prior-turn row ids they actually use — fixing this immediately
  surfaced that facts had been flowing regardless of which rows were requested).
- The neutrality scan's held-science vocabulary had silently diverged from its four sibling copies
  (it dropped 'vulnerable'); it now carries the superset, and it scans CHIP text (labels, prompts,
  messages) from both capabilities' live outputs, not just the prose.
- The chips-parity case now schema-validates both flag states, making the evidence pack's
  "re-validated in every case" claim true rather than three-quarters true.
- The flag-seam mock stubs every export the dispatch module imports (a future applied-mutation test
  cannot hit an undefined import), and the pending-actions stub returns the contract shape (an empty
  list), not null.
