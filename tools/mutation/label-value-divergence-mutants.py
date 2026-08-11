#!/usr/bin/env python3
"""Mutation harness for the label-value-divergence ADD-ONLY leg.

Discipline enforced here, not assumed:
  · every mutant is APPLIED-CHECKED (file content must actually change, and
    exactly one file under src/ must differ) — an unapplied mutation is
    indistinguishable from an equivalent one (CLAUDE.md trap 22d);
  · every mutant declares its AIM in advance: tests that MUST go RED and
    tests that MUST stay GREEN. A mutant that reddens everything proves
    sensitivity, not binding (trap 19's discriminating pair);
  · a mutant that fails by THROWING proves nothing, so ReferenceError /
    SyntaxError / "Cannot read properties" in the run voids that mutant;
  · restores read from a pristine ARCHIVE outside both trees, never from the
    other copy and never via `git checkout -- <path>` (trap 9h).
"""
import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path

# Paths come from the environment so this harness is runnable against any
# clone. WT must be a throwaway worktree OUTSIDE the repo root, and ARCHIVE a
# pristine copy OUTSIDE both trees (a restore that reads the other copy
# re-pollutes silently — CLAUDE.md trap 9g/9h).
WT = Path(os.environ.get("MUT_WT", "/private/tmp/lane-inv7fix-b3d7-mut/wt"))
ARCHIVE = Path(os.environ.get(
    "MUT_ARCHIVE",
    "/private/tmp/lane-inv7fix-b3d7-mut/archive/label-value-divergence.ts.pristine"))
TARGET = WT / "src/orchestrator-v5/label-value-divergence.ts"

SPECS = [
    "src/orchestrator-v5/__tests__/label-value-divergence-added-quantity.test.ts",
    "src/orchestrator-v5/__tests__/label-value-divergence.test.ts",
    "tests/unit/orchestrator/tools/edit-graph-label-value-divergence.test.ts",
]

