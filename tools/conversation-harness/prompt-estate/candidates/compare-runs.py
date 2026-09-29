#!/usr/bin/env python3
"""Join two arm score files into a side-by-side comparison table (markdown).
Usage: compare-runs.py <runs/armA-dir> <runs/armB-dir> > comparison.md
Semantic verdicts (honest scoping, claim typing, certification) are made by the
lead reading the texts; this emits the mechanical metrics plus text excerpts.
"""
import json, sys, pathlib

a_dir, b_dir = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
A = {r["turn"]: r for r in json.loads((a_dir / "scores.json").read_text())}
B = {r["turn"]: r for r in json.loads((b_dir / "scores.json").read_text())}
turns = sorted(set(A) | set(B))

def f(r, k, d="—"):
    v = r.get(k) if r else None
    return d if v is None else v

print(f"# A/B comparison — {a_dir.name} vs {b_dir.name}\n")
print("| Turn | exit A→B | LLM A→B | words A→B | bullets A→B | bold A→B | ¶ A→B | ? A→B | labels A→B | guards A→B | chips A→B |")
print("|---|---|---|---|---|---|---|---|---|---|---|")
for t in turns:
    a, b = A.get(t), B.get(t)
    def g(r):
        if not r: return "—"
        hits = []
        if r.get("forbidden_hit"): hits.append(f"egress:{r['forbidden_hit']}")
        if r.get("mutation_language"): hits.append("mut")
        if r.get("structural_success_claim"): hits.append("struct")
        return ",".join(hits) or "clean"
    llm = lambda r: ("Y" if r and r.get("llm_roles") else "no") if r else "—"
    print(f"| {t} | {f(a,'exit_path')}→{f(b,'exit_path')} | {llm(a)}→{llm(b)} | {f(a,'words')}→{f(b,'words')} "
          f"| {f(a,'bullets')}→{f(b,'bullets')} | {f(a,'bold_spans')}→{f(b,'bold_spans')} | {f(a,'paragraphs')}→{f(b,'paragraphs')} "
          f"| {f(a,'questions')}→{f(b,'questions')} | {len(a['labels_named']) if a else '—'}→{len(b['labels_named']) if b else '—'} "
          f"| {g(a)}→{g(b)} | {f(a,'chip_count')}→{f(b,'chip_count')} |")

# aggregates over LLM-answer turns
def agg(S, label):
    llm_rows = [r for r in S.values() if r.get("llm_roles") and r.get("words", 0) > 0]
    n = len(llm_rows)
    if not n: return
    print(f"\n**{label}** — LLM turns: {n}; avg words {sum(r['words'] for r in llm_rows)/n:.0f}; "
          f"guard hits {sum(1 for r in llm_rows if r.get('forbidden_hit') or r.get('mutation_language') or r.get('structural_success_claim'))}; "
          f"generic markers {sum(1 for r in llm_rows if r.get('generic_marker'))}; "
          f"avg labels {sum(len(r['labels_named']) for r in llm_rows)/n:.1f}")
agg(A, a_dir.name); agg(B, b_dir.name)

print("\n## Key texts (probe + explanation turns)\n")
for t in ["T07", "T09", "T13", "T17", "T19", "T20", "P21", "P22", "P23", "P24", "P25"]:
    for name, S in ((a_dir.name, A), (b_dir.name, B)):
        r = S.get(t)
        if r and r.get("text"):
            print(f"### {t} — {name} ({r.get('words')}w, exit={r.get('exit_path')})\n")
            print("> " + r["text"].replace("\n", "\n> ") + "\n")
