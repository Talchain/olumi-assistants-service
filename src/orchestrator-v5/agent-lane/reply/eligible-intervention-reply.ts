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
  // Run/Draft H/W/E/N belongs to the existing composer, byte for byte.
  if (faceContract) {
    if (whySaid) return composed;
    if (composed.shape === null) return { ...composed, text: `${composed.text}\n\n${disclosure}` };
    const shape = { ...composed.shape, detail: [composed.shape.detail, disclosure].filter(Boolean).join('\n\n') };
    return { ...composed, shape, text: deriveAnswerTextFromShape(shape) };
  }
  // Score run 3 (DL 12 Oct, R4): the answer stays where the composer put it, and only the Why sits below. The appender
  // once split a reply the composer shipped whole into its first line and "More detail" (deadline 2), and moved a face
  // bullet over eight words, the specific question, under it (deadline 8), while the action label took the face.
  const action = actionLabel === undefined
    || composed.text.split('\n').some(line => line.replace(/^\s*[-•*]\s+/, '').trim() === actionLabel) ? undefined : actionLabel;
  if (composed.shape === null) {
    // The composer shipped the reply whole (it is the face): every byte stays, then the action, then the Why.
    return { ...composed, text: [composed.text, action === undefined ? '' : `- ${action}`, disclosure].filter(Boolean).join('\n\n') };
  }
  const shape: AnswerShape = composed.shape;
  // The action joins the face only where it fits; otherwise it sits below, before the Why.
  const fits = action !== undefined && shape.bullets.length < 3 && words([shape.headline, ...shape.bullets, action].join(' ')) <= 80;
  const result = { ...shape, bullets: fits ? [...shape.bullets, action] : shape.bullets,
    detail: [shape.detail ?? '', !fits && action !== undefined ? `- ${action}` : '', disclosure].filter(Boolean).join('\n\n') };
  return { ...composed, text: deriveAnswerTextFromShape(result), shape: result, outcome: 'shaped' };
}
