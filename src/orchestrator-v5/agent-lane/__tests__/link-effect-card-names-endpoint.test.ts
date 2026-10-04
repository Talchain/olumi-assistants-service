import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { approvalChipsFor } from '../approval-chips.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { linkEffectEdgeToken } from '../../system-events/link-effect-edit.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';

type Json = Record<string, any>;
const C = (JSON.parse(readFileSync(new URL('./fixtures/served-journey-c-price-subscribers-unsized-5411da8.json', import.meta.url), 'utf8')) as { graph: Json }).graph;
const ORIGINAL = 'pro_plan_price';
const COPY = 'pro_plan_price_copy';
const TARGET = 'pro_plan_paying_subscribers';
const ORIGINAL_NAME = 'Pro plan price (linked to Carry On as Now, Features and Price Rise, MRR, Price Rise Only, Price sensitivity risk, Pro plan paying subscribers)';
const COPY_NAME = 'Pro plan price (linked to Pro plan paying subscribers)';
const QUOTE = 'every £1 on the Pro price loses us about 50 paying subscribers';
const EFFECT = { amount: -50, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: 'GBP per month' };
const ARGS = { ...EFFECT, from_label: COPY, to_label: 'Pro plan paying subscribers', quote: QUOTE };
const ctx = (user_text = `Honestly, ${QUOTE}.`) => ({
  scenario_id: '550e8400-e29b-41d4-a716-4466554400a7', authenticated_user_id: null, request_id: 'card-names', user_text,
});
const reading = (from: string, to = 'Pro plan paying subscribers') =>
  `Record: +£1/month on "${from}" → −50 subscribers in "${to}" — from your words: "${QUOTE}"`;
const operation = (graph: Json, from: string, to = TARGET) => ({
  op: 'set_link_effect', path: `${from}::${to}`, value: { from, to, effect: EFFECT, quote: QUOTE, edge_token: linkEffectEdgeToken(graph, from, to) },
});

function duplicatedGraph(): Json {
  const graph = structuredClone(C);
  graph.nodes.push({ ...structuredClone(graph.nodes.find((n: Json) => n.id === ORIGINAL)), id: COPY });
  graph.edges.push({ ...structuredClone(graph.edges.find((e: Json) => e.from === ORIGINAL && e.to === TARGET)), from: COPY });
  return graph;
}

function world(graph = duplicatedGraph()) {
  const store = new ProposalStore();
  const sent: CommitOptionLevelsInput[] = [];
  const dispatch: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  // Same pressed-card harness as link-effect-answer.test.ts; this local door records only the exact ids sent.
  const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    sent.push(input);
    for (const item of input.link_effect !== undefined ? [input.link_effect] : input.link_effects ?? []) {
      const edge = graph.edges.find((e: Json) => e.from === item.from && e.to === item.to)!;
      edge.provenance = { ...(edge.provenance ?? {}), source: 'user_specified', magnitude: 'user_stated', natural_effect: item.effect };
    }
    return { status: 'committed', graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, receipt: null, already_applied: false, committed_levels: [] };
  };
  return { graph, store, sent, caps: createAgentCapabilities(dispatch, store, undefined, 'full', undefined, { commitOptionLevels }) };
}
const cardFor = (w: ReturnType<typeof world>, result: Json) => approvalChipsFor([
  { name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(result.proposal_id) },
], (id) => ({ proposal: w.store.get(id), result: result as never }))[0]!;
const press = (w: ReturnType<typeof world>, result: Json, words: string) => w.caps.authoriseChange({
  ...ctx(words), typed_approval_of: String(result.proposal_id), typed_approval_words: words,
}, { proposal_id: String(result.proposal_id) });

// A two-link group exercises approval-chips' links[] reading and approval's multi-operation recompute.
const prepare = async (w: ReturnType<typeof world>, grouped: boolean, first = COPY): Promise<Json> =>
  await w.caps.proposeLinkEffect!(ctx(), grouped
    ? { links: [{ ...ARGS, from_label: first }, { ...ARGS, from_label: first === COPY ? ORIGINAL : COPY }] }
    : { ...ARGS, from_label: first }) as Json;

