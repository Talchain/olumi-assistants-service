/**
 * THE ROUTE TABLE: which served prompt is judged against which consumer.
 *
 * THE CENTRAL HAZARD THIS FILE IS BUILT AROUND
 * --------------------------------------------
 * THE SERVED PROMPT IS NOT THE FILE IN THE REPO. Prompts are served from a
 * versioned PMS by key, with a version and a hash; `src/prompts/defaults.ts`,
 * `defaults-v187.ts` and `orchestrator-cf-*.ts` are FALLBACKS and editing them
 * reaches no user. So a route's prompt bytes are taken from
 * `Prompts/canonical/*.txt` -- the EXPORTED SERVED BYTES -- and every one of
 * them is identity-pinned by sha256 against `Prompts/canonical/manifest.json`
 * before a single conformance claim is made. Matching is BY HASH, never by
 * filename.
 *
 * That pin is a mirror, and the PMS can be re-pinned with NO deploy, so the
 * pin is necessary and NOT sufficient. `scripts/verify-served-prompt-conformance.ts`
 * (`pnpm verify:served-conformance`) points the SAME pure checker at the live
 * `/admin/prompts/status` bytes; the offline tier is what CI can run on every commit.
 *
 * WHY THE MAP BELOW IS ALLOWED TO BE HAND-WRITTEN
 * ----------------------------------------------
 * It cannot be derived: nothing in the tree states "prompt X is judged by
 * grammar Y" -- that association only exists inside each adapter call site.
 * A hand-written map is therefore unavoidable, which by platform doctrine
 * (trap 12) means it MUST FAIL LOUD ON DRIFT rather than assume-good. It does,
 * in one specific way:
 *
 *   MAPPED_ROUTES ∪ UNMAPPED_ROUTES  ===  deriveLiveEstate().live   (exactly)
 *
 * asserted in the gate. A newly-wired prompt lands in `deriveLiveEstate().live`
 * with nobody remembering -- `estate.ts` derives that set from
 * `OPERATION_TO_TASK_ID`, which a prompt cannot bypass -- and this gate then
 * goes RED until a human classifies it as mapped or explains why it is not.
 * A retired prompt REDs the other way. There is no branch on which an
 * unclassified route is silently skipped.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDraftRecordsSchema } from '../../../src/cee/draft/records/grammar.js';
import { DRAFT_RECORDS_INSTRUCTION } from '../../../src/cee/draft/records/instruction.js';
import { buildOlumiActionTool } from '../../../src/orchestrator-v5/routing/tool-schema.js';
import { ANTHROPIC_EDIT_GRAPH_SCHEMA } from '../../../src/orchestrator/tools/anthropic-edit-graph-schema.js';
import type { JsonSchemaNode } from './checker.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..', '..', '..');
export const MANIFEST_PATH = join(REPO_ROOT, 'Prompts/canonical/manifest.json');

export function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export interface MappedRoute {
  /** Task id as `deriveLiveEstate().live` reports it. */
  readonly route: string;
  /** Repo-relative path of the EXPORTED SERVED BYTES. */
  readonly canonicalFile: string;
  /**
   * The consumer grammar, as a THUNK over the real builder.
   *
   * A thunk, not a captured value, so the grammar is rebuilt at assertion time
   * from the exact object production attaches. Freezing a snapshot of it here
   * would reintroduce precisely the copy this gate exists to detect.
   */
  readonly grammar: () => JsonSchemaNode;
  /** Where that grammar is attached -- the evidence for this pairing. */
  readonly attachSite: string;
  /** Code-owned system blocks appended AFTER the served bytes, if any. */
  readonly additionalText?: () => string;
}

