# CODEX FIX BRIEF — PR #2681: fix EVERY finding in ./REVIEW-FINDINGS.md (independent HIGH review)
You CANNOT commit or run vitest: edit files only; the DL tests, commits and pushes. British English.
For EACH numbered finding: (1) first add a row to the PR's existing new test file that uses the review's concrete failing input and would FAIL on the current code; (2) make the smallest fix the finding names; (3) keep every existing row passing (do not weaken or re-pin an existing assertion; if one must change, say why in the summary).
Do not widen scope beyond the findings. Write FIX-SUMMARY.md: per finding, the row name, the fix, and file:line.
