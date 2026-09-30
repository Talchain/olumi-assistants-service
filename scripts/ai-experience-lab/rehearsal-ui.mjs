import { initialRehearsal, transition, evidenceFor, readFrozenRegions, readFrozenContrastive, contrastiveCurrentness, CONTRASTIVE_SOURCE } from './rehearsal.mjs';

/** Reuses the preview's article renderer and styles. All transitions are recorded-state playback. */
export function mountRehearsal({ add, call }) {
  const root = document.getElementById('rehearsal');
  const live = document.getElementById('live');
  const regions = document.getElementById('regions');
  const regionsToggle = document.getElementById('regions-toggle');
  const toggle = document.getElementById('rehearsal-toggle');
  let data;
  let state = initialRehearsal();
  const card = text => add('assistant', text, root);
  const act = event => { state = transition(state, event); render(); };
  function button(parent, label, event) {
    const node = document.createElement('button');
    node.type = 'button'; node.textContent = label; node.onclick = () => act(event);
    parent.append(node);
  }
  function detail(parent, title, value) {
    const d = document.createElement('details'), s = document.createElement('summary'), p = document.createElement('pre');
    s.textContent = title; p.textContent = JSON.stringify(value, null, 2);
    d.append(s, p); parent.append(d);
  }
  function render() {
    root.replaceChildren();
    const current = data.states[state.phase];
    const intro = card('RECORDED REASONING WALKTHROUGH\n' + data.limits[0]);
    button(intro, 'Restart walkthrough', 'reset');
    const price = current.graph.nodes.find(n => n.id === 'pro_plan_price').observed_state.raw_value;
    const model = card(`Recorded model · Pro price £${price}/month\nTarget: £20k MRR, churn below 4%. Subscriber count 300, churn 3% and feature value 50/100 are Olumi assumptions in this capture.\n${data.limits[2]}\n${state.phase === 'stale' ? 'Edited: the earlier analysis is stale.' : 'Recorded analysis is current for the snapshot shown.'}`);
    detail(model, 'Snapshot and source', { graph: current.graph, run: current.card.run_binding,
      adapter_head: data.adapter_head, captured: data.capture.captured });

    if (state.choice === 'dismissed') {
      card('Challenge dismissed for this walkthrough. No model value changed. Restart to try another route.');
    } else {
      const proposal = card(`RECORDED OLUMI CHALLENGE\n${data.challenge.title}\n${data.challenge.text}`);
      const controls = document.createElement('div'); controls.className = 'toolbar'; proposal.append(controls);
      button(controls, 'Explore', 'explore');
      if (state.choice === 'offered') button(controls, 'Add to investigation notes', 'add');
      if (state.phase === 'before') button(controls, 'Dismiss', 'dismiss');
      if (state.choice === 'added') card('Added to this walkthrough’s investigation notes. This records a question to investigate; it changes no model value.');
      if (state.explored) card('RECORDED EXPLORATION\n' + data.challenge.exploration);
    }

    const lines = evidenceFor(data, state);
    if (lines.length) card('EVIDENCE TO CONSIDER · SCIENCE PROTOTYPE\n' + lines.join('\n\n'));
    else card(state.phase === 'stale'
      ? 'Evidence card withdrawn: the recorded model changed. Replay the recorded rerun to see the new card.'
      : 'No evidence card is available for this recorded state.');
    card('WHAT WOULD CHANGE THIS?\n' + data.limits[3]);

    if (state.choice === 'added' && state.phase === 'before') {
      const edit = card('TRY THE RECORDED UPDATE\nThis capture next changed the current Pro price from £49 to £50. You can replay that exact change; no service or saved scenario will be edited.');
      if (state.approvalPending) {
        button(edit, 'Apply £50 in this walkthrough', 'approve_change');
        button(edit, 'Cancel change', 'cancel_change');
      } else button(edit, 'Review recorded £49 → £50 change', 'propose_change');
    }
    if (state.phase === 'stale') {
      const rerun = card('The walkthrough now shows £50 and the old analysis is stale. The next button opens the captured rerun result; it does not launch a new computation.');
      button(rerun, 'Replay recorded rerun', 'replay_rerun');
      detail(rerun, 'Historical write receipt — not a new save', data.change.receipt);
    }
    if (state.phase === 'after') {
      card('WHAT CHANGED · RECORDED RERUN EXPLANATION\n' + current.recorded_explanation);
      card('The evidence wording also changed: this rerun does not resolve which of the three checks would change the comparison. A different estimate is not proof that the price edit caused that difference.');
    }
    card(data.limits[1]);
  }
  toggle.onclick = async () => {
    if (!root.hidden) { root.hidden = true; live.hidden = false; toggle.textContent = 'Open recorded reasoning walkthrough'; return; }
    toggle.disabled = true;
    try {
      data ??= await call('/lab/rehearsal');
      root.hidden = false; live.hidden = true; regions.hidden = true;
      regionsToggle.textContent = 'Open frozen R3-B science cases';
      render(); toggle.textContent = 'Return to live AI comparison';
    } catch (error) { document.getElementById('error').textContent = error.message; }
    finally { toggle.disabled = false; }
  };
}