describe('link-effect approval cards name the exact endpoint', () => {
  it.each([false, true])('control: a shared label refuses ambiguous_entity and stores nothing (grouped=%s)', async (grouped) => {
    const w = world();
    const args = { ...ARGS, from_label: 'Pro plan price' };
    const result = await w.caps.proposeLinkEffect!(ctx(), grouped ? { links: [args] } : args);
    expect(result).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'ambiguous_entity' }));
    expect(w.store.size()).toBe(0);
    expect(w.sent).toEqual([]);
  });

  it('single: the copy id binds the exact operation and a different exact card from the original id', async () => {
    const w = world();
    const copy = await prepare(w, false);
    expect(copy.ok, JSON.stringify(copy)).toBe(true);
    expect(w.store.get(String(copy.proposal_id))?.operations).toEqual([operation(w.graph, COPY)]);
    expect(w.store.get(String(copy.proposal_id))?.provenance.authored_by).toBe('user_stated');
    expect(copy.link).toEqual({ from: COPY_NAME, to: 'Pro plan paying subscribers', effect: EFFECT, your_words: QUOTE });
    // The proposal's own label (pending-action copy) names the same identity as the card.
    expect(w.store.get(String(copy.proposal_id))?.public_label).toBe(`Record your figure for how "${COPY_NAME}" moves "Pro plan paying subscribers": "${QUOTE}"`);
    const copyCard = cardFor(w, copy);
    expect(copyCard.detail).toBe(reading(COPY_NAME));
    expect(copyCard.message).toBe(`Yes — ${reading(COPY_NAME)}`);
    const original = await prepare(w, false, ORIGINAL);
    expect(original.ok).toBe(true);
    expect(w.store.get(String(original.proposal_id))?.operations).toEqual([operation(w.graph, ORIGINAL)]);
    expect(cardFor(w, original).message).toBe(`Yes — ${reading(ORIGINAL_NAME)}`);
    expect(copyCard.message).not.toBe(cardFor(w, original).message);
  });

  it('grouped: both exact endpoint ids bind ordered operations and different exact card readings', async () => {
    const w = world();
    const result = await prepare(w, true);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(w.store.get(String(result.proposal_id))?.operations).toEqual([operation(w.graph, COPY), operation(w.graph, ORIGINAL)]);
    expect(w.store.get(String(result.proposal_id))?.provenance.authored_by).toBe('user_stated');
    expect(result.links).toEqual([
      { from: COPY_NAME, to: 'Pro plan paying subscribers', effect: EFFECT, your_words: QUOTE },
      { from: ORIGINAL_NAME, to: 'Pro plan paying subscribers', effect: EFFECT, your_words: QUOTE },
    ]);
    expect(cardFor(w, result).detail).toBe(`${reading(COPY_NAME)}\n${reading(ORIGINAL_NAME)}`);
    expect(cardFor(w, result).message).toBe(`Yes — ${reading(COPY_NAME)}\n${reading(ORIGINAL_NAME)}`);
    const reversed = await prepare(w, true, ORIGINAL);
    expect(reversed.ok).toBe(true);
    expect(w.store.get(String(reversed.proposal_id))?.operations).toEqual([operation(w.graph, ORIGINAL), operation(w.graph, COPY)]);
    expect(cardFor(w, reversed).message).toBe(`Yes — ${reading(ORIGINAL_NAME)}\n${reading(COPY_NAME)}`);
    expect(cardFor(w, result).message).not.toBe(cardFor(w, reversed).message);
  });

  it.each([false, true])('approval: an OLD card (prepared before this fix, bare shared label) is refused reading_not_confirmed; the disambiguated card records only its endpoint ids (grouped=%s)', async (grouped) => {
    const w = world();
    const result = await prepare(w, grouped);
    expect(result.ok).toBe(true);
    const bare = reading('Pro plan price');
    const refused = await press(w, result, `Yes — ${grouped ? `${bare}\n${bare}` : bare}`);
    expect(refused).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'not_applied', reason: 'reading_not_confirmed' }));
    expect(w.sent).toEqual([]);
    expect(w.graph.edges.find((e: Json) => e.from === COPY && e.to === TARGET).provenance.magnitude).toBeUndefined();
    const card = cardFor(w, result);
    expect(card.message).toBe(`Yes — ${grouped ? `${reading(COPY_NAME)}\n${reading(ORIGINAL_NAME)}` : reading(COPY_NAME)}`);
    const applied = await press(w, result, card.message);
    expect(applied, JSON.stringify(applied)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true }));
    expect(w.sent).toHaveLength(1);
    const input = w.sent[0]!;
    const effects = input.link_effect !== undefined ? [input.link_effect] : input.link_effects!;
    expect(effects.map((e) => ({ from: e.from, to: e.to, effect: e.effect }))).toEqual(
      (grouped ? [COPY, ORIGINAL] : [COPY]).map((from) => ({ from, to: TARGET, effect: EFFECT })),
    );
    expect(w.graph.edges.find((e: Json) => e.from === COPY && e.to === TARGET).provenance).toEqual(expect.objectContaining({
      source: 'user_specified', magnitude: 'user_stated', natural_effect: EFFECT,
    }));
    if (!grouped) expect(w.graph.edges.find((e: Json) => e.from === ORIGINAL && e.to === TARGET).provenance.magnitude).toBeUndefined();
  });

  it('unique labels: plain journey C card strings remain byte-identical', async () => {
    const w = world(structuredClone(C));
    const result = await prepare(w, false, ORIGINAL);
    expect(result.ok).toBe(true);
    expect(w.store.get(String(result.proposal_id))?.operations).toEqual([operation(w.graph, ORIGINAL)]);
    expect(result.link).toEqual({ from: 'Pro plan price', to: 'Pro plan paying subscribers', effect: EFFECT, your_words: QUOTE });
    expect(cardFor(w, result).detail).toBe(`Record: +£1/month on "Pro plan price" → −50 subscribers in "Pro plan paying subscribers" — from your words: "every £1 on the Pro price loses us about 50 paying subscribers"`);
    expect(cardFor(w, result).message).toBe(`Yes — Record: +£1/month on "Pro plan price" → −50 subscribers in "Pro plan paying subscribers" — from your words: "every £1 on the Pro price loses us about 50 paying subscribers"`);
  });

  it('a unique nonempty description takes priority over distinct connections', async () => {
    const w = world();
    w.graph.nodes.find((n: Json) => n.id === COPY).description = 'Pilot cohort price';
    w.graph.nodes.find((n: Json) => n.id === ORIGINAL).description = 'Established cohort price';
    const result = await prepare(w, false);
    expect(result.link.from).toBe('Pro plan price (Pilot cohort price)');
    expect(cardFor(w, result).message).toBe(`Yes — ${reading('Pro plan price (Pilot cohort price)')}`);
    expect((await prepare(w, false, ORIGINAL)).link.from).toBe('Pro plan price (Established cohort price)');
  });

  it('normalised shared labels and descriptions still require distinct connections', async () => {
    const w = world();
    w.graph.nodes.find((n: Json) => n.id === COPY).label = ' PRO PLAN PRICE…';
    w.graph.nodes.find((n: Json) => n.id === COPY).description = ' SAME DESCRIPTION…';
    w.graph.nodes.find((n: Json) => n.id === ORIGINAL).description = 'same description';
    const result = await prepare(w, false);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(cardFor(w, result).message).toBe(`Yes — ${reading(' PRO PLAN PRICE… (linked to Pro plan paying subscribers)')}`);
  });

  it('identical descriptions and connected labels fall back to exact ids', async () => {
    const graph = duplicatedGraph();
    graph.edges = graph.edges.filter((e: Json) => e.from !== COPY && e.to !== COPY);
    graph.edges.push(...graph.edges.filter((e: Json) => e.from === ORIGINAL || e.to === ORIGINAL).map((e: Json) => ({
      ...structuredClone(e), from: e.from === ORIGINAL ? COPY : e.from, to: e.to === ORIGINAL ? COPY : e.to,
    })));
    const w = world(graph);
    const result = await prepare(w, true);
    expect(result.ok).toBe(true);
    expect(cardFor(w, result).message).toBe(`Yes — ${reading('Pro plan price (pro_plan_price_copy)')}\n${reading('Pro plan price (pro_plan_price)')}`);
  });

  it('the disambiguator must differ from every same-label rival, including a third node', async () => {
    const graph = duplicatedGraph();
    graph.nodes.push({ ...structuredClone(graph.nodes.find((n: Json) => n.id === COPY)), id: 'pro_plan_price_third' });
    graph.edges.push({ ...structuredClone(graph.edges.find((e: Json) => e.from === COPY && e.to === TARGET)), from: 'pro_plan_price_third' });
    const w = world(graph);
    const result = await prepare(w, true);
    expect(cardFor(w, result).message).toBe(`Yes — ${reading('Pro plan price (pro_plan_price_copy)')}\n${reading(ORIGINAL_NAME)}`);
    const third = await prepare(w, false, 'pro_plan_price_third');
    expect(w.store.get(String(third.proposal_id))?.operations).toEqual([operation(w.graph, 'pro_plan_price_third')]);
    expect(cardFor(w, third).message).toBe(`Yes — ${reading('Pro plan price (pro_plan_price_third)')}`);
  });

  it.each([false, true])('both ends are disambiguated by identity (grouped=%s)', async (grouped) => {
    const w = world();
    const targetCopy = 'pro_plan_paying_subscribers_copy';
    w.graph.nodes.push({ ...structuredClone(w.graph.nodes.find((n: Json) => n.id === TARGET)), id: targetCopy, description: 'Pilot cohort subscribers' });
    w.graph.nodes.find((n: Json) => n.id === TARGET).description = 'Established cohort subscribers';
    w.graph.edges.push({ ...structuredClone(w.graph.edges.find((e: Json) => e.from === COPY && e.to === TARGET)), to: targetCopy });
    const first = { ...ARGS, to_label: targetCopy };
    const result = await w.caps.proposeLinkEffect!(ctx(), grouped ? { links: [first, { ...ARGS, from_label: ORIGINAL, to_label: TARGET }] } : first) as Json;
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(w.store.get(String(result.proposal_id))?.operations).toEqual(grouped
      ? [operation(w.graph, COPY, targetCopy), operation(w.graph, ORIGINAL)] : [operation(w.graph, COPY, targetCopy)]);
    const firstReading = reading(COPY_NAME, 'Pro plan paying subscribers (Pilot cohort subscribers)');
    const secondReading = reading(ORIGINAL_NAME, 'Pro plan paying subscribers (Established cohort subscribers)');
    expect(cardFor(w, result).message).toBe(`Yes — ${grouped ? `${firstReading}\n${secondReading}` : firstReading}`);
    expect(await press(w, result, cardFor(w, result).message)).toEqual(expect.objectContaining({ ok: true, applied: true }));
    const input = w.sent[0]!;
    expect((input.link_effect !== undefined ? [input.link_effect] : input.link_effects!).map((e) => [e.from, e.to])).toEqual(
      grouped ? [[COPY, targetCopy], [ORIGINAL, TARGET]] : [[COPY, targetCopy]],
    );
  });

  it('names are deterministic under node and edge reordering and duplicate neighbours', async () => {
    const first = world();
    const before = await prepare(first, true);
    const graph = duplicatedGraph();
    graph.nodes.reverse();
    graph.edges.reverse();
    // A duplicate NEIGHBOUR of the original (its MRR link twice), never a parallel copy of a proposed pair, which now
    // prepares nothing (`target_ambiguous`, rows below).
    graph.edges.push(structuredClone(graph.edges.find((e: Json) => e.from === ORIGINAL && e.to === 'mrr')));
    const second = world(graph);
    const after = await prepare(second, true);
    expect(cardFor(second, after).message).toBe(cardFor(first, before).message);
    expect(cardFor(second, after).message).toBe(`Yes — ${reading(COPY_NAME)}\n${reading(ORIGINAL_NAME)}`);
  });

  it.each([
    ['linked to Carry On as Now, Features and Price Rise, MRR, Price Rise Only, Price sensitivity risk, Pro plan paying subscribers', 'Pro plan price (pro_plan_price)'],
    [ORIGINAL, ORIGINAL_NAME],
  ])('a description colliding with a rival connection or reserved id name uses its own id (%s)', async (description, originalName) => {
    const w = world();
    w.graph.nodes.find((n: Json) => n.id === COPY).description = description;
    // A description equal to ORIGINAL also makes that request ambiguous under the unchanged resolver.
    const grouped = description !== ORIGINAL;
    const result = await prepare(w, grouped);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(cardFor(w, result).message).toBe(`Yes — ${reading('Pro plan price (pro_plan_price_copy)')}${grouped ? `\n${reading(originalName)}` : ''}`);
  });

  it('approval recomputes the current disambiguator and refuses an outdated description reading', async () => {
    const w = world();
    const copy = w.graph.nodes.find((n: Json) => n.id === COPY);
    copy.description = 'Pilot cohort price';
    const result = await prepare(w, false);
    const card = cardFor(w, result);
    expect(card.message).toBe(`Yes — ${reading('Pro plan price (Pilot cohort price)')}`);
    const hash = computeAnalysisAffectingGraphHash(w.graph as never);
    copy.description = 'New cohort price';
    expect(computeAnalysisAffectingGraphHash(w.graph as never)).toBe(hash);
    expect(await press(w, result, card.message)).toEqual(expect.objectContaining({
      ok: false, mutated: false, reason: 'reading_not_confirmed',
    }));
    expect(w.sent).toEqual([]);
  });
});

