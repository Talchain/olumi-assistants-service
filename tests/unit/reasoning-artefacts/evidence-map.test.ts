import { describe, expect, it } from 'vitest';
import { contentHash } from '../../../src/orchestrator-v5/agent-lane/runtime/reasoning-artefacts/common.js';

import {
  createEvidenceAssumptionMap, validateEvidenceAssumptionMap,
} from '../../../src/orchestrator-v5/agent-lane/runtime/reasoning-artefacts/evidence-map.js';
import { assessReasoningArtefactCurrentness, createReasoningArtefact, presentEvidenceAssumptionMap, serializeReasoningArtefact,
  validateReasoningArtefact } from '../../../src/orchestrator-v5/agent-lane/runtime/reasoning-artefacts/index.js';

function itemHash(value: unknown): string {
  const item = value as Record<string, unknown>;
  return item.kind === 'claim'
    ? contentHash({ kind: item.kind, id: item.id, text: item.text,
      epistemic_status: item.epistemic_status, provenance: item.provenance, source_refs: item.source_refs })
    : contentHash({ kind: item.kind, id: item.id, text: item.text,
      provenance: item.provenance, source_ref: item.source_ref });
}

function fixture() {
  const input = {
    items: [
      { kind: 'claim', id: 'claim-price', text: 'The price increased churn.', epistemic_status: 'fact',
        provenance: 'source_evidence', source_refs: [{ source_id: 'board-pack', source_version: 'v1' }],
        linked_element_ids: ['churn'] },
      { kind: 'evidence_item', id: 'observed-churn', text: 'The board pack measured 4.1% churn.',
        provenance: 'source_evidence', source_ref: { source_id: 'board-pack', source_version: 'v1' },
        linked_element_ids: ['churn'] },
      { kind: 'evidence_item', id: 'challenging-research', text: 'A research note challenges the attribution.',
        provenance: 'source_evidence', source_ref: { source_id: 'research-note', source_version: 'v1' },
        linked_element_ids: ['churn'] },
      { kind: 'claim', id: 'claim-alternative', text: 'A seasonal effect may explain the change.',
        epistemic_status: 'hypothesis', provenance: 'olumi_hypothesis', source_refs: [],
        linked_element_ids: ['churn'] },
      { kind: 'claim', id: 'claim-private', text: 'The team expects retention to improve.',
        epistemic_status: 'assumption', provenance: 'user_stated', source_refs: [], linked_element_ids: [] },
    ],
    relationships: [
      { claim_id: 'claim-price', evidence_item_id: 'observed-churn', relationship: 'supports' },
      { claim_id: 'claim-price', evidence_item_id: 'challenging-research', relationship: 'challenges' },
    ],
    contradictions: [{ left_claim_id: 'claim-price', right_claim_id: 'claim-alternative' }],
    proposed_implications: [{ text: 'Review churn attribution before changing the model.',
      linked_element_ids: ['churn'], requires_review: true }],
  };
  const host = {
    scenario_id: 'scenario-1', graph_revision: 'graph-1',
    source_statuses: [
      { source_id: 'board-pack', source_version: 'v1' as string | null, state: 'current' },
      { source_id: 'research-note', source_version: 'v1' as string | null, state: 'current' },
    ],
    item_source_bindings: [
      { item_id: 'claim-price', item_content_hash: itemHash(input.items[0]), source_refs: [
        { source_id: 'board-pack', source_version: 'v1' }, { source_id: 'research-note', source_version: 'v1' },
      ] },
      { item_id: 'observed-churn', item_content_hash: itemHash(input.items[1]),
        source_refs: [{ source_id: 'board-pack', source_version: 'v1' }] },
      { item_id: 'challenging-research', item_content_hash: itemHash(input.items[2]),
        source_refs: [{ source_id: 'research-note', source_version: 'v1' }] },
      { item_id: 'claim-alternative', item_content_hash: itemHash(input.items[3]), source_refs: [] },
      { item_id: 'claim-private', item_content_hash: itemHash(input.items[4]), source_refs: [] },
    ],
    implication_source_bindings: [{ implication_index: 0,
      implication_content_hash: contentHash(input.proposed_implications[0]),
      source_refs: [] as { source_id: string; source_version: string }[] }],
    item_model_bindings: input.items.map((item) => ({ item_id: item.id, item_content_hash: itemHash(item),
      linked_element_ids: [...item.linked_element_ids],
      linkage: item.linked_element_ids.length === 0 ? 'not_applicable' : 'current' })),
    model_elements: [{ element_id: 'churn', fingerprint: 'churn-content-v1', linkage: 'current' }],
    fact_verdicts: [{ claim_id: 'claim-price', claim_content_hash: itemHash(input.items[0]),
      supported: true, basis_ref: 'attestation-1' as string | null }],
  };
  return { input, host };
}