/** Displays pinned ISL research in the same article UI; never runs a science calculation. */
export function mountFrozenRegions({ add, call }) {
  const root = document.getElementById('regions');
  const live = document.getElementById('live');
  const rehearsal = document.getElementById('rehearsal');
  const toggle = document.getElementById('regions-toggle');
  const rehearsalToggle = document.getElementById('rehearsal-toggle');
  let data;
  let frozenGraphSha256 = CONTRASTIVE_SOURCE.graph_sha256;
  function detail(parent, title, value) {
    const d = document.createElement('details'), s = document.createElement('summary'), p = document.createElement('pre');
    s.textContent = title; p.textContent = JSON.stringify(value, null, 2);
    d.append(s, p); parent.append(d);
  }
  function render() {
    root.replaceChildren();
    if (contrastiveCurrentness(data.contrastive, frozenGraphSha256) === 'stale') {
      add('assistant', 'FROZEN R3-B SCIENCE · STALE LAB SIMULATION\nThe frozen model identity changed in this local simulation. Its earlier threshold and goal-vulnerability claims are withheld; nothing was written or recalculated.', root);
      const restore = document.createElement('button');
      restore.type = 'button'; restore.textContent = 'Restore frozen research snapshot';
      restore.onclick = () => { frozenGraphSha256 = CONTRASTIVE_SOURCE.graph_sha256; render(); };
      root.append(restore);
      return;
    }
    const [threshold, unavailable] = data.regions.cases;
    add('assistant', 'FROZEN R3-B SCIENCE CASES · RESEARCH REFERENCE\nThis is a different graph from the live £100k pricing example and the recorded £20k walkthrough. These are pinned outputs, not fresh analysis or a recommendation.', root);
    const first = add('assistant', `HARD CONSTRAINT BOUNDARY · ${threshold.subject.label}\nFrozen reference: ${threshold.current_value} ${threshold.current_unit}. Frozen threshold: ${threshold.flip_threshold} ${threshold.threshold_unit}.\n${threshold.flip_meaning}\n${threshold.provenance.assumption_qualifier}`, root);
    detail(first, 'Pinned source, graph and fixed assumptions', { source: data.regions.source, provenance: threshold.provenance, fixed_assumptions: threshold.fixed_assumptions });
    const second = add('assistant', `THRESHOLD UNAVAILABLE · ${unavailable.subject.label}\n${unavailable.reason.detail}\nNo numerical threshold or no-effect claim is available for this option.`, root);
    detail(second, 'Pinned source and unavailable reason', { provenance: unavailable.provenance, reason: unavailable.reason, fixed_assumptions: unavailable.fixed_assumptions });
    add('assistant', 'The threshold concerns hard-constraint feasibility in a frozen exploratory slice. It does not establish which option is best, whether any effect is plausible, or how all options compare.', root);
    const study = data.contrastive.study;
    const [holding, churnOnly, competitionOnly, both] = study.contrast.points;
    const tradeoff = add('assistant', `EXPERIMENTAL GOAL VULNERABILITY · ${study.scope.option_label}\nIn this frozen tested grid, churn response ${holding.churn_response_pp_per_10gbp} → ${churnOnly.churn_response_pp_per_10gbp} percentage points per +£10 alone still reaches the £100k goal. Competitive response £0 → £${Math.abs(competitionOnly.competitive_response_gbp_per_month).toLocaleString('en-GB')}/month headwind alone does too. Together they miss it (about £${Math.round(both.month_12_mrr_gbp).toLocaleString('en-GB')} MRR at month 12), while churn stays ${both.monthly_churn_percent}% under its 4% hard limit.\nAn additive trade-off in evaluated model scenarios; not an interaction, likelihood, exact boundary or recommendation.`, root);
    detail(tradeoff, 'Pinned coaching copy, assumptions and Science rulings', { coaching: data.contrastive.coaching, source: data.contrastive.source, frozen_source: study.source, scope: study.scope, claim_limits: study.claim_limits });
    const edit = document.createElement('button');
    edit.type = 'button'; edit.textContent = 'Simulate edit to this frozen model (Lab only)';
    edit.onclick = () => { frozenGraphSha256 = 'lab-simulated-edited-graph'; render(); };
    root.append(edit);
  }
  toggle.onclick = async () => {
    if (!root.hidden) { root.hidden = true; live.hidden = false; toggle.textContent = 'Open frozen R3-B science cases'; return; }
    toggle.disabled = true;
    try {
      const payload = await call('/lab/rehearsal');
      data = { regions: await readFrozenRegions(payload.frozen_regions_raw),
        contrastive: await readFrozenContrastive(payload.frozen_contrastive_raw, payload.frozen_contrastive_copy) };
      root.hidden = false; live.hidden = true; rehearsal.hidden = true;
      rehearsalToggle.textContent = 'Open recorded reasoning walkthrough';
      render(); toggle.textContent = 'Return to live AI comparison';
    } catch (error) { document.getElementById('error').textContent = error.message; }
    finally { toggle.disabled = false; }
  };
}

