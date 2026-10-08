# Recorded-draft replay

The corpus follows [CEE #2842](https://github.com/Talchain/olumi-assistants-service/pull/2842)'s reported census: 116 recorded drafts (6 Oct lab 80, 8 Oct labs 36). Its metadata was read through the connected GitHub tool during this execution. The PR body reports older staging `7835e81e` against its own head; those counts are historical, not this branch's baseline.

The 80 valid 6 Oct recordings are baseline-terra-low, sol-6.1-low and astra-6-low (20 each), armB-v2 and armC-v2 (4 each), and armC-v2-confirm (12). The two VOID directories are excluded. The 36 valid 8 Oct recordings are both two-risk arms (9 each), the mechanism arm (9), and rerun-2842 (9).

`replay.test.ts` feeds each recording's responses, in order, through the real `buildModelFromBrief` and uses the original harness's fake registration dispatch. The original brief is recovered from the first recorded request input, before construction notes, and checked against its preserved SHA-256. Source content hashes and registered graph hashes are retained per row. A newly requested retry would repeat the last recorded response and be counted explicitly; none occurred on the baseline. There are no provider calls, network requests, or database writes.

The immutable baseline is `git archive HEAD` at `926e1c96637b595ca6914c59564f66e5cbc39814`, extracted to `/private/tmp/event-branch-base`, with only the dependency symlink and this evidence harness added. The working tree's production changes cannot alter that snapshot.

The metric named `withheld_chance` is CEE's `chancesWithheldByAGuess` predicate on the graph that construction registers. It is not a served PLoT/ISL Run or a user journey witness. Every admitted graph is retained for comparison.

All 116 recordings have no drafted `occurrence`, and none draft a qualifying probability/likelihood/chance suffix factor. Therefore this corpus cannot measure a conversion yield; zero conversions are expected. The named hedge and explicit-likelihood shapes are separate deterministic acceptance rows. The two live pilot draws measure whether the new instruction produces occurrences.

Before every test invocation: exact `node -e "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)"` load gate; one test file, one worker, `--configLoader=runner`, stdin `/dev/null`.