/**
 * ⛔ A CARD NAME IS UNIQUE ACROSS THE WHOLE GRAPH, not only within its shared-label group (DL #2561 round 2, P1): a
 * decorated name must never read as another node's literal label, at every suffix tier. Each row binds the endpoint ids.
 */
describe('card names never collide with a literal label elsewhere in the graph', () => {
  const LITERAL = 'literal_label_node';
  const COPY2 = 'pro_plan_price_copy2';
  const withLiteral = (literal: string, setup: (g: Json) => void, kind: 'factor' | 'option'): Json => {
    const graph = duplicatedGraph();
    setup(graph);
    if (kind === 'option') {
      graph.nodes.push({ id: LITERAL, kind: 'option', label: literal });
    } else {
      graph.nodes.push({ ...structuredClone(graph.nodes.find((n: Json) => n.id === ORIGINAL)), id: LITERAL, label: literal });
      graph.edges.push({ ...structuredClone(graph.edges.find((e: Json) => e.from === ORIGINAL && e.to === TARGET)), from: LITERAL });
    }
    return graph;
  };
  // [tier, the other node's literal label, setup, the copy's card name, the literal node's kind]. The connection tier's
  // literal names the target ("…linked to Pro plan paying subscribers"), which the statement rule (unchanged here) reads as
  // a rival end for a quantity; as an option's label it is outside that rule and still on the card's graph.
  const tiers: [string, string, (g: Json) => void, string, 'factor' | 'option'][] = [
    ['description', 'Pro plan price (Pilot)', (g) => { g.nodes.find((n: Json) => n.id === COPY).description = 'Pilot'; },
      'Pro plan price (pro_plan_price_copy)', 'factor'],
    ['connection', COPY_NAME, () => {}, 'Pro plan price (pro_plan_price_copy)', 'option'],
    // COPY2 shares COPY's label, description (none) and connections, so both fall to the id tier; a literal label
    // equal to COPY's id name pushes it to the next free id name.
    ['id', 'Pro plan price (pro_plan_price_copy)', (g) => {
      g.nodes.push({ ...structuredClone(g.nodes.find((n: Json) => n.id === COPY)), id: COPY2 });
      g.edges.push({ ...structuredClone(g.edges.find((e: Json) => e.from === COPY && e.to === TARGET)), from: COPY2 });
    }, 'Pro plan price (pro_plan_price_copy, 2)', 'factor'],
  ];

  it.each(tiers)('RED (%s tier): the shared-label node never reads as the literal label, and its card binds its own id', async (_tier, literal, setup, copyName, kind) => {
    const w = world(withLiteral(literal, setup, kind));
    const both = kind === 'factor';
    // One link goes through the single call: a one-link GROUP's card is the pre-existing P2 follow-up (approval-chips reads
    // `result.link` for one operation), not this row's subject.
    const result = await w.caps.proposeLinkEffect!(ctx(), both
      ? { links: [{ ...ARGS, from_label: COPY }, { ...ARGS, from_label: LITERAL }] } : { ...ARGS, from_label: COPY }) as Json;
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(w.store.get(String(result.proposal_id))?.operations).toEqual([operation(w.graph, COPY), ...(both ? [operation(w.graph, LITERAL)] : [])]);
    expect((both ? result.links : [result.link]).map((l: Json) => l.from)).toEqual([copyName, ...(both ? [literal] : [])]);
    expect(copyName).not.toBe(literal);
    expect(cardFor(w, result).detail).toBe([reading(copyName), ...(both ? [reading(literal)] : [])].join('\n'));
    const applied = await press(w, result, cardFor(w, result).message);
    expect(applied, JSON.stringify(applied)).toEqual(expect.objectContaining({ ok: true, applied: true }));
    expect(w.sent).toHaveLength(1);
    const sent = w.sent[0]!.link_effect !== undefined ? [w.sent[0]!.link_effect] : w.sent[0]!.link_effects!;
    expect(sent.map((e) => `${e.from}::${e.to}`)).toEqual([`${COPY}::${TARGET}`, ...(both ? [`${LITERAL}::${TARGET}`] : [])]);
  });

  it.each(tiers)('RED (%s tier): a card worded with the literal label never approves the shared-label node\'s proposal', async (_tier, literal, setup, copyName, kind) => {
    const w = world(withLiteral(literal, setup, kind));
    const copy = await w.caps.proposeLinkEffect!(ctx(), { ...ARGS, from_label: COPY }) as Json;
    expect(copy.ok, JSON.stringify(copy)).toBe(true);
    expect(copy.link.from).toBe(copyName);
    if (kind === 'factor') {
      const lit = await w.caps.proposeLinkEffect!(ctx(), { ...ARGS, from_label: LITERAL }) as Json;
      expect(lit.link.from).toBe(literal);
      expect(cardFor(w, copy).message).not.toBe(cardFor(w, lit).message);
    }
    expect(await press(w, copy, `Yes — ${reading(literal)}`)).toEqual(expect.objectContaining({ ok: false, reason: 'reading_not_confirmed' }));
    expect(w.sent).toEqual([]);
  });
  // Codex round 3 (P1): what a reader cannot tell apart — case, spaces, a trailing ellipsis — never separates two names.
  const visual = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim().replace(/\s*(?:…|\.\.\.)+$/, '').trim();
  const VARIANTS = [['ellipsis then space', (l: string) => `${l}… `], ['space then ellipsis', (l: string) => `${l} …`],
    ['three dots', (l: string) => `${l}...`], ['padded and doubled spaces', (l: string) => `  ${l.replace(' ', '  ')}  `],
    ['other case', (l: string) => l.toUpperCase()]] as const;
  it.each(tiers.flatMap(([tier, literal, setup, copyName, kind]) => VARIANTS.map(([variant, dress]) =>
    [tier, variant, dress(literal), setup, copyName, kind] as const)))('RED (%s tier, literal with %s): the shared-label node\'s name never reads as the literal, bound to its id', async (_tier, _variant, literal, setup, copyName, kind) => {
    const w = world(withLiteral(literal, setup, kind));
    const copy = await w.caps.proposeLinkEffect!(ctx(), { ...ARGS, from_label: COPY }) as Json;
    expect(copy.ok, JSON.stringify(copy)).toBe(true);
    expect(w.store.get(String(copy.proposal_id))?.operations).toEqual([operation(w.graph, COPY)]);
    expect(copy.link.from).toBe(copyName);
    expect(visual(copy.link.from)).not.toBe(visual(literal));
    expect(await press(w, copy, `Yes — ${reading(literal)}`)).toEqual(expect.objectContaining({ ok: false, reason: 'reading_not_confirmed' }));
    expect(w.sent).toEqual([]);
  });
});

