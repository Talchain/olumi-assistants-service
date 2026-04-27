/**
 * V5 finaliser brand — compile-time negative tests.
 *
 * This file is a TYPE-LEVEL fixture, not a runtime test. It contains no
 * executable assertions; the value is in the `@ts-expect-error` markers,
 * which fail the build if the corresponding type error STOPS firing
 * (i.e. if the `FinalisedV5Response` brand silently regresses).
 *
 * File suffix is `.ts` (not `.test.ts`) so:
 *   - vitest does not pick it up at runtime
 *   - tsconfig.build.json includes it (the build config excludes test
 *     files, but this is a regular .ts source file)
 *   - pre-push tsc enforcement runs against it on every push
 *
 * If the build fails because an `@ts-expect-error` reports "Unused
 * '@ts-expect-error' directive", that means the type system stopped
 * rejecting the bypass — fix the brand and re-add the appropriate guard
 * before removing the directive.
 *
 * Why these tests exist (the recurring failure mode this guards against):
 *
 * Across three rounds of external review, the gap was always "Claude said
 * the gate catches X; reviewer found Y also exists". Mechanism A (the
 * type brand + status-keyed Reply) is the structural fix that made the
 * regex-vs-bypass arms race stop. These tests are the structural proof
 * that mechanism A actually fires — without them, the brand could become
 * structurally compatible with `OlumiResponse` (e.g. via a refactor that
 * accidentally widens the type) and the runtime hook would be the only
 * remaining defence.
 */

import type { FastifyReply } from 'fastify';

import type {
  FinalisedV5Response,
  FinaliserContext,
} from '../response-finaliser.js';
import type { OlumiResponse, BoundaryError } from '@talchain/schemas/boundary';

import { finaliseV5Response } from '../response-finaliser.js';

// ─── Status-keyed Reply mirror ────────────────────────────────────────────
//
// The route-v2.ts handler uses `<{ Reply: V5RouteReply }>` to constrain
// `reply.send`. We re-declare the same mapping here (rather than importing
// from route-v2.ts, which is not designed for re-export) so this file is a
// pure type-level fixture with no runtime coupling.

type V5RouteReplyMirror = {
  200: FinalisedV5Response;
  400: BoundaryError;
  422: BoundaryError;
  500: BoundaryError;
};

// Helper — synthetic raw OlumiResponse and BoundaryError for the negative
// tests. These are unused at runtime; vitest never executes this file.
declare const _rawResponse: OlumiResponse;
declare const _boundaryError: BoundaryError;
declare const _ctx: FinaliserContext;
declare const _reply: FastifyReply<{ Reply: V5RouteReplyMirror }>;

// ─── Positive cases — must compile cleanly ────────────────────────────────

void function _positiveCases() {
  // The finaliser produces a branded value
  const branded: FinalisedV5Response = finaliseV5Response(_rawResponse, _ctx);

  // 200 accepts the brand
  void _reply.code(200).send(branded);

  // 500 accepts a BoundaryError
  void _reply.code(500).send(_boundaryError);

  // 422 accepts a BoundaryError
  void _reply.code(422).send(_boundaryError);

  // 400 accepts a BoundaryError
  void _reply.code(400).send(_boundaryError);
};

// ─── Negative cases — each MUST fail compilation ──────────────────────────

void function _negativeCases() {
  // Bypass 1: send raw OlumiResponse on 200 (the prior brief's escape hatch)
  // @ts-expect-error — raw OlumiResponse cannot be sent as 200; brand required
  void _reply.code(200).send(_rawResponse);

  // Bypass 2: send BoundaryError on 200
  // @ts-expect-error — BoundaryError on 200 violates status↔body pairing
  void _reply.code(200).send(_boundaryError);

  // Bypass 3: send brand on 500
  const _branded: FinalisedV5Response = finaliseV5Response(_rawResponse, _ctx);
  // @ts-expect-error — FinalisedV5Response on 500 violates status↔body pairing
  void _reply.code(500).send(_branded);

  // Bypass 4: send raw via reply.send(...) without explicit code (Fastify
  // defaults to 200; the type system flattens to the Reply map and rejects)
  // @ts-expect-error — implicit-200 send rejects raw OlumiResponse
  void _reply.send(_rawResponse);

  // Bypass 5: send raw via reply.status(...).send(...) — `status` is the
  // Fastify alias for `code`; both share the status-keyed signature
  // @ts-expect-error — status alias enforces the same brand
  void _reply.status(200).send(_rawResponse);

  // Bypass 6: pretend a raw object IS a FinalisedV5Response — direct cast.
  // Caught by the grep gate (mechanism D), not the type system. Documented
  // here so future readers know which mechanism handles which bypass.
  // (The cast itself COMPILES; the grep gate catches the identifier
  // `FinalisedV5Response` outside the sanctioned files. This is the
  // single remaining bypass shape after mechanism A.)
  // (No @ts-expect-error here — the cast is intentionally allowed at the
  // type level so we can produce the brand inside the finaliser. Grep is
  // the right primitive for the cast pattern.)

  // Bypass 7: BoundaryError on 422 with the brand — the inverse of bypass 3
  // @ts-expect-error — FinalisedV5Response on 422 violates status↔body pairing
  void _reply.code(422).send(_branded);
};

// Make TypeScript happy that this file is a module (allows the file-scoped
// declarations above without polluting the global namespace).
export {};
