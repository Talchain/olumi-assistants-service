import { describe, expect, it } from 'vitest';
import {
  INTAKE_MAY_NAME_LEADING_OPTION,
  applyIntakeToLeaderPermission,
  deriveIntakeOptionReconciliation,
  extractEnumeratedOptions,
  readGraphOptionLabels,
} from '../intake-option-reconciliation.js';

// Reported Panel witness d712b756: these two phrases refer to the same
// intended option, but the saved graph has no binding that proves it.
const BRIEF = 'The options are keeping pricing as it is, raising prices, or introducing a premium tier.';
const OPTIONS = [
  { id: 'keep_current_pricing', label: 'Keep current pricing', provenance: 'from_brief' },
  { id: 'raise_prices', label: 'Raise prices', provenance: 'from_brief' },
  { id: 'premium_tier', label: 'Premium tier', provenance: 'from_brief' },
];
// Synthetic positive controls add explicit source references; these were NOT
// present in the captured graph. Labels play no role in constructing bindings.
const BOUND = [
  { ...OPTIONS[0], source_quote: 'keeping pricing as it is' },
  { ...OPTIONS[1], source_quote: 'raising prices' },
  { ...OPTIONS[2], source_quote: 'introducing a premium tier' },
];

function expectUnknown(options: unknown, provenance?: unknown, brief = BRIEF) {
  const result = deriveIntakeOptionReconciliation(brief, options, provenance);
  expect(result.state).toBe('identity_unverified');
  expect(result.mayNameLeadingOption).toBe(false);
  expect(result.missing).toEqual([]);
}

