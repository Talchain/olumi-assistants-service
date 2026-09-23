import { describe, it } from 'vitest';
import postgres from 'postgres';
import { writeFileSync } from 'node:fs';
import { buildCanonicalAnalysisReadyFromGraph } from '../orchestrator/tools/analysis-ready-helper.js';

const pw = encodeURIComponent('Olumi461699');
const sql = postgres(`postgresql://postgres.etmmuzwxtcjipwphdola:${pw}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`, { ssl: 'require', max: 1, idle_timeout: 0, max_lifetime: 0, connect_timeout: 20, prepare: false });

describe('RC acceptance-journey gap', () => {
  it('measures whether an all-factors-valued model reaches status=ready', async () => {
    let after = '00000000-0000-0000-0000-000000000000';
    let total = 0, ready = 0, admitNotReady = 0, neither = 0;
    let vTotal = 0, vReady = 0, vAdmitNotReady = 0, vNeither = 0;
    const blockers = new Map<string, number>();
    let batches = 0;
    for (;;) {
      // Keyset pagination by id — a STABLE order, never updated_at DESC, which is
      // how a 400-row sample once told me 27% when the population said 20.77%.
      const rows = await sql`
        SELECT id, graph FROM scenarios
        WHERE id > ${after}::uuid AND graph IS NOT NULL
        ORDER BY id ASC LIMIT 400`;
      if (rows.length === 0) break;
      if (batches % 5 === 0) {
        writeFileSync('/tmp/measure-partial.json', JSON.stringify({ batches, total, ready, admitNotReady, neither, vTotal, vReady, vAdmitNotReady, vNeither, blockers: [...blockers.entries()] }));
      }
      after = rows[rows.length - 1].id as string;
      batches += 1;
      for (const r of rows) {
        const g = r.graph as { nodes?: { kind?: string; observed_state?: { value?: unknown } }[] };
        if (!Array.isArray(g?.nodes) || g.nodes.length === 0) continue;
        let out: { status?: string; may_run?: boolean; blockers?: unknown[] } | undefined;
        try { out = buildCanonicalAnalysisReadyFromGraph(g as never) as never; } catch { continue; }
        if (out === undefined) continue;
        total += 1;
        const isReady = out.status === 'ready';
        const admits = out.may_run === true && !isReady;
        if (isReady) ready += 1; else if (admits) admitNotReady += 1; else neither += 1;
        const factors = g.nodes.filter((n) => n.kind === 'factor');
        if (factors.length > 0 && factors.every((n) => typeof n.observed_state?.value === 'number')) {
          vTotal += 1;
          if (isReady) vReady += 1; else if (admits) vAdmitNotReady += 1; else vNeither += 1;
          if (!isReady) for (const b of (out.blockers ?? []) as Record<string, unknown>[]) {
            const k = String(b?.code ?? b?.kind ?? b?.reason ?? JSON.stringify(b).slice(0, 50));
            blockers.set(k, (blockers.get(k) ?? 0) + 1);
          }
        }
      }
    }
    const pc = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(2) + '%' : 'n/a');
    console.log(`\n=== POPULATION (batches=${batches}) ===`);
    console.log(`total=${total} ready=${ready} (${pc(ready, total)}) admissible-not-ready=${admitNotReady} (${pc(admitNotReady, total)}) neither=${neither} (${pc(neither, total)})`);
    console.log(`\n=== RC JOURNEY STATE: every factor valued ===`);
    console.log(`valued_total=${vTotal} ready=${vReady} (${pc(vReady, vTotal)}) ADMISSIBLE-NOT-READY=${vAdmitNotReady} (${pc(vAdmitNotReady, vTotal)}) neither=${vNeither} (${pc(vNeither, vTotal)})`);
    console.table([...blockers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([code, n]) => ({ code, n })));
    await sql.end();
  }, 900000);
});
