"""By-hand review evidence; snapshot updates run only in a staging archive."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tarfile
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.codex-out'
BRANCH = 'edit-ux/txn-slice2a-A'
SEED_SHA = '69ff73cf180efb4099c10446197661a33f9777da'
FOLDER = Path('scripts/parity-evidence')
CONFIG = str(FOLDER / 'vitest.evidence.config.ts')
DOOR = str(FOLDER / 'flag-off-door-parity.evidence.ts')
INTERFACE = [str(FOLDER / name) for name in [
    'flag-off-store-interface-parity.evidence.ts',
    'route-v2-store-interface-parity.evidence.ts',
]]
FILES = [DOOR, *INTERFACE]
SNAPS = [str(FOLDER / '__snapshots__' / (Path(p).name + '.snap')) for p in FILES]
GATE = ['node', '-e', "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)"]


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def verify_export(export, archive):
    """Bind every exported file and symlink to the git blob at the pinned SHA."""
    entries = []
    for record in git('ls-tree', '-r', '-z', SEED_SHA).split(b'\0'):
        if record:
            meta, name = record.split(b'\t', 1)
            mode, kind, oid = meta.split()
            assert kind == b'blob', record
            entries.append((mode, oid, name.decode()))
    blobs = subprocess.check_output(['git', 'cat-file', '--batch'], cwd=ROOT,
        input=b''.join(oid + b'\n' for _, oid, _ in entries))
    cursor = 0
    for mode, oid, name in entries:
        end = blobs.index(b'\n', cursor)
        object_id, kind, length = blobs[cursor:end].split()
        assert object_id == oid and kind == b'blob'
        cursor = end + 1
        content = blobs[cursor:cursor + int(length)]
        cursor += int(length)
        assert blobs[cursor:cursor + 1] == b'\n'
        cursor += 1
        path = export / name
        actual = os.readlink(path).encode() if path.is_symlink() else path.read_bytes()
        assert actual == content and (mode == b'120000') == path.is_symlink(), name
    assert cursor == len(blobs)
    with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
        names = [item.name for item in bundle.getmembers() if item.isfile() or item.issym()]
    assert sorted(names) == sorted(name for _, _, name in entries)
    return {'source_sha': SEED_SHA, 'tracked_export_files_checked': len(entries),
            'export_byte_mismatches': []}


def run(place, cwd, files, update=False, pattern=None):
    assert 0 < len(files) <= 2
    assert not update or cwd != ROOT
    report = evidence / (place + '.json')
    args = ['pnpm', 'exec', 'vitest', 'run', '--config', CONFIG, *files]
    if pattern:
        args.append('--testNamePattern=' + pattern)
    if update:
        args.append('--update')
    args += ['--reporter=default', '--reporter=json', '--outputFile=' + str(report)]
    command = shlex.join(GATE) + ' && ' + shlex.join(args)
    env = {**os.environ, 'TMPDIR': str(temp), 'NO_COLOR': '1', 'UPDATE_SNAPSHOT': 'none'}
    if update:
        env.pop('UPDATE_SNAPSHOT')
    log = evidence / (place + '.log')
    print('RUN ' + place, flush=True)
    while subprocess.run(GATE, cwd=ROOT, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL).returncode != 0:
        print('Waiting for host load <25 before ' + place, flush=True)
        time.sleep(10)
    with log.open('w') as stream:
        stream.write('cwd=' + str(cwd) + '\n' + command + '\n')
        stream.flush()
        result = subprocess.run(command, shell=True, executable='/bin/bash', cwd=cwd,
                                env=env, stdout=stream, stderr=subprocess.STDOUT)
    assert result.returncode == 0, str(log)
    data = json.loads(report.read_text())
    assert data['numTotalTests'] > 0 and data['numFailedTests'] == 0, str(report)
    assert update or data['numPendingTests'] == 0, str(report)
    print(json.dumps({'place': place, 'passed': data['numPassedTests'],
                      'unselected': data['numPendingTests'], 'log': str(log)}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['current', 'seed'])
    mode = parser.parse_args().mode
    assert git('branch', '--show-current').decode().strip() == BRANCH
    for snap in SNAPS:
        assert re.findall(r"^// STAGING_SEED_SHA = '([a-f0-9]{40})'$",
                          (ROOT / snap).read_text(), re.M) == [SEED_SHA], snap
    OUT.mkdir(exist_ok=True)
    evidence = Path(tempfile.mkdtemp(prefix='parity-evidence-', dir=OUT))
    temp = evidence / 'tmp'
    temp.mkdir()
    original = {p: (ROOT / p).read_bytes() for p in FILES + SNAPS}
    cwd = ROOT
    if mode == 'seed':
        # Resolve origin/staging explicitly, then export its Addendum 15 pinned commit.
        assert git('rev-parse', 'origin/staging').decode().strip() == SEED_SHA
        archive = git('archive', SEED_SHA)
        assert subprocess.check_output(['git', 'get-tar-commit-id'], input=archive,
                                       cwd=ROOT).decode().strip() == SEED_SHA
        (evidence / 'staging-reference.tar').write_bytes(archive)
        # Keep exported staging tests outside current-tree test discovery; retain it.
        cwd = Path(tempfile.mkdtemp(prefix='addendum-16-parity-staging-', dir='/private/tmp'))
        with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
            bundle.extractall(cwd)
        audit = verify_export(cwd, archive)
        audit['export'] = str(cwd)
        print('Retained staging export: ' + str(cwd), flush=True)
        assert (ROOT / 'pnpm-lock.yaml').read_bytes() == (cwd / 'pnpm-lock.yaml').read_bytes()
        (cwd / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
        for path in [*FILES, *SNAPS, CONFIG]:
            destination = cwd / path
            assert not destination.exists(), path
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / path, destination)
        run('staging-door-seed', cwd, [DOOR], update=True,
            pattern='preserves staging')
        run('staging-interface-seed', cwd, INTERFACE, update=True,
            pattern='staging_method_counts')
        for path in SNAPS:
            data = re.sub(r"^// STAGING_SEED_SHA = '[^']*'\n", '',
                          (cwd / path).read_text(), flags=re.M)
            data = data.replace('\n', "\n// STAGING_SEED_SHA = '" + SEED_SHA + "'\n", 1)
            (cwd / path).write_text(data)
            assert (cwd / path).read_bytes() == original[path], path
        audit['snapshot_sha256'] = {p: hashlib.sha256((cwd / p).read_bytes()).hexdigest()
                                    for p in SNAPS}
        (evidence / 'seed-provenance.json').write_text(json.dumps(audit, indent=2) + '\n')
    run(mode + '-door', cwd, [DOOR])
    run(mode + '-interface', cwd, INTERFACE)
    assert all((ROOT / path).read_bytes() == saved for path, saved in original.items())
    if mode == 'seed':
        verify_export(cwd, archive)
    print('Review evidence GREEN; current harnesses and snapshots unchanged. ' + str(evidence))