/**
 * ⛔ A PARALLEL COPY OF THE PAIR PREPARES AND WRITES NOTHING (DL #2561 round 2, P1): the card names neither copy, so
 * neither is chosen by array order — at preparation, and at an approval prepared before the copy appeared.
 */
describe('a parallel link prepares nothing and an approval over one writes nothing', () => {
  const withParallel = (graph: Json, copyFirst: boolean): void => {
    const edge = { ...structuredClone(graph.edges.find((e: Json) => e.from === COPY && e.to === TARGET)), provenance: { source: 'cee_hypothesis' } };
    graph.edges = copyFirst ? [edge, ...graph.edges] : [...graph.edges, edge];
  };

  it.each([false, true])('RED single + grouped: target_ambiguous, nothing stored (parallel copy first=%s)', async (copyFirst) => {
    const w = world();
    withParallel(w.graph, copyFirst);
    const single = await w.caps.proposeLinkEffect!(ctx(), { ...ARGS, from_label: COPY }) as Json;
    expect(single).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'target_ambiguous' }));
    const grouped = await w.caps.proposeLinkEffect!(ctx(), { links: [{ ...ARGS, from_label: COPY }] }) as Json;
    expect(grouped).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'target_ambiguous' }));
    expect(w.store.size()).toBe(0);
    // Control in the same graph: the other, unique pair still prepares.
    const other = await w.caps.proposeLinkEffect!(ctx(), { ...ARGS, from_label: ORIGINAL }) as Json;
    expect(other.ok, JSON.stringify(other)).toBe(true);
  });

  // Guard (passes on the base too: the copy moves the analysis hash, so the approval is already model_changed).
  it.each([false, true])('guard: a card prepared before a parallel copy appeared records nothing (grouped=%s)', async (grouped) => {
    const w = world();
    const result = await prepare(w, grouped);
    expect(result.ok).toBe(true);
    withParallel(w.graph, true);
    const out = await press(w, result, cardFor(w, result).message) as Json;
    expect(out).toEqual(expect.objectContaining({ ok: false, mutated: false }));
    expect(w.sent).toEqual([]);
    expect(w.graph.edges.filter((e: Json) => e.provenance?.magnitude === 'user_stated')).toEqual([]);
  });
});