/** Layout-only example. These words were written for the Lab, not returned by two models. */
export const ILLUSTRATIVE_SECOND_VIEW = Object.freeze({
  kind: 'illustrative_layout_only',
  input_identity: 'illustrative-pricing-model-v1',
  primary: {
    input_identity: 'illustrative-pricing-model-v1',
    text: 'One possible view: if a subscription price changes, customer retention may be the most useful uncertainty to test first.',
  },
  second: {
    input_identity: 'illustrative-pricing-model-v1',
    text: 'A different possible view: the feature release may change acquisition as well as retention, so the team should examine both mechanisms.',
  },
  supplied_comparison: {
    agreement: 'Both example views treat customer response as unknown.',
    disagreement: 'They put different emphasis on retention and acquisition. Neither establishes which matters more.',
    evidence_next: 'Compare retention and acquisition by cohort, separating any price change from the feature release.',
  },
});

/** Projects only explicitly supplied words tied to one example input; it infers no agreement. */
export function projectSecondView(bundle, activeIdentity) {
  if (bundle?.kind !== 'illustrative_layout_only' ||
      typeof bundle.input_identity !== 'string' || !bundle.input_identity ||
      activeIdentity !== bundle.input_identity ||
      bundle.primary?.input_identity !== bundle.input_identity ||
      bundle.second?.input_identity !== bundle.input_identity ||
      typeof bundle.primary?.text !== 'string' || !bundle.primary.text.trim() ||
      typeof bundle.second?.text !== 'string' || !bundle.second.text.trim()) {
    return { state: 'withheld', primary: null, second: null, comparison: [] };
  }
  const labels = {
    agreement: 'Agreement',
    disagreement: 'Difference in emphasis',
    evidence_next: 'Evidence to examine next',
  };
  const comparison = Object.entries(labels).flatMap(([key, label]) => {
    const text = bundle.supplied_comparison?.[key];
    return typeof text === 'string' && text.trim() ? [{ label, text }] : [];
  });
  return { state: 'illustrative', primary: bundle.primary.text, second: bundle.second.text, comparison };
}

/** Reuses the Lab's article style and never contacts a provider or changes a model. */
export function mountSecondViewIllustration({ add }) {
  const root = document.getElementById('challenger-example');
  const toggle = document.getElementById('challenger-toggle');
  let activeIdentity = ILLUSTRATIVE_SECOND_VIEW.input_identity;
  function button(label, action) {
    const node = document.createElement('button');
    node.type = 'button'; node.textContent = label; node.onclick = action;
    root.append(node);
  }
  function render() {
    root.replaceChildren();
    add('assistant', 'ILLUSTRATIVE SECOND-VIEW LAYOUT\nThis is example wording written for the Lab. No independent model run, live comparison, probability or recommendation is claimed. It is separate from your current model.', root);
    const view = projectSecondView(ILLUSTRATIVE_SECOND_VIEW, activeIdentity);
    if (view.state === 'withheld') {
      add('assistant', 'The example model identity changed. Both earlier views and their comparison are withheld.', root);
      button('Restore example snapshot', () => { activeIdentity = ILLUSTRATIVE_SECOND_VIEW.input_identity; render(); });
      return;
    }
    add('assistant', 'FIRST EXAMPLE VIEW\n' + view.primary, root);
    add('assistant', 'SECOND EXAMPLE VIEW\n' + view.second, root);
    for (const row of view.comparison) add('assistant', row.label.toUpperCase() + '\n' + row.text, root);
    button('Simulate a change to this example', () => { activeIdentity = 'illustrative-pricing-model-v2'; render(); });
  }
  toggle.onclick = () => {
    root.hidden = !root.hidden;
    toggle.textContent = root.hidden ? 'Show illustrative second-view layout' : 'Hide illustrative second-view layout';
    if (!root.hidden) render();
  };
}
