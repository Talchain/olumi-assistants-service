import { deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import type { EligibleIntervention } from '../turn-context/guidance-wire.js';
import type { ReplyComposition } from './compose-reply.js';

export const INTERVENTION_WHY_LABEL = 'Why?';
const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * Append Science's exact disclosure; coaching also retains RC's selected action. E6 Why-once: when the policy's Why? was
 * already said on this state (`whySaid`), the action is still carried and only the repeated disclosure is left out.
 */
export function composeEligibleIntervention(composed: ReplyComposition, intervention: EligibleIntervention,
  actionLabel: string | undefined, faceContract: boolean, wholeProposal = false, whySaid = false): ReplyComposition {
  // R2 N2r (friction audit N2): a whole proposal ships unshaped, so a <details> suffix reached the user as raw markup
  // ("<details> <summary>Why?</summary>…", hiring step 5, deadline step 3). It keeps every byte and carries no Why.
  if (wholeProposal) return composed;
  // R3-1: the UI escapes HTML, so "<details>…" reached the user as tags (run 2: hiring 10–14, marketing 2–6). The same
  // label and Science's words, byte for byte, ship as a plain final paragraph the chat renders.
  const disclosure = whySaid ? '' : `${INTERVENTION_WHY_LABEL} ${intervention.why}`;
  // AI-first N1: the AI's answer ships whole, and Science's disclosure follows it as a plain paragraph. Reply-face P1 (served UI
  // witness 23:07Z: "…\n\nSuggest drivers\n\nWhy? …"): the action label is a BUTTON'S words (`guidance.slot1.primary_action`), not
  // text the user reads, so it is never joined into the AI's answer.
  if (composed.reason === 'ai_answer') {
    return { ...composed, text: [composed.text, disclosure].filter(Boolean).join('\n\n') };
  }
  // Run/Draft H/W/E/N belongs to the existing composer, byte for byte.
  if (faceContract) {
    if (whySaid) return composed;
    if (composed.shape === null) return { ...composed, text: `${composed.text}\n\n${disclosure}` };
    const shape = { ...composed.shape, detail: [composed.shape.detail, disclosure].filter(Boolean).join('\n\n') };
    return { ...composed, shape, text: deriveAnswerTextFromShape(shape) };
  }
  const lines = composed.text.split('\n');
  const first = lines.findIndex(line => line.trim() !== '');
  const shape: AnswerShape = composed.shape ?? { headline: lines[first] ?? composed.text, bullets: [],
    detail: lines.slice(first + 1).join('\n').trim() };
  if (words(shape.headline) > 80 && actionLabel !== undefined) {
    const result = { headline: actionLabel, bullets: [], detail: whySaid ? composed.text : [composed.text, disclosure].join('\n\n') };
    return { ...composed, text: deriveAnswerTextFromShape(result), shape: result, outcome: 'shaped' };
  }
  const bullets = [...(shape.bullets ?? [])];
  const detail = [shape.detail ?? ''];
  // Retain every original line; long next moves and overflow remain whole in detail.
  if (actionLabel !== undefined && !bullets.includes(actionLabel)) bullets.push(actionLabel);
  const face: string[] = [];
  let budget = words(shape.headline);
  for (const bullet of bullets) {
    if ((words(bullet) <= 8 || bullet === actionLabel) && face.length < 3 && budget + words(bullet) <= 80) {
      face.push(bullet); budget += words(bullet);
    } else detail.push(`- ${bullet}`);
  }
  const result = { ...shape, bullets: face, detail: [...detail, disclosure].filter(Boolean).join('\n\n') };
  return { ...composed, text: deriveAnswerTextFromShape(result), shape: result, outcome: 'shaped' };
}