export const MAPPED_ROUTES: readonly MappedRoute[] = Object.freeze([
  {
    route: 'draft_graph',
    canonicalFile: 'Prompts/canonical/draft_graph.txt',
    grammar: () => buildDraftRecordsSchema(),
    attachSite:
      'src/adapters/llm/anthropic.ts:842 -- `const draftGraphSchema = buildDraftRecordsSchema()`, ' +
      'the sole production attach for the draft turn (`buildDraftGraphSchema` has zero production callers)',
    // Appended after the draft cache breakpoint (anthropic.ts:517). Without it
    // C3 would report `stated_items`/`claims` as unnamed, which would be a
    // FALSE violation: the model does receive them, just not in the PMS half.
    additionalText: () => DRAFT_RECORDS_INSTRUCTION,
  },
  {
    route: 'routing',
    canonicalFile: 'Prompts/canonical/routing.txt',
    grammar: () => (buildOlumiActionTool() as { input_schema: JsonSchemaNode }).input_schema,
    attachSite:
      'src/orchestrator-v5/routing/tool-schema.ts:516 `buildOlumiActionTool()` -- the ' +
      '`olumi_action` tool attached on every routing turn; `parseToolCallResponse` enforces it',
  },
  {
    route: 'edit_graph',
    canonicalFile: 'Prompts/canonical/edit_graph.txt',
    grammar: () => ANTHROPIC_EDIT_GRAPH_SCHEMA as unknown as JsonSchemaNode,
    attachSite:
      'src/orchestrator/tools/edit-graph.ts:2458-2467 -- `ANTHROPIC_EDIT_GRAPH_SCHEMA` passed as ' +
      '`outputSchema` whenever extended thinking is off',
  },
  {
    route: 'repair_edit_graph',
    canonicalFile: 'Prompts/canonical/repair_edit_graph.txt',
    grammar: () => ANTHROPIC_EDIT_GRAPH_SCHEMA as unknown as JsonSchemaNode,
    attachSite:
      'src/orchestrator/tools/edit-graph.ts:2454-2459 -- the repair attempt reuses the SAME call ' +
      'site and therefore the same grammar ("Applies to BOTH the first attempt and repair attempts")',
  },
]);

export interface UnmappedRoute {
  readonly route: string;
  /** Why no model-facing JSON Schema adjudicates this route's output. */
  readonly reason: string;
  /** How that was established, at this tip. */
  readonly derivedFrom: string;
}

export const UNMAPPED_ROUTES: readonly UnmappedRoute[] = Object.freeze([
  {
    route: 'decision_review',
    reason:
      'No model-facing JSON Schema. The call requests free-form JSON mode, which constrains ' +
      'well-formedness and nothing else, so there is no accepted-shape predicate to conform to.',
    derivedFrom:
      "src/routes/assist.v1.decision-review.ts:547 -- `responseFormat: 'json_object'`, no outputSchema and no tool",
  },
  {
    route: 'repair_graph',
    reason:
      'No executable LLM capability: zero `getSystemPrompt("repair_graph")` call sites repo-wide, ' +
      'so no grammar is ever attached. Live by derivation and health-gating only.',
    derivedFrom:
      'contrast-controlled call-site sweep of getSystemPrompt(): repair_graph=0 while edit_graph=2, ' +
      'draft_graph=2, decision_review=2, repair_edit_graph=2, validate_graph=1, routing=1',
  },
  {
    route: 'validate_graph',
    reason:
      'NO CANONICAL EXPORT EXISTS. Live at the shipped default (CEE_VALIDATION_PIPELINE_ENABLED is a ' +
      'kill-switch defaulting true) but its served bytes cannot be proved from this repo, so any ' +
      'conformance verdict would be a claim about bytes nobody has read.',
    derivedFrom:
      'Prompts/canonical/manifest.json `_meta.known_canonical_export_gap` + the `live_pms_export_gaps` row',
  },
]);

/** Read a route's served bytes, identity-pinned by hash against the manifest. */
export function readPinnedCanonical(route: MappedRoute): {
  text: string;
  fileSha: string;
  manifestSha: string;
  servedVersion: number;
} {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
    pms_prompts: Array<{
      key: string;
      file: string;
      sha256: string;
      served_version: number;
    }>;
  };
  const row = manifest.pms_prompts.find((r) => r.key === route.route);
  if (!row) {
    throw new Error(
      `[${route.route}] no row in Prompts/canonical/manifest.json -- the served bytes for this ` +
        `route are unattested, so no conformance claim can be made about them`,
    );
  }
  if (row.file !== route.canonicalFile) {
    throw new Error(
      `[${route.route}] manifest attests ${row.file} but this route table names ` +
        `${route.canonicalFile} -- matching is BY HASH via the manifest, never by filename`,
    );
  }
  const text = readFileSync(join(REPO_ROOT, row.file), 'utf8');
  return {
    text,
    fileSha: sha256(text),
    manifestSha: row.sha256,
    servedVersion: row.served_version,
  };
}
