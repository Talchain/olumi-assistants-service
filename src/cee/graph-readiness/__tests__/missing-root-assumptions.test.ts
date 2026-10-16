/**
 * `deriveMissingRootAssumptions` — driven over TWO REAL CAPTURES first, then
 * over structural cases.
 *
 * ⭐ WHY THE FIXTURES ARE CAPTURES AND NOT FIXTURES I WROTE. CLAUDE.md trap
 * 16-inverse, in the estate's own words: *a fixture you wrote yourself is not
 * evidence about the wire* — it encodes the author's model of the producer
 * rather than the producer. Both graph fixtures here are mechanical projections
 * of committed artefacts in `Talchain/olumi-programme-docs`, and each carries
 * its own `_provenance` block naming the artefact and the exact transformation:
 *
 *   `founder-2026-09-03.graph.json`  — the founder's 3 Sep manual test,
 *                                      scenario 7826c742, from the debug bundle
 *   `draft-b2-2026-09-03.graph.json` — a raw CEE draft response, schema 3.0,
 *                                      nodes[] and edges[] copied verbatim
 *
 * The founder capture is the one this lane exists to serve, so the suite's
 * first obligation is to reproduce the LOCKED count off it — three root
 * factors, not eleven nodes — without that number being written into the
 * module.
 *
 * ⚠ EVERY SUPPRESSION ASSERTION PINS ITS OWN PRECONDITION (trap 13b, third
 * face). "Expect it to be absent" passes just as happily when the derivation
 * saw nothing at all, so each exclusion test first asserts the fact that is
 * supposed to cause the exclusion.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe,expect,it } from 'vitest';



function loadFixture(name: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`./fixtures/${name}.graph.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

const FOUNDER = loadFixture('founder-2026-09-03');
const B2 = loadFixture('draft-b2-2026-09-03');

/** The founder capture's own ids, so assertions bind by IDENTITY (trap 19). */






describe('the founder capture — the locked diagnosis, reproduced from structure', () => {
  it('the fixture is the capture it claims to be (a vacuous corpus proves nothing)', () => {
    const provenance = FOUNDER._provenance as Record<string, unknown>;
    expect(provenance.scenario_id).toBe('7826c742-2939-4584-917c-f1286a663ae4');
    expect((FOUNDER.nodes as unknown[]).length).toBe(16);
    expect((FOUNDER.edges as unknown[]).length).toBe(24);
  });










});

describe('the B2 draft capture — an ESTIMATE is not an admission of ignorance', () => {
   // prior U(0.45, 1) — a stated belief
   // no prior at all
   // prior_is_unquantified, but not a root

  it('the fixture is the verbatim capture it claims to be', () => {
    const provenance = B2._provenance as Record<string, unknown>;
    expect(provenance.schema_version).toBe('3.0');
    expect((B2.nodes as unknown[]).length).toBe(15);
  });






});

// ── structural cases ────────────────────────────────────────────────────────



















/**
 * ⚠⚠ WHAT THIS SUITE PROVES, STATED AT ITS TRUE STRENGTH. It proves the sort
 * reads the `id` FIELD and never the `label` FIELD. It does NOT prove the
 * resulting order is uncorrelated with the label, and the interface comment
 * used to claim it did ("DELIBERATELY not by label") on the strength of the
 * anti-correlated case below.
 *
 * The anti-correlated case is a shape PRODUCTION IDS CANNOT TAKE.
 * `factor-extraction/index.ts`'s `generateFactorId` builds every enrichment
 * id as `factor_<label slug>_<index>`, so on the only population that ties by
 * construction, id order IS label order. Both shapes are driven here — the
 * hand-built one because it isolates WHICH FIELD is read, the production-
 * shaped one so no reader inherits the false generalisation from the first.
 */