# (id, description, old, new, must_red[], must_stay_green[])
MUTANTS = [
    ("M1", "revert LEG 2 entirely (restore the add-only exclusion)",
     "if (newOnly.length === 0) return null;",
     "if (oldOnly.length === 0 || newOnly.length === 0) return null;",
     ["flags the captured label-only rename",
      "names the ADDED token as new",
      "produces the honest disclosure note",
      "DOES fire on an option whose single intervention magnitude is DENOMINATED",
      "the SERVED assistant text discloses",
      "the receipt cannot read as a completed value change"],
     ["still fires, and still names the OLD LABEL token",
      "discloses the divergence instead of claiming a bare success"]),

    ("M2", "drop the magnitude-agreement check (sources may disagree)",
     "  if (candidates.some((c) => c.magnitude.key !== agreedKey)) return null;",
     "",
     ["stays silent when the node’s own magnitude sources DISAGREE"],
     ["flags the captured label-only rename",
      "still fires, and still names the OLD LABEL token"]),

    ("M3", "drop the AGREES short-circuit (fire even when the label is right)",
     "    if (modelled.key === newOnly[0]!.key) return null; // the label AGREES — no harm",
     "",
     ["does not fire when the added token equals the modelled magnitude",
      "does not fire on a FORMATTING-equivalent agreement"],
     ["flags the captured label-only rename",
      "still fires, and still names the OLD LABEL token"]),

    ("M4", "admit the NORMALISED observed_state.value as a magnitude",
     "  const topLevelRaw = finiteNum(node.raw_value);",
     "  if (isPlainObject(obs)) { const nv = finiteNum(obs.value); if (nv !== undefined) push(nv, obs.unit); }\n  const topLevelRaw = finiteNum(node.raw_value);",
     ["flags the captured label-only rename",
      "the SERVED assistant text discloses"],
     ["still fires, and still names the OLD LABEL token"]),

    ("M5", "relax the single-added-token rule",
     "    if (newOnly.length !== 1) return null;",
     "    if (newOnly.length === 0) return null;",
     ["KNOWN-DROPPED — an added label carrying SEVERAL quantities"],
     ["flags the captured label-only rename",
      "still fires, and still names the OLD LABEL token"]),

    ("M6", "prefer raw_value formatting over the rendered display_value",
     "  const magnitude = (rendered ?? candidates[0]!).magnitude;",
     "  const magnitude = candidates[0]!.magnitude;",
     ["names the ADDED token as new",
      "the SERVED assistant text discloses"],
     ["flags the captured label-only rename",
      "still fires, and still names the OLD LABEL token"]),

    ("M7", "LEG 1 uses the node magnitude instead of the old LABEL token",
     "    oldValueToken = oldOnly[0]!.raw;",
     "    oldValueToken = modelledMagnitudeOf(node)?.display ?? oldOnly[0]!.raw;",
     ["still fires, and still names the OLD LABEL token"],
     ["flags the captured label-only rename",
      "names the ADDED token as new"]),

    ("M8", "drop interventions as a magnitude source",
     "      const raw = finiteNum(iv.raw_value);",
     "      const raw = undefined as number | undefined;",
     ["DOES fire on an option whose single intervention magnitude is DENOMINATED"],
     ["flags the captured label-only rename",
      "stays silent on an option whose interventions carry AMBIGUOUS",
      "still fires, and still names the OLD LABEL token"]),

    ("M9", "IDENTITY: read the magnitude off the wrong node",
     "  const node = preNode ?? nodeById(postGraph, op.path);",
     "  const node = nodesOf(preGraph)[0] ?? preNode ?? nodeById(postGraph, op.path);",
     ["flags the captured label-only rename",
      "the SERVED assistant text discloses"],
     ["stays silent on a pure rename that adds no quantity at all"]),

    ("N1", "P1-1/P1-2 root cause: key the magnitude off the BARE NUMBER again",
     "    const key = tokenKey(display);",
     "    const key = tokenKey(String(value));",
     ["P1-1 — an AGREEING percent label is silent",
      "P1-2 — a percent node WITH an agreeing display_value"],
     ["flags the captured label-only rename",
      "still fires, and still names the OLD LABEL token"]),

    ("N2", "P2-1: drop the SEMANTIC denomination requirement on the magnitude",
     "  return magnitude.unit === 'none' ? null : magnitude;",
     "  return magnitude;",
     # NB the neighbouring KNOWN-DROPPED undenominated-intervention case is
     # pinned by UNIT AGREEMENT, not by this rule (defence in depth), so it is
     # deliberately not aimed at here. The bare-vs-bare case below is the shape
     # only the semantic rule can catch.
     ["stays silent on the captured node whose score reaches display_value",
      "a BARE number against a BARE magnitude is not a value claim either"],
     ["flags the captured label-only rename"]),

    ("N3", "P1-3: drop unit agreement, so any added digit fires again",
     "    if (addedUnit !== modelled.unit) return null;",
     "",
     ["stays silent on a fiscal-year suffix",
      "stays silent on a phase annotation",
      "stays silent on a count in prose"],
     ["flags the captured label-only rename",
      "CONTRAST CONTROL — the same node still fires on a DENOMINATED figure"]),
]

# A mutant that fails by breaking the MODULE proves nothing — it never
# exercised the predicate. But a mutant that makes a test fail by dereferencing
# an empty result HAS killed that test legitimately: the behaviour was
# suppressed, which is exactly what the mutant was aimed at.
#
# The discriminator is COLLECTION, not the word "Error": a ReferenceError or
# SyntaxError at import collapses the collected count, while a per-test
# assertion or dereference leaves it intact. So we void on the import-level
# markers AND on any drift in the collected total (asserted against the
# pristine control), and we do not void on in-test dereferences.
THROW_MARKERS = ("ReferenceError", "SyntaxError", "is not defined", "Failed to load")


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def restore() -> None:
    TARGET.write_bytes(ARCHIVE.read_bytes())


def dirty_src_files() -> list[str]:
    out = subprocess.run(
        ["git", "-C", str(WT), "status", "--porcelain", "--", "src/", "tests/"],
        capture_output=True, text=True, check=True).stdout
    return [l[3:] for l in out.splitlines() if l.strip()]


def run_specs() -> tuple[str, int]:
    r = subprocess.run(["npx", "vitest", "run", *SPECS, "--reporter=verbose"],
                       cwd=WT, capture_output=True, text=True)
    return r.stdout + r.stderr, r.returncode


