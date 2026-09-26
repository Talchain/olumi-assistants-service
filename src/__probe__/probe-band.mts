import { bandTheUserWrote } from '/private/tmp/cee-rt-rt-linkband/src/orchestrator-v5/agent-lane/stated-by-user.ts';
const rows: [string, string][] = [
  ['Our retention is strong. Connect price to churn.', 'strong'],
  ['We have a strong brand, so add a link from price to churn.', 'strong'],
  ['Marketing strongly drives signups; also connect price to churn.', 'strong'],
  ['I don’t know how strong it is, just add price to churn.', 'strong'],
  ['Should price drive churn strongly?', 'strong'],
  ['Add price to churn, you decide how strong', 'strong'],
  ['Connect price to churn. Moderate or strong, you pick.', 'moderate'],
  ['Connect price to churn. Moderate or strong, you pick.', 'strong'],
  ['Connect price to churn - I have no idea whether it is weak or strong.', 'weak'],
];
for (const [t, b] of rows) console.log(JSON.stringify({ text: t, band: b, grounds: bandTheUserWrote(b, t) }));