describe('F2b evidence and assumption map', () => {
  it('keeps claim epistemic status separate from evidence items and retains opposing relationships', () => {
    const { input, host } = fixture();
    const artefact = createEvidenceAssumptionMap(input, host);
    const view = presentEvidenceAssumptionMap(artefact, host);
    expect(view.items.map((item) => item.kind)).toEqual([
      'claim', 'evidence_item', 'evidence_item', 'claim', 'claim',
    ]);
    expect(view.relationships.map((relation) => relation.relationship)).toEqual(['supports', 'challenges']);
    expect(view.contradictions).toEqual([{ left_claim_id: 'claim-price', right_claim_id: 'claim-alternative' }]);
    expect(view.items.find((item) => item.id === 'claim-price')).toMatchObject({ epistemic_status: 'fact' });
    expect(view.source_states.every((status) => status.state === 'current')).toBe(true);
  });

  it('does not promote a citation or a user statement to fact without a host attestation', () => {
    const { input, host } = fixture();
    host.fact_verdicts = [];
    expect(() => createEvidenceAssumptionMap(input, host)).toThrow('unsupported_fact');
    host.fact_verdicts = [{ claim_id: 'claim-price', claim_content_hash: itemHash(input.items[0]),
      supported: false, basis_ref: null }];
    expect(() => createEvidenceAssumptionMap(input, host)).toThrow('unsupported_fact');
    input.items[0]!.provenance = 'user_stated';
    input.items[0]!.source_refs = [];
    host.item_source_bindings[0]!.item_content_hash = itemHash(input.items[0]);
    host.item_model_bindings[0]!.item_content_hash = itemHash(input.items[0]);
    host.fact_verdicts[0]!.claim_content_hash = itemHash(input.items[0]);
    expect(() => createEvidenceAssumptionMap(input, host)).toThrow('unsupported_fact');
  });

  it('rejects evidence with no source version, source substitution, and the old ambiguous status ontology', () => {
    const { input, host } = fixture();
    delete (input.items[1]!.source_ref as { source_version?: string }).source_version;
    expect(() => createEvidenceAssumptionMap(input, host)).toThrow();

    const second = fixture();
    second.input.items[1]!.source_ref!.source_id = 'other-source';
    second.input.items[1]!.source_ref!.source_version = 'v2';
    second.host.item_source_bindings[1]!.source_refs[0]!.source_id = 'other-source';
    second.host.item_source_bindings[1]!.source_refs[0]!.source_version = 'v2';
    second.host.item_source_bindings[1]!.item_content_hash = itemHash(second.input.items[1]);
    second.host.item_model_bindings[1]!.item_content_hash = itemHash(second.input.items[1]);
    second.host.item_source_bindings[0]!.source_refs.push({ source_id: 'other-source', source_version: 'v2' });
    expect(presentEvidenceAssumptionMap(createEvidenceAssumptionMap(second.input, second.host), second.host)
      .withheld_item_ids).toContain('observed-churn');

    const third = fixture();
    third.input.items[0]!.epistemic_status = 'evidence';
    expect(() => createEvidenceAssumptionMap(third.input, third.host)).toThrow('invalid_claim_status');
  });

  it('redacts a previously current saved item after source revocation, including inseparable mixed content', () => {
    const { input, host } = fixture();
    const saved = createEvidenceAssumptionMap(input, host);
    expect(presentEvidenceAssumptionMap(saved, host).items).toHaveLength(5);
    const now = structuredClone(host);
    now.source_statuses[1]!.state = 'revoked';
    now.source_statuses[1]!.source_version = null;
    const view = presentEvidenceAssumptionMap(JSON.parse(JSON.stringify(saved)), now);
    expect(view.source_states).toEqual([
      { source_id: 'board-pack', bound_version: 'v1', state: 'current' },
      { source_id: 'research-note', bound_version: 'v1', state: 'revoked' },
    ]);
    expect(view.withheld_item_ids).toEqual(['claim-price', 'challenging-research']);
    expect(view.withheld_items.find((item) => item.id === 'claim-price')?.source_states).toContainEqual({
      source_id: 'research-note', state: 'revoked',
    });
    expect(view.items.map((item) => item.id)).toEqual(['observed-churn', 'claim-alternative', 'claim-private']);
    expect(JSON.stringify(view)).not.toContain('A research note challenges');
    expect(JSON.stringify(view)).not.toContain('The price increased churn');
    expect(view.relationships).toEqual([]);
    expect(view.contradictions).toEqual([]);
    expect(view.proposed_implications).toEqual([]);
    // The internal saved payload retains historical input; only the current-use view can be shown.
    expect(saved.canonical_inputs.input.items[2]?.text).toContain('research note');
  });

  it('represents source freshness and model relevance independently, including simultaneous changes', () => {
    const { input, host } = fixture();
    const saved = createEvidenceAssumptionMap(input, host);
    const unrelatedGraphEdit = structuredClone(host);
    unrelatedGraphEdit.graph_revision = 'graph-2';
    const stillCurrent = presentEvidenceAssumptionMap(saved, unrelatedGraphEdit);
    expect(stillCurrent.items.find((item) => item.id === 'observed-churn')?.model_linkage).toBe('current');
    expect(createEvidenceAssumptionMap(input, unrelatedGraphEdit).canonical_input_hash).toBe(saved.canonical_input_hash);

    const bothChanged = structuredClone(unrelatedGraphEdit);
    bothChanged.source_statuses[1]!.source_version = 'v2';
    bothChanged.model_elements[0]!.fingerprint = 'churn-content-v2';
    const view = presentEvidenceAssumptionMap(saved, bothChanged);
    expect(view.source_states.find((status) => status.source_id === 'research-note')?.state).toBe('changed');
    expect(view.items.find((item) => item.id === 'observed-churn')?.model_linkage).toBe('stale');
    expect(view.withheld_items.find((item) => item.id === 'claim-price')?.model_linkage).toBe('stale');
    expect(view.withheld_items.find((item) => item.id === 'claim-price')?.source_states).toContainEqual({
      source_id: 'research-note', state: 'changed',
    });
    expect(view.items.find((item) => item.id === 'claim-private')?.model_linkage).toBe('not_applicable');
    expect(view.withheld_item_ids).toContain('claim-price');
  });

  it('uses only validated own-property inputs and leaves caller objects untouched', () => {
    const { input, host } = fixture();
    const beforeInput = structuredClone(input);
    const beforeHost = structuredClone(host);
    createEvidenceAssumptionMap(input, host);
    expect(input).toEqual(beforeInput);
    expect(host).toEqual(beforeHost);
    const inherited = Object.assign(Object.create({ items: input.items }) as Record<string, unknown>, {
      relationships: input.relationships, contradictions: input.contradictions,
      proposed_implications: input.proposed_implications,
    });
    expect(() => createEvidenceAssumptionMap(inherited, host)).toThrow('missing_field');
  });

  it('rejects duplicate identities, malformed links and executable implications', () => {
    const duplicate = fixture();
    duplicate.input.items[1]!.id = 'claim-price';
    expect(() => createEvidenceAssumptionMap(duplicate.input, duplicate.host)).toThrow('duplicate_item');
    const link = fixture();
    link.input.items[0]!.linked_element_ids = ['unknown-element'];
    link.host.item_model_bindings[0]!.linked_element_ids = ['unknown-element'];
    expect(() => createEvidenceAssumptionMap(link.input, link.host)).toThrow('unknown_model_link');
    const executable = fixture();
    (executable.input.proposed_implications[0] as Record<string, unknown>).operation = 'set_factor_value';
    expect(() => createEvidenceAssumptionMap(executable.input, executable.host)).toThrow('unexpected_field');
    const hypothesis = fixture();
    hypothesis.input.items[0]!.provenance = 'olumi_hypothesis';
    expect(() => createEvidenceAssumptionMap(hypothesis.input, hypothesis.host)).toThrow('hypothesis_as_fact');
  });

  it('serialises and strictly revalidates the historical envelope with deterministic content identity', () => {
    const { input, host } = fixture();
    const first = createEvidenceAssumptionMap(input, host);
    const second = createEvidenceAssumptionMap(structuredClone(input), structuredClone(host));
    expect(first.canonical_input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.canonical_input_hash).toBe(first.canonical_input_hash);
    expect(validateEvidenceAssumptionMap(JSON.parse(JSON.stringify(first)))).toEqual(first);
    const tampered = structuredClone(first);
    (tampered.binding.dependencies[0] as { fingerprint: string }).fingerprint = 'forged';
    expect(() => validateEvidenceAssumptionMap(tampered)).toThrow('artefact_revalidation_failed');
  });

  it('takes the explicit index route through internal serialisation and fresh-host presentation', () => {
    const { input, host } = fixture();
    const created = createReasoningArtefact('evidence_assumption_map', input, host);
    const internalBytes = serializeReasoningArtefact(created);
    const restored = validateReasoningArtefact(JSON.parse(internalBytes));
    expect(restored).toEqual(created);
    const now = structuredClone(host);
    now.source_statuses[0]!.state = 'revoked';
    now.source_statuses[0]!.source_version = null;
    const view = presentEvidenceAssumptionMap(restored, now);
    expect(view.items.map((item) => item.id)).toEqual(['challenging-research', 'claim-alternative', 'claim-private']);
    expect(JSON.stringify(view)).not.toContain('The board pack measured');
    expect(JSON.stringify(view)).not.toContain('The price increased churn');
  });

  it('does not return source-derived content under another scenario or without a current source status', () => {
    const { input, host } = fixture();
    const saved = createEvidenceAssumptionMap(input, host);
    const foreign = structuredClone(host);
    foreign.scenario_id = 'scenario-2';
    expect(presentEvidenceAssumptionMap(saved, foreign)).toMatchObject({ state: 'invalid_subject', items: [] });
    const unavailable = structuredClone(host);
    unavailable.source_statuses = [];
    const view = presentEvidenceAssumptionMap(saved, unavailable);
    expect(view.source_states.every((status) => status.state === 'unavailable')).toBe(true);
    expect(view.items.map((item) => item.id)).toEqual(['claim-alternative', 'claim-private']);
  });

  it('requires a host witness for safe item separation and does not upgrade an old stale model link', () => {
    const { input, host } = fixture();
    host.item_source_bindings[0]!.source_refs = [{ source_id: 'board-pack', source_version: 'v1' }];
    expect(() => createEvidenceAssumptionMap(input, host)).toThrow('incomplete_item_source_binding');

    const second = fixture();
    second.host.model_elements[0]!.linkage = 'stale';
    const saved = createEvidenceAssumptionMap(second.input, second.host);
    const now = structuredClone(second.host);
    now.model_elements[0]!.linkage = 'current';
    expect(presentEvidenceAssumptionMap(saved, now).items.find((item) => item.id === 'observed-churn')?.model_linkage)
      .toBe('stale');
  });

  it('withholds a historical fact when the host withdraws its attested basis', () => {
    const { input, host } = fixture();
    const saved = createEvidenceAssumptionMap(input, host);
    const now = structuredClone(host);
    now.fact_verdicts[0]!.basis_ref = 'attestation-2';
    const view = presentEvidenceAssumptionMap(saved, now);
    expect(view.withheld_item_ids).toContain('claim-price');
    expect(view.items.find((item) => item.id === 'observed-churn')).toBeDefined();
    expect(JSON.stringify(view)).not.toContain('The price increased churn');
    expect(view.proposed_implications).toEqual([]);
    now.fact_verdicts[0]!.supported = false;
    now.fact_verdicts[0]!.basis_ref = null;
    expect(assessReasoningArtefactCurrentness(saved, input, now)).toEqual({
      state: 'invalid', changed_dependencies: [],
    });
  });

  it('binds a fact verdict and every source witness to the exact item content', () => {
    const changedFact = fixture();
    changedFact.input.items[0]!.text = 'The price had no effect on churn.';
    expect(() => createEvidenceAssumptionMap(changedFact.input, changedFact.host)).toThrow('item_content_mismatch');
    const revisedHash = itemHash(changedFact.input.items[0]);
    changedFact.host.item_source_bindings[0]!.item_content_hash = revisedHash;
    changedFact.host.item_model_bindings[0]!.item_content_hash = revisedHash;
    expect(() => createEvidenceAssumptionMap(changedFact.input, changedFact.host)).toThrow('fact_content_mismatch');

    const changedEvidence = fixture();
    changedEvidence.input.items[1]!.text = 'The board pack measured 0% churn.';
    expect(() => createEvidenceAssumptionMap(changedEvidence.input, changedEvidence.host))
      .toThrow('item_content_mismatch');
  });

  it('redacts a saved evidence item and dependent fact when fresh content witness differs', () => {
    const { input, host } = fixture();
    const saved = createEvidenceAssumptionMap(input, host);
    const now = structuredClone(host);
    now.item_source_bindings[1]!.item_content_hash = contentHash({ changed: 'evidence text' });
    const view = presentEvidenceAssumptionMap(saved, now);
    expect(view.withheld_item_ids).toContain('observed-churn');
    expect(view.withheld_item_ids).toContain('claim-price');
    expect(view.items.map((item) => item.id)).toContain('challenging-research');
    expect(JSON.stringify(view)).not.toContain('The board pack measured');
    expect(JSON.stringify(view)).not.toContain('The price increased churn');
  });

  it('binds implication content and implication-only source versions before display', () => {
    const { input, host } = fixture();
    host.source_statuses.push({ source_id: 'source-x', source_version: 'v1', state: 'current' });
    host.implication_source_bindings[0]!.source_refs.push({ source_id: 'source-x', source_version: 'v1' });
    const saved = createEvidenceAssumptionMap(input, host);
    expect(presentEvidenceAssumptionMap(saved, host).proposed_implications).toHaveLength(1);

    const now = structuredClone(host);
    now.source_statuses[2]!.state = 'revoked';
    now.source_statuses[2]!.source_version = null;
    const view = presentEvidenceAssumptionMap(saved, now);
    expect(view.items).toHaveLength(input.items.length);
    expect(view.source_states).toContainEqual({ source_id: 'source-x', bound_version: 'v1', state: 'revoked' });
    expect(view.proposed_implications).toEqual([]);
    expect(view.withheld_implication_indexes).toEqual([0]);
    expect(JSON.stringify(view)).not.toContain('Review churn attribution before changing the model.');

    input.proposed_implications[0]!.text = 'Change the model automatically.';
    expect(() => createEvidenceAssumptionMap(input, host)).toThrow('implication_content_mismatch');
  });

  it('keeps each item’s model relevance independent even when linked to the same element', () => {
    const { input, host } = fixture();
    const saved = createEvidenceAssumptionMap(input, host);
    const now = structuredClone(host);
    now.item_model_bindings.find((item) => item.item_id === 'observed-churn')!.linkage = 'stale';
    now.source_statuses[1]!.state = 'revoked';
    now.source_statuses[1]!.source_version = null;
    const view = presentEvidenceAssumptionMap(saved, now);
    expect(view.items.find((item) => item.id === 'observed-churn')?.model_linkage).toBe('stale');
    expect(view.withheld_items.find((item) => item.id === 'challenging-research')?.model_linkage).toBe('current');
    expect(view.withheld_items.find((item) => item.id === 'challenging-research')?.source_states)
      .toContainEqual({ source_id: 'research-note', state: 'revoked' });
  });

  it('binds every map structure component used by currentness', () => {
    const { input, host } = fixture();
    const saved = createEvidenceAssumptionMap(input, host);
    const variants = [
      (i: typeof input, _h: typeof host) => { i.relationships[0]!.relationship = 'mixed'; },
      (i: typeof input, _h: typeof host) => { i.contradictions[0]!.left_claim_id = 'claim-alternative';
        i.contradictions[0]!.right_claim_id = 'claim-price'; },
      (i: typeof input, h: typeof host) => { i.proposed_implications[0]!.text = 'Review the competing explanation.';
        h.implication_source_bindings[0]!.implication_content_hash = contentHash(i.proposed_implications[0]); },
      (_i: typeof input, h: typeof host) => { h.item_source_bindings.find((b) => b.item_id === 'claim-private')!
        .source_refs.push({ source_id: 'board-pack', source_version: 'v1' }); },
    ];
    for (const change of variants) {
      const currentInput = structuredClone(input);
      const currentHost = structuredClone(host);
      change(currentInput, currentHost);
      expect(assessReasoningArtefactCurrentness(saved, currentInput, currentHost).state).toBe('stale');
    }
  });

  it('ignores order changes in host verdict lists and source references when hashing', () => {
    const { input, host } = fixture();
    const first = createEvidenceAssumptionMap(input, host);
    const reordered = fixture();
    reordered.host.source_statuses.reverse();
    reordered.host.item_source_bindings.reverse();
    reordered.host.item_source_bindings.find((item) => item.item_id === 'claim-price')!.source_refs.reverse();
    reordered.input.items[0]!.source_refs!.reverse();
    expect(createEvidenceAssumptionMap(reordered.input, reordered.host).canonical_input_hash)
      .toBe(first.canonical_input_hash);
  });
});