describe('source-bound option identity containment', () => {
  it('contains the captured paraphrase without declaring a missing option', () => {
    expectUnknown(OPTIONS);
  });
  it('neither exact labels nor overlapping labels establish identity or absence', () => {
    expectUnknown(['keeping pricing as it is', 'raising prices', 'introducing a premium tier']);
    expectUnknown(OPTIONS.map((option, index) => ({ ...option, label: BOUND[index]!.source_quote })));
    expectUnknown([OPTIONS[0], OPTIONS[1]]);
    expectUnknown([{ id: 'o1', label: 'Alpha' }, { id: 'o2', label: 'Beta' }]);
  });
  it('reconciles unique validated source bindings regardless of the authored labels', () => {
    const result = deriveIntakeOptionReconciliation(BRIEF, BOUND);
    expect(result.state).toBe('reconciled');
    expect(result.mayNameLeadingOption).toBe(true);
    expect(result.missing).toEqual([]);
  });
  it('AIQ 5887822471: an unbound listed candidate NO registered option declares is NOT claimed missing — it is named as unverified', () => {
    // Complete analysed-set bindings alone no longer prove an omission: the drafter may have DROPPED the premium tier or
    // the phrase may be a parser fragment, and nothing on the graph tells the two apart.
    const result = deriveIntakeOptionReconciliation(BRIEF, BOUND.slice(0, 2));
    expect(result.state).toBe('identity_unverified');
    expect(result.missing).toEqual([]);
    expect(result.unbound.map((option) => option.text)).toEqual(['introducing a premium tier']);
    // A third, unbound option could be the premium tier: absence is no longer proven.
    expectUnknown([...BOUND.slice(0, 2), OPTIONS[2]]);
  });
  it('AIQ 5887822471: a candidate bound to a REGISTERED option the Run did not analyse (gated out) IS claimed missing, by name', () => {
    const result = deriveIntakeOptionReconciliation(BRIEF, BOUND.slice(0, 2), { options: BOUND });
    expect(result.state).toBe('options_missing');
    expect(result.missing.map((option) => option.text)).toEqual(['introducing a premium tier']);
    expect(result.unbound).toEqual([]);
  });
  it('reads existing OptionV3 extraction quotes without rewording them', () => {
    const options = BOUND.map(({ source_quote, ...option }) => ({
      ...option, provenance: { source: 'brief_extraction', brief_quote: source_quote },
    }));
    expect(deriveIntakeOptionReconciliation(BRIEF, { options }).state).toBe('reconciled');
    expectUnknown(options.map((option) => ({
      ...option, provenance: { ...option.provenance, source: 'cee_hypothesis' },
    })));
  });
  it('restores projected-out lineage by canonical ID from the same snapshot', () => {
    const nodes = BOUND.map((option) => ({ ...option, kind: 'option' }));
    expect(deriveIntakeOptionReconciliation(BRIEF, OPTIONS, { nodes }).state).toBe('reconciled');
    expect(deriveIntakeOptionReconciliation(BRIEF, { nodes }).state).toBe('reconciled');
    expectUnknown(OPTIONS, { nodes: nodes.map((option) => ({ ...option, id: `foreign_${option.id}` })) });
    // Extra persisted records do not expand the actual analysed set.
    const missing = deriveIntakeOptionReconciliation(BRIEF, OPTIONS.slice(0, 2), { nodes });
    expect(missing.state).toBe('options_missing');
    expect(missing.missing[0]!.text).toBe('introducing a premium tier');
  });
  it.each([
    ['duplicate canonical ID', [BOUND[0], { ...BOUND[1], id: BOUND[0]!.id }, BOUND[2]]],
    ['duplicate source binding', [BOUND[0], { ...BOUND[1], source_quote: BOUND[0]!.source_quote }, BOUND[2]]],
    ['foreign quote', [{ ...BOUND[0], source_quote: 'keeping costs as they are' }, ...BOUND.slice(1)]],
    ['partial quote', [{ ...BOUND[0], source_quote: 'pricing' }, ...BOUND.slice(1)]],
    ['malformed quote', [{ ...BOUND[0], source_quote: 12 }, ...BOUND.slice(1)]],
    ['empty quote', [{ ...BOUND[0], source_quote: '' }, ...BOUND.slice(1)]],
    ['missing ID', [{ source_quote: BOUND[0]!.source_quote }, ...BOUND.slice(1)]],
    ['conflicting IDs', [{ ...BOUND[0], option_id: 'different' }, ...BOUND.slice(1)]],
    ['empty analysed set', []],
    ['malformed option', [null, ...BOUND.slice(1)]],
  ])('leaves %s unresolved', (_name, options) => expectUnknown(options));
  it('rejects duplicate or conflicting bindings across canonical carriers', () => {
    expectUnknown(OPTIONS, { options: [...BOUND, BOUND[0]] });
    expectUnknown(BOUND, { nodes: [{ ...BOUND[0], kind: 'option', source_quote: BOUND[1]!.source_quote }] });
  });
  it('cannot choose between repeated source occurrences', () => {
    expectUnknown(BOUND, undefined, `${BRIEF} We discussed keeping pricing as it is earlier.`);
    expectUnknown(BOUND, undefined, 'The options are keeping pricing as it is, raising prices, or keeping pricing as it is.');
  });
  it('has no intake opinion when no explicit enumeration can be read', () => {
    for (const brief of [undefined, null, '', 'We need to improve pricing.', 'The options are raising prices.']) {
      expect(deriveIntakeOptionReconciliation(brief, OPTIONS).state).toBe('not_applicable');
    }
  });
  it('withholds on every unresolved state without changing the independent constraint verdict', () => {
    expect(INTAKE_MAY_NAME_LEADING_OPTION).toEqual({
      not_applicable: true, reconciled: true, options_missing: false, identity_unverified: false,
    });
    for (const options of [OPTIONS, BOUND.slice(0, 2), BOUND]) {
      const intake = deriveIntakeOptionReconciliation(BRIEF, options);
      const withheld = { may_name_leading_option: false, constraint_verdict_state: 'unevaluated' } as const;
      expect(applyIntakeToLeaderPermission(withheld, intake)).toEqual(withheld);
      const permitted = { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' } as const;
      expect(applyIntakeToLeaderPermission(permitted, intake)).toEqual({
        ...permitted, may_name_leading_option: intake.mayNameLeadingOption,
      });
    }
  });
  it('keeps label reading for display-only consumers', () => {
    expect(readGraphOptionLabels({ options: OPTIONS })).toEqual(OPTIONS.map((option) => option.label));
    expect(readGraphOptionLabels(undefined)).toEqual([]);
  });
});

describe('2.579 producer — the decimal-point trap (CLAUDE.md trap 22)', () => {
  it('does not cut the enumeration at a decimal point', () => {
    // Trap 22 shipped six live defects because a window cut at the first
    // `[.!?]` truncated "£1.5 million" to "1" — the guard was correct and
    // pointed at the wrong bytes. An options list can carry a decimal.
    const extracted = extractEnumeratedOptions(
      'The options are a 2.5 tonne dough mixer, a second oven line, or a packing cell. ' +
        'The goal is profit.',
    );
    expect(extracted.map((e) => e.text)).toEqual([
      'a 2.5 tonne dough mixer',
      'a second oven line',
      'a packing cell',
    ]);
  });

  it('does not cut the enumeration at an abbreviation', () => {
    const extracted = extractEnumeratedOptions(
      'The options are a new van, a retrofit, or a concession (e.g. a station kiosk). Then we decide.',
    );
    expect(extracted.map((e) => e.text)).toContain('a new van');
    expect(extracted.some((e) => e.text.includes('kiosk'))).toBe(true);
  });

  it('DOES stop at a genuine sentence boundary', () => {
    const extracted = extractEnumeratedOptions(
      'The options are a new van or a retrofit. The goal is to raise profit by 8 percent.',
    );
    expect(extracted.map((e) => e.text)).toEqual(['a new van', 'a retrofit']);
  });
});

it('contains the exact persisted pricing witness without inferring a duplicate option', () => {
  // Read-only capture 2026-09-24T05:11:59Z, d712b756, CEE 6dfb56f2.
  const brief = "We run a B2B SaaS product. Pro is £49/month and we have about 300 paying customers. We're deciding between raising Pro to £59, adding a new £89 Enterprise tier, or keeping pricing as it is. Goal: reach £20k MRR within 12 months. Hard limit: monthly churn must stay under 4%.";
  const options = [
    { id: 'raise_pro_to_59', kind: 'option', label: 'Raise Pro to £59', provenance: 'from_brief' },
    { id: 'add_89_enterprise_tier', kind: 'option', label: 'Add £89 Enterprise tier', provenance: 'from_brief' },
    { id: 'keep_current_pricing', kind: 'option', label: 'Keep current pricing', provenance: 'from_brief' },
  ];
  const result = deriveIntakeOptionReconciliation(brief, options, { nodes: options });
  expect(result.state).toBe('identity_unverified');
  expect(result.enumerated.map((option) => option.text)).toEqual([
    'raising Pro to £59', 'adding a new £89 Enterprise tier', 'keeping pricing as it is',
  ]);
  expect(result.missing).toEqual([]);
  expect(result.mayNameLeadingOption).toBe(false);
});

describe('AIQ 5887822471 / DL 5887922249 — three outcomes, each claim only as strong as its binding', () => {
  const HELD = { id: 'carry_on', label: 'Carry on as now', is_baseline: true };
  const PROPOSED = { id: 'moderate_rise', label: 'Moderate rise', proposed_by: 'olumi' };

  it('RECONCILED: exact quotes on every listed candidate + a TYPED status quo with no quote → a leader may be named', () => {
    const result = deriveIntakeOptionReconciliation(BRIEF, [...BOUND, HELD]);
    expect(result.state).toBe('reconciled');
    expect(result.mayNameLeadingOption).toBe(true);
  });
  it('RECONCILED: Olumi\'s typed proposal (`proposed_by: \'olumi\'`) needs no binding; the type is read off the registered node', () => {
    expect(deriveIntakeOptionReconciliation(BRIEF, [...BOUND, PROPOSED]).state).toBe('reconciled');
    // The wire option carries no type; the same-snapshot graph node does (MG writes the marker on the option node).
    const wire = [...BOUND, { id: 'moderate_rise', label: 'Moderate rise' }];
    const graph = { options: wire, nodes: [{ ...PROPOSED, kind: 'option' }] };
    expect(deriveIntakeOptionReconciliation(BRIEF, wire, graph).state).toBe('reconciled');
  });
  it('UNVERIFIED: an UNTYPED extra option the Run analysed with nothing binding it withholds, and is named by id', () => {
    const result = deriveIntakeOptionReconciliation(BRIEF, [...BOUND, { id: 'moderate_rise', label: 'Moderate rise' }]);
    expect(result.state).toBe('identity_unverified');
    expect(result.unbound_option_ids).toEqual(['moderate_rise']);
    expect(result.unbound).toEqual([]);
  });
  it('UNVERIFIED: a label or an origin flag never types an option — only the typed fields do', () => {
    const labelled = { id: 'status_quo', label: 'Status quo', origin: 'ai', provenance: { source: 'ai_proposed' } };
    expect(deriveIntakeOptionReconciliation(BRIEF, [...BOUND, labelled]).state).toBe('identity_unverified');
  });
  it('FRAGMENT: a listed phrase that is not an option (the support brief) is named as unverified, NEVER `options_missing`', () => {
    const brief = 'The options are: outsourcing first-line support, removing 5 support roles, or saving £320k a year.';
    const analysed = [
      { id: 'outsource', label: 'Outsource support', source_quote: 'outsourcing first-line support' },
      { id: 'remove_roles', label: 'Remove roles', source_quote: 'removing 5 support roles' },
      { ...HELD },
    ];
    const result = deriveIntakeOptionReconciliation(brief, analysed, { options: analysed });
    expect(result.state).toBe('identity_unverified');
    expect(result.missing).toEqual([]);
    expect(result.unbound.map((option) => option.text)).toEqual(['saving £320k a year']);
  });
  it('MIXED: one candidate gated out + one no option declares → unverified, naming only the undeclared one', () => {
    const brief = 'The options are raising prices, introducing a premium tier, or cutting support hours.';
    const registered = [
      { id: 'raise_prices', label: 'Raise prices', source_quote: 'raising prices' },
      { id: 'premium_tier', label: 'Premium tier', source_quote: 'introducing a premium tier' },
    ];
    const result = deriveIntakeOptionReconciliation(brief, registered.slice(0, 1), { options: registered });
    expect(result.state).toBe('identity_unverified');
    expect(result.unbound.map((option) => option.text)).toEqual(['cutting support hours']);
  });
  it('AMBIGUOUS: two different registered options quoting the gated-out candidate prove nothing → unverified', () => {
    const registered = [...BOUND, { id: 'premium_tier_2', label: 'Premium', source_quote: 'introducing a premium tier' }];
    const result = deriveIntakeOptionReconciliation(BRIEF, BOUND.slice(0, 2), { options: registered });
    expect(result.state).toBe('identity_unverified');
    expect(result.missing).toEqual([]);
  });
});
