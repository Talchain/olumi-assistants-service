// Compare two labellers span-by-span (normalised). Output: agreed labels + a disagreement pack for a blind adjudicator.
const fs = require('fs'), path = require('path');
const A = JSON.parse(fs.readFileSync(path.join(__dirname, 'labels-A.json'), 'utf8')).labels;
const B = JSON.parse(fs.readFileSync(path.join(__dirname, 'labels-B.json'), 'utf8')).labels;
const input = JSON.parse(fs.readFileSync(path.join(__dirname, 'input.json'), 'utf8'));
const norm = (t) => t.replace(/\*\*/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[-‐-—]/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim().replace(/[.;,]$/, '');
const overlaps = (a, b) => { const x = norm(a), y = norm(b); return x.includes(y) || y.includes(x); };
const classOf = (L, span) => ['C1', 'C2', 'C3'].find((k) => L[k].some((s) => overlaps(s, span))) ?? 'none';
const agreed = {}, disputes = [];
for (const r of input.replies) {
  const a = A[r.id], b = B[r.id]; const spans = [...new Set([...a.C1, ...a.C2, ...a.C3, ...b.C1, ...b.C2, ...b.C3])];
  const out = { C1: [], C2: [], C3: [] }; const dis = [];
  for (const s of spans) {
    const ca = classOf(a, s), cb = classOf(b, s);
    if (ca === cb) { if (ca !== 'none' && !out[ca].some((x) => overlaps(x, s))) out[ca].push(s); }
    else if (!dis.some((d) => overlaps(d.span, s))) dis.push({ span: s, A: ca, B: cb });
  }
  agreed[r.id] = out; if (dis.length) disputes.push({ id: r.id, state: r.state, text: r.text, spans: dis.map((d) => ({ span: d.span, options: [d.A, d.B].sort() })) });
}
fs.writeFileSync(path.join(__dirname, 'agreed.json'), JSON.stringify({ labels: agreed }, null, 1));
fs.writeFileSync(path.join(__dirname, 'disputes.json'), JSON.stringify({ states: input.states, disputes }, null, 1));
console.log(`disputed replies ${disputes.length}; disputed spans ${disputes.reduce((n, d) => n + d.spans.length, 0)}`);
for (const d of disputes) for (const s of d.spans) console.log(`${d.id} :: ${s.options.join(' vs ')} :: ${s.span.slice(0, 120)}`);
