/**
 * decision_review — PROMOTION-GATE PACK MARKER.
 *
 * Its mere presence is what puts `decision_review` under the promotion gate. The
 * gate discovers packs by scanning for this filename (`promotion-pack.ts`), so
 * the gated set is DERIVED from the filesystem, never hand-listed (trap 12). H3's
 * edit_graph pack falls under the gate by dropping in its own marker — no edit to
 * the gate.
 *
 * The canonical path is the one H1's served-contract already anchors on, so the
 * pack, the manifest, and the gate all match on ONE hash of ONE file.
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANONICAL_DECISION_REVIEW_PROMPT_PATH } from './served-contract.js';
import type { PackDescriptor } from '../promotion-gate/types.js';

export const PROMOTION_PACK: PackDescriptor = {
  task: 'decision_review',
  canonicalPromptPath: CANONICAL_DECISION_REVIEW_PROMPT_PATH,
  packDir: dirname(fileURLToPath(import.meta.url)),
};
