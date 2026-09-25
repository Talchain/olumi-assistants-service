// Build the v6 fixture from adjudicated labels (argv[2]) + v5 states/texts + controls.
const fs = require('fs'), path = require('path');
const labels = JSON.parse(fs.readFileSync(path.resolve(__dirname, process.argv[2]), 'utf8')).labels;
const v5 = JSON.parse(fs.readFileSync('/private/tmp/aiq-wt-eval/src/orchestrator-v5/compose/__tests__/fixtures/leader-gate-multidomain.json', 'utf8'));
const hist = JSON.parse(fs.readFileSync(path.join(__dirname, 'v5-labels-historical.json'), 'utf8'));
const controls = JSON.parse(fs.readFileSync(path.join(__dirname, 'controls.json'), 'utf8'));
const replies = v5.replies.map((r) => { const l = labels[r.id]; if (!l) throw new Error('no label for ' + r.id); return { id: r.id, state: r.state, text: r.text, C1: l.C1, C2: l.C2, C3: l.C3, v5_label: hist[r.id].label }; });
const out = process.argv[3] || '/private/tmp/aiq-wt-eval/src/orchestrator-v5/compose/__tests__/fixtures/leader-gate-v6.json';
fs.writeFileSync(out, JSON.stringify({ policy: 'programme-docs #63 5824816357', states: v5.states, replies, controls }, null, 1));
const n = (k) => replies.filter((r) => r[k].length).length;
console.log(`replies ${replies.length}: C1 ${n('C1')} C2 ${n('C2')} C3 ${n('C3')} none ${replies.filter((r) => !r.C1.length && !r.C2.length && !r.C3.length).length}; controls ${controls.length}; v5 names_leader now C1: ${replies.filter((r) => r.v5_label === 'names_leader' && r.C1.length).length}/20`);
