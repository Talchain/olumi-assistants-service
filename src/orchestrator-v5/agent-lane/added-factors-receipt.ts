/**
 * ⭐ ONE ASK, NOT ONE PER FACTOR (Paul, 27 Sep: "premium, intuitive"; served receipt f658d106/4bdf7b2: two added factors
 * made a ~250-word receipt that said "Its current value is not set yet; tell me what it is today and I'll record it."
 * twice). Each added factor is still named with what it changes and whose strength its links carry (audit MAG-2); the
 * ask for today's value is said once, naming every factor. Labels are quoted: they are the user's data.
 */
export interface AddedFactorPart {
  readonly label: string;
  /** Quoted labels of what the factor changes. */
  readonly changes: readonly string[];
  /** `howStronglyWords` for the factor's own committed links. */
  readonly strength: string;
}

const andList = (xs: readonly string[]): string =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

export function addedFactorsReceipt(parts: readonly AddedFactorPart[]): string[] {
  if (parts.length === 0) return [];
  if (parts.length === 1) {
    const p = parts[0]!;
    return [`Also added the factor "${p.label}", which changes ${p.changes.join(', ')}; ${p.strength} Tell me its value today and I'll record it.`];
  }
  const sameStrength = parts.every((p) => p.strength === parts[0]!.strength);
  const out = sameStrength
    ? [`Also added the factors ${andList(parts.map((p) => `"${p.label}" (changes ${p.changes.join(', ')})`))}; ${parts[0]!.strength}`]
    : parts.map((p) => `Also added the factor "${p.label}", which changes ${p.changes.join(', ')}; ${p.strength}`);
  out.push(`Tell me today's value for ${andList(parts.map((p) => `"${p.label}"`))} and I'll record them.`);
  return out;
}
