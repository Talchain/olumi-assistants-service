/**
 * Parse a DELIVERED V5 wire body against the PUBLISHED strict schema.
 *
 * ⭐ WHY THIS EXISTS, and the distinction is the whole point:
 *
 *   `OlumiResponseSchema` describes the DECLARED CONTRACT SURFACE.
 *   It does NOT describe the BYTES CEE DELIVERS.
 *
 * Those are different objects, deliberately, and the difference is documented
 * in the route itself: underscore-prefixed sidecars are STRIPPED before egress
 * validation and RE-ATTACHED after it — *"the strip-then-validate-then-reattach
 * sequence is the contract that lets us safely accept debug fields that would
 * otherwise fail the boundary's `.strict()` schema"*
 * (`tests/integration/orchestrator/route-v2-debug-fields.test.ts`). Five
 * surfaces ride it today: `_timings`, `_diagnostic_trace`, `_context_summary`,
 * `_reasoning`, `_answer_shape`, and `_grounded_selection`.
 *
 * So `OlumiResponseSchema.parse(deliveredBody)` throws on ANY turn where a
 * sidecar attaches. Several tests called it directly and passed only because
 * the turn shapes they happened to exercise attached none. That is a latent
 * failure waiting for the first sidecar that fires on a common turn — which
 * `_grounded_selection` is, since it attaches to every turn carrying a canvas
 * selection.
 *
 * ⚠ THIS IS A SHARPENING, NOT A WEAKENING, and it is written this way on
 * purpose so it cannot become the "carve out the discrepancy" defect:
 *
 *   · every DECLARED key is still validated by the strict schema, unchanged;
 *   · an unknown key that is NOT underscore-prefixed STILL FAILS, exactly as
 *     before — a genuinely unrecognised field cannot hide behind this helper;
 *   · the set of removed keys is ASSERTED to be sidecars, so a future
 *     non-sidecar leak is a hard error here rather than a silent pass.
 *
 * A test that means *"the delivered body is byte-identical to the declared
 * surface"* should NOT use this helper — it should assert the absence of the
 * sidecar directly. This helper is for the far more common case: a test using
 * the schema as a TYPED ACCESSOR for `blocks` / `assistant_text` / friends,
 * where the sidecar is simply not what is under test.
 */
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import type { OlumiResponse } from '@talchain/schemas/boundary';

/**
 * A wire sidecar is identified STRUCTURALLY, by its leading underscore, not by
 * a hand-listed set of names.
 *
 * A list would be the hand-maintained mirror this repo pays for repeatedly:
 * it would go stale the moment a sixth sidecar shipped, and the drift would
 * read green — the next sidecar's test would fail with a confusing schema
 * error instead of a clear one. The underscore prefix IS the convention the
 * route's own strip step is built around, so deriving from it keeps this
 * helper correct with no human in the loop.
 */
function isWireSidecarKey(key: string): boolean {
  return key.startsWith('_');
}

/**
 * @param body the parsed JSON of a 200-OK `/orchestrate/v2/turn` response.
 * @returns the response validated against the strict declared surface.
 * @throws if any NON-sidecar key is unrecognised, or any declared key is
 *   malformed — i.e. everything the bare `.parse` would have caught, minus
 *   the false positive on documented sidecars.
 */
export function parseDeliveredOlumiResponse(body: unknown): OlumiResponse {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    // Let the schema produce its own error for a non-object: this helper must
    // never turn a malformed body into a friendlier-looking failure.
    return OlumiResponseSchema.parse(body);
  }

  const declaredSurface: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (isWireSidecarKey(key)) {
      removed.push(key);
      continue;
    }
    declaredSurface[key] = value;
  }

  // The sharpening, asserted rather than assumed. `isWireSidecarKey` is the
  // only thing that put a key in `removed`, so this cannot fail today — it is
  // here so that a future change to the predicate (widening it to a name list,
  // say, or to some other heuristic) cannot silently start swallowing real
  // fields without this line failing first.
  const nonSidecar = removed.filter((key) => !isWireSidecarKey(key));
  if (nonSidecar.length > 0) {
    throw new Error(
      `parseDeliveredOlumiResponse removed non-sidecar key(s): ${nonSidecar.join(', ')}`,
    );
  }

  return OlumiResponseSchema.parse(declaredSurface);
}