def collected_total(output: str) -> int:
    """passed + failed, i.e. how many tests actually RAN."""
    total = 0
    for m in re.finditer(r"Tests\s+(.*)$", output, re.M):
        seg = m.group(1)
        for n, _kind in re.findall(r"(\d+)\s+(passed|failed)", seg):
            total += int(n)
        if total:
            break
    return total


def failed_names(output: str) -> set[str]:
    names = set()
    for line in output.splitlines():
        m = re.match(r"\s*[×x]\s+(.*?)(?:\s+\d+ms)?$", line)
        if m and ">" in m.group(1):
            names.add(m.group(1).strip())
    return names


def matches(names: set[str], needle: str) -> bool:
    return any(needle in n for n in names)


def main() -> int:
    restore()
    assert sha(TARGET) == sha(ARCHIVE), "restore failed before we started"

    # CONTROL: pristine tree must be clean under src/ and tests/ and fully green.
    control_dirty = dirty_src_files()
    print(f"CONTROL applied-check (must be exactly 0): {len(control_dirty)} {control_dirty}")
    if len(control_dirty) != 0:
        print("FATAL: pristine tree is not clean; every applied-check below would be offset")
        return 1
    out, rc = run_specs()
    ctrl_fail = failed_names(out)
    print(f"CONTROL run: rc={rc} failures={len(ctrl_fail)}")
    if ctrl_fail:
        print("FATAL: pristine run is not green:", ctrl_fail)
        return 1
    control_total = collected_total(out)
    print(f"CONTROL collected: {control_total} tests ran")
    if control_total == 0:
        print("FATAL: control collected ZERO tests — the instrument is blind")
        return 1

    rows = []
    ok = True
    for mid, desc, old, new, must_red, must_green in MUTANTS:
        restore()
        text = TARGET.read_text()
        if old not in text:
            print(f"{mid}: FATAL — anchor not found, mutation NOT APPLIED (false survivor)")
            rows.append((mid, desc, "ANCHOR-MISSING", "", "", "VOID"))
            ok = False
            continue
        TARGET.write_text(text.replace(old, new, 1))

        # APPLIED-CHECK, scoped to src/ + tests/.
        if sha(TARGET) == sha(ARCHIVE):
            print(f"{mid}: FATAL — file unchanged after replace (false survivor)")
            rows.append((mid, desc, "NOT-APPLIED", "", "", "VOID"))
            ok = False
            continue
        dirty = dirty_src_files()
        if len(dirty) != 1:
            print(f"{mid}: FATAL — applied-check expected exactly 1 dirty file, got {len(dirty)}: {dirty}")
            rows.append((mid, desc, f"DIRTY={len(dirty)}", "", "", "VOID"))
            ok = False
            continue

        out, rc = run_specs()
        fails = failed_names(out)
        threw = [m for m in THROW_MARKERS if m in out]
        total = collected_total(out)
        collapsed = total != control_total

        red_ok = all(matches(fails, n) for n in must_red)
        green_ok = all(not matches(fails, n) for n in must_green)
        missed_red = [n for n in must_red if not matches(fails, n)]
        broke_green = [n for n in must_green if matches(fails, n)]

        if threw or collapsed:
            verdict = "VOID(module-level)"
        elif red_ok and green_ok:
            verdict = "BITTEN"
        else:
            verdict = "PROBLEM"
        if verdict != "BITTEN":
            ok = False
        rows.append((mid, desc, f"{len(fails)}/{total} failed",
                     ";".join(missed_red), ";".join(broke_green), verdict))
        print(f"{mid}: {verdict} | ran={total}(ctrl {control_total}) failures={len(fails)} "
              f"| importErrors={threw} | missed_red={missed_red} | broke_green={broke_green}")

    restore()
    # TRAILING CONTROL — the tree must be pristine and green again.
    trailing_dirty = dirty_src_files()
    out, rc = run_specs()
    trailing_fail = failed_names(out)
    print(f"TRAILING CONTROL: dirty={len(trailing_dirty)} failures={len(trailing_fail)}")
    if trailing_dirty or trailing_fail:
        print("FATAL: trailing control not clean/green — earlier results are suspect")
        ok = False

    print("\n| mutant | aim | result | missed-red | broke-green | verdict |")
    print("|---|---|---|---|---|---|")
    for r in rows:
        print("| " + " | ".join(x if x else "-" for x in r) + " |")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
