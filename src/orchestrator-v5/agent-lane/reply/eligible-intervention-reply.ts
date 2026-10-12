import { deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import type { ReplyComposition } from './compose-reply.js';

const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * Coaching retains RC's selected action. ⭐ Technique (c) (AIE 6130197656 §3, DL 12 Oct): the policy's "Why?" is never
 * attached to a reply. It stays with the guidance row (its own why, and its science basis as the row's detail:
 * `guidance.slot1.science`), and an ordinary reply answers the user's ask. Served run 4: hiring 2 asked whether faint
 * connections were a UI or a data issue and was told "Why? Assumption-based planning: …"; hiring 15 repeated the row's
 * own visible why. The model's context still names the method, so a user who asks about it gets it explained.
 */
export function withInterventionAction(composed: ReplyComposition, actionLabel: string | undefined): ReplyComposition {
  // Score run 3 (DL 12 Oct, R4): the answer stays where the composer put it. The appender once split a reply the composer
  // shipped whole into its first line and "More detail" (deadline 2), and moved a face bullet over eight words, the
  // specific question, under it (deadline 8), while the action label took the face.
  const action = actionLabel === undefined
    || composed.text.split('\n').some(line => line.replace(/^\s*[-•*]\s+/, '').trim() === actionLabel) ? undefined : actionLabel;
  if (action === undefined) return composed;
  // The composer shipped the reply whole (it is the face): every byte stays, then the action.
  if (composed.shape === null) return { ...composed, text: `${composed.text}\n\n- ${action}` };
  const shape: AnswerShape = composed.shape;
  // The action joins the face only where it fits; otherwise it sits below.
  const fits = shape.bullets.length < 3 && words([shape.headline, ...shape.bullets, action].join(' ')) <= 80;
  const result = { ...shape, bullets: fits ? [...shape.bullets, action] : shape.bullets,
    detail: [shape.detail ?? '', fits ? '' : `- ${action}`].filter(Boolean).join('\n\n') };
  return { ...composed, text: deriveAnswerTextFromShape(result), shape: result, outcome: 'shaped' };
}
