/**
 * The evidence pack.
 *
 * PROTOCOL.md rule 9: "Route evidence to a FILE, not through a summary.
 * Content routed through a model's context has been observed silently
 * corrupted where the same content written to a file hashed identically." So
 * the file is the artefact and stdout is a pointer to it.
 *
 * THE HEADLINE NEVER SAYS "PASS" FOR THE RUN unless all six criteria are PASS.
 * It leads with `FAILED n · NOT ASSESSED n · PASSED n` because a reader who
 * sees only an exit code will otherwise read 0 as "the fixture passed", and on
 * the wire alone it almost never can.
 */

import type { HarnessOutcome, Verdict } from './types.js';
import { blockTypesPresent } from './payload-scan.js';

function mark(v: Verdict): string {
  return v === 'PASS' ? '🟢 PASS' : v === 'FAIL' ? '🔴 FAIL' : '⚪ NOT ASSESSED';
}

export interface Tally {
  readonly pass: number;
  readonly fail: number;
  readonly notAssessed: number;
}

export function tally(outcome: HarnessOutcome): Tally {
  let pass = 0;
  let fail = 0;
  let notAssessed = 0;
  for (const c of outcome.criteria) {
    if (c.verdict === 'PASS') pass += 1;
    else if (c.verdict === 'FAIL') fail += 1;
    else notAssessed += 1;
  }
  return { pass, fail, notAssessed };
}

export function headline(outcome: HarnessOutcome): string {
  const t = tally(outcome);
  return `FAILED ${t.fail} · NOT ASSESSED ${t.notAssessed} · PASSED ${t.pass} (of 6 deterministic criteria)`;
}

