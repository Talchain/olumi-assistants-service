import { deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import type { EligibleIntervention } from '../turn-context/guidance-wire.js';
import type { ReplyComposition } from './compose-reply.js';

export const INTERVENTION_WHY_LABEL = 'Why?';
const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/** Append Science's exact disclosure; coaching also retains RC's selected action. */
export function composeEligibleIntervention(composed: ReplyComposition, intervention: EligibleIntervention,
  actionLabel: string | undefined, faceContract: boolean, wholeProposal = false): ReplyComposition {
  const disclosure = `<details>\n<summary>${INTERVENTION_WHY_LABEL}</summary>\n\n${intervention.why}\n\n</details>`;
  // Proposal disclosures and approval questions retain every byte; only the carried suffix is new.
  if (wholeProposal) {
    return { ...composed, text: `${composed.text}\n\n${disclosure}` };
  }
  // Run/Draft H/W/E/N belongs to the existing composer, byte for byte.
  if (faceContract) {
    if (composed.shape === null) return { ...composed, text: `${composed.text}\n\n${disclosure}` };
    const shape = { ...composed.shape, detail: [composed.shape.detail, disclosure].filter(Boolean).join('\n\n') };
    return { ...composed, shape, text: deriveAnswerTextFromShape(shape) };
  }
  const lines = composed.text.split('\n');
  const first = lines.findIndex(line => line.trim() !== '');
  const shape: AnswerShape = composed.shape ?? { headline: lines[first] ?? composed.text, bullets: [],
    detail: lines.slice(first + 1).join('\n').trim() };
  if (words(shape.headline) > 80 && actionLabel !== undefined) {
    const result = { headline: actionLabel, bullets: [], detail: [composed.text, disclosure].join('\n\n') };
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
