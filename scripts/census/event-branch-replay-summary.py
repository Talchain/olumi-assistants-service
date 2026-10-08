#!/usr/bin/env python3
"""Compare the frozen event-branch census outputs. No source imports/provider calls."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2] / 'acceptance-evidence/event-branch'
base_rows = json.loads((root / 'replay-base/rows.json').read_text())
after_rows = json.loads((root / 'replay-after/rows.json').read_text())
base_summary = json.loads((root / 'replay-base/summary.json').read_text())
after_summary = json.loads((root / 'replay-after/summary.json').read_text())
base = {row['source']: row for row in base_rows}
after = {row['source']: row for row in after_rows}
if base.keys() != after.keys():
    raise SystemExit('The before/after corpus identities differ; do not publish a comparison.')
if any(base[source]['source_sha256'] != after[source]['source_sha256'] for source in base):
    raise SystemExit('A recorded source changed; do not publish a comparison.')
changed = [{
    'source': source,
    'chance_before': base[source]['withheld_chance'],
    'chance_after': after[source]['withheld_chance'],
    'graph_changed': base[source]['graph_sha256'] != after[source]['graph_sha256'],
} for source in base if base[source]['graph_sha256'] != after[source]['graph_sha256']]
summary = {
    'sources': len(base), 'source_hashes_identical': True,
    'graph_bytes_identical': sum(base[source]['graph_sha256'] == after[source]['graph_sha256'] for source in base),
    'chance_ready_gained': sum(base[source]['withheld_chance'] is True and after[source]['withheld_chance'] is False for source in base),
    'chance_ready_lost': sum(base[source]['withheld_chance'] is False and after[source]['withheld_chance'] is True for source in base),
    'before': base_summary, 'after': after_summary, 'changed_rows': changed,
}
# The initial baseline preceded adding the explicit converted/dropped counters. Its corpus has no
# probability factors, so both counts are exactly zero without another construction replay.
if base_summary['drafted_probability_factors'] == 0:
    summary['before'].setdefault('probability_factors_converted', 0)
    summary['before'].setdefault('probability_factors_dropped', 0)
(root / 'replay-comparison.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({key: value for key, value in summary.items() if key not in {'before', 'after', 'changed_rows'}}, indent=2))
