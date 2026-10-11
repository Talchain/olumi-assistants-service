// Shrink-only: remove migrated sites and lower the ceiling together. Never add or rename to admit a bypass.
export const BASELINE = 0;
export const BYPASS_EXEMPTIONS = Object.freeze([]);

export function requireOnlyExemptedWrites(census) {
  const allowance = new Map(BYPASS_EXEMPTIONS.map(key => [key, 1]));
  for (const site of census.sites.filter(s => s.kind !== 'door_caller')) {
    const key = `${site.file}:${site.callee}`;
    const remaining = allowance.get(key) ?? 0;
    if (!remaining) throw new Error(`Unexempted graph write: ${key} (line ${site.line})`);
    allowance.set(key, remaining - 1);
  }
  const stale = [...allowance].filter(([, count]) => count > 0).map(([key]) => key);
  if (stale.length) throw new Error(`Remove migrated graph-write exemptions: ${stale.join(', ')}`);
  if (census.outside_door !== BASELINE) throw new Error(`Lower baseline to ${census.outside_door}`);
}