export function renderReport(outcome: HarnessOutcome): string {
  const { context, criteria, measurements, caveats, turns } = outcome;
  const t = tally(outcome);
  const L: string[] = [];

  L.push('# Founder fixture — section A acceptance run');
  L.push('');
  L.push(`**${headline(outcome)}**`);
  L.push('');
  if (t.fail === 0 && t.notAssessed > 0) {
    L.push(
      '> ⚠ Nothing FAILED, and that is not the same as the fixture passing. ' +
        `${t.notAssessed} of 6 criteria were NOT ASSESSED. A criterion carrying a limb the wire cannot ` +
        'decide can be refuted here and never certified here.',
    );
    L.push('');
  }

  // ---- context -----------------------------------------------------------
  L.push('## What this run ran against');
  L.push('');
  L.push('| | |');
  L.push('|---|---|');
  L.push(`| started | ${context.startedAt} |`);
  L.push(`| mode | ${context.mode} |`);
  L.push(`| state class | **${context.stateClass}** |`);
  L.push(
    context.mode === 'replay'
      ? // In replay the brief was never read or sent, so printing a byte count
        // beside it would suggest an assertion that did not happen.
        `| brief | \`${context.briefPath}\` · sha256 DECLARED BY THE FIXTURE: \`${context.briefSha256}\` — the brief itself was not read or sent |`
      : `| brief | \`${context.briefPath}\` · ${context.briefBytes} bytes · sha256 \`${context.briefSha256}\` — asserted against its sidecar AND against the serialised request body |`,
  );
  L.push(`| CEE base | ${context.ceeBaseUrl} |`);
  L.push(`| Origin sent | ${context.origin} |`);
  L.push(`| scenario id | \`${context.scenarioId}\` |`);
  L.push('');
  L.push('### Deployed builds, derived at run time');
  L.push('');
  L.push('| service | SHA | derived from |');
  L.push('|---|---|---|');
  for (const b of context.builds) {
    L.push(`| ${b.service} | ${b.sha ?? '**could not establish**'} | ${b.derivedFrom}${b.note ? ` — ${b.note}` : ''} |`);
  }
  L.push('');
  L.push(`**Turn 11 semantics.** ${context.reload_semantics}`);
  L.push('');

  // ---- instruments -------------------------------------------------------
  L.push('### Instruments, and the controls that prove they can see');
  L.push('');
  L.push(
    'An absence claim from a blind instrument is a confident zero. Each detector is run on a case it ' +
      'MUST flag and a case it MUST NOT before its verdict is believed.',
  );
  L.push('');
  L.push('| detector | positive control | negative control | usable | source |');
  L.push('|---|---|---|---|---|');
  for (const d of context.detectors) {
    L.push(
      `| ${d.id} | ${d.positiveControl} | ${d.negativeControl} | ${d.available ? 'yes' : '**NO**'} | ${d.source} |`,
    );
  }
  L.push('');
  for (const d of context.detectors) {
    if (d.reason) L.push(`- \`${d.id}\`: ${d.reason}`);
  }
  L.push('');

  // ---- criteria ----------------------------------------------------------
  L.push('## Section A — the six deterministic criteria');
  L.push('');
  L.push('| | criterion | verdict |');
  L.push('|---|---|---|');
  for (const c of criteria) {
    L.push(`| ${c.id} | ${c.claim.slice(0, 110)}${c.claim.length > 110 ? '…' : ''} | ${mark(c.verdict)} |`);
  }
  L.push('');
  L.push(
    'Composition rule: **any limb FAIL ⇒ criterion FAIL · every limb PASS ⇒ criterion PASS · otherwise ' +
      'NOT ASSESSED.** A criterion with a permanently-undecidable limb therefore never reads PASS from ' +
      'the wire. That is the honest statement of what a wire harness is.',
  );
  L.push('');

  for (const c of criteria) {
    L.push(`### ${c.id} — ${mark(c.verdict)}`);
    L.push('');
    L.push(`> ${c.claim}`);
    L.push('');
    for (const l of c.limbs) {
      L.push(`#### \`${l.id}\` — ${mark(l.verdict)} _(${l.decidability})_`);
      L.push('');
      L.push(`*${l.question}*`);
      L.push('');
      for (const e of l.evidence) L.push(`- ${e}`);
      if (l.evidence.length === 0) L.push('- _(no evidence recorded — treat this as a defect in the harness, not a pass)_');
      L.push('');
    }
  }

  // ---- measurements ------------------------------------------------------
  L.push('## Recorded, never decided');
  L.push('');
  L.push(
    'Turns 8 and 9 are MEASUREMENT ONLY per SCRIPT.md and cannot fail the run. Section B quantities are ' +
      'SINGLE-DRAW OBSERVATIONS: ACCEPTANCE.md requires n ≥ 5 fresh runs on the unchanged corpus before ' +
      'any of them is read as a rate.',
  );
  L.push('');
  for (const m of measurements) {
    L.push(`### \`${m.id}\``);
    L.push('');
    L.push(`**${m.what}**`);
    L.push('');
    L.push(`- observed: ${m.value}`);
    L.push(`- why this is not a verdict: ${m.why_not_decided}`);
    L.push('');
  }

  // ---- caveats -----------------------------------------------------------
  L.push('## Everything this run could not decide');
  L.push('');
  if (caveats.length === 0) {
    L.push('_(none recorded — which for a wire harness would itself be surprising; check the limbs.)_');
  } else {
    for (const c of caveats) L.push(`- ${c}`);
  }
  L.push('');

  // ---- turn log ----------------------------------------------------------
  L.push('## Turn log');
  L.push('');
  L.push('| # | probes | HTTP | ms | blocks | sent sha256 |');
  L.push('|---|---|---|---|---|---|');
  for (const turn of turns) {
    const blocks = turn.body ? blockTypesPresent(turn.body).join(', ') : '';
    L.push(
      `| ${turn.index} | ${turn.probes} | ${turn.transportError ? `**${turn.transportError}**` : turn.httpStatus} | ` +
        `${turn.elapsedMs} | ${blocks} | \`${turn.sent.sha256.slice(0, 12)}…\` |`,
    );
  }
  L.push('');
  L.push(
    '_Turn 0 is the brief. Its sha256 is asserted against the fixture sidecar BEFORE the send and ' +
      'against the serialised request body AFTER it, so a truncated or altered brief cannot pass ' +
      'unnoticed (PROTOCOL.md rule 3)._',
  );
  L.push('');

  return `${L.join('\n')}\n`;
}
