#!/usr/bin/python3 -I
import ctypes
import fcntl
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

LIVE = Path('/opt/openrotmg/site')
CLIENT = Path('/opt/openrotmg/client')
STATE = Path('/var/lib/openrotmg-site-deploy')
LOCK = Path('/run/lock/openrotmg-deploy.lock')
REPO = 'https://github.com/OpenRotMG/Open-RotMG-Website.git'
CLIENT_REPO = 'https://github.com/OpenRotMG/Open-RotMG-Client.git'
ORIGIN = 'https://game.openrotmg.org/'
LIMIT = 96 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def files(root):
    require(not any(p.is_symlink() for p in root.rglob('*')), 'Deployment tree contains a symlink')
    return {str(p.relative_to(root)): digest(p.read_bytes()) for p in root.rglob('*') if p.is_file()}


def atomic(path, data):
    temporary = path.with_name(path.name + '.new')
    with temporary.open('wb') as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())
    temporary.chmod(0o644)
    temporary.replace(path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def payload(raw, revision, client_revision):
    require(len(raw) <= LIMIT, 'Deployment archive exceeds limit')
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as compressed:
        expanded = compressed.read(LIMIT + 1)
    require(len(expanded) <= LIMIT, 'Deployment archive expanded content exceeds limit')
    with tarfile.open(fileobj=io.BytesIO(expanded), mode='r:') as archive:
        result = {}
        size = 0
        for entry in archive:
            path = PurePosixPath(entry.name)
            require(entry.isfile() and not path.is_absolute() and '..' not in path.parts
                    and str(path) == entry.name and entry.name not in result,
                    'Unsafe or duplicate deployment archive path: ' + entry.name)
            size += entry.size
            require(size <= LIMIT and len(result) < 2048, 'Deployment archive content exceeds limits')
            result[entry.name] = archive.extractfile(entry).read()
    metadata = json.loads(result.pop('metadata.json'))
    require(set(metadata) == {'revision', 'client_revision', 'manifest'}
            and metadata['revision'] == revision and metadata['client_revision'] == client_revision,
            'Deployment revision mismatch')
    require({n: digest(d) for n, d in result.items()} == metadata['manifest'], 'Deployment archive checksum mismatch')
    require(all(n.startswith(('site/', 'client/')) for n in result), 'Unexpected deployment path')
    site = {n.removeprefix('site/'): d for n, d in result.items() if n.startswith('site/')}
    client = {n.removeprefix('client/'): d for n, d in result.items() if n.startswith('client/')}
    require({'index.html', '404.html', 'game.js', 'diagnostics-build.json', '.nojekyll'} <= site.keys(), 'Incomplete website build')
    require({'index.html', 'client.swf', 'vendor/ruffle.js', 'vendor/openrotmg.json'} <= client.keys(), 'Incomplete client build')
    build = json.loads(site['diagnostics-build.json'])
    require(build['website'] == revision and build['client'] == client_revision and build['dirty'] is False,
            'Website/client build provenance mismatch')
    require(build.get('local_client') is None
            and re.fullmatch('[0-9a-f]{64}', build.get('client_archive_sha256', ''))
            and re.fullmatch('[0-9a-f]{64}', build.get('runtime_bundle_sha256', ''))
            and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+-openrotmg\.[0-9]+', build.get('runtime_version', '')),
            'A complete normal deployed client selection is required; local client builds cannot be deployed')
    require(build['runtime'] == digest(client['vendor/openrotmg.json'])[:16], 'Runtime provenance mismatch')
    return site, client


def current_main(revision, client_revision):
    for repo, expected in [(REPO, revision), (CLIENT_REPO, client_revision)]:
        actual = subprocess.check_output(['git', 'ls-remote', '--exit-code', repo, 'refs/heads/main'], text=True, timeout=30).split()[0]
        require(actual == expected, 'Main advanced; refusing stale deployment: ' + repo + ' ' + expected)


def exchange(live, stage):
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.renameat2(-100, os.fsencode(live), -100, os.fsencode(stage), 2):
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))


def verify_public(manifest):
    def verify(name):
        request = urllib.request.Request(ORIGIN + name, headers={'Cache-Control': 'no-cache'})
        with urllib.request.urlopen(request, timeout=30) as response:
            require(digest(response.read(LIMIT + 1)) == manifest[name], 'Public checksum mismatch: ' + name)
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(verify, manifest))


def stage_tree(live, content, work):
    stage = live.with_name(live.name + '-stage-' + work.name)
    stage.mkdir(mode=0o755)
    stage.chmod(0o755)
    for name, data in content.items():
        target = stage / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    for path in stage.rglob('*'):
        path.chmod(0o755 if path.is_dir() else 0o644)
    require(files(stage) == {n: digest(d) for n, d in content.items()}, 'Staged tree differs from archive')
    return stage


def server_updater():
    spec = importlib.util.spec_from_file_location('server_update', '/opt/openrotmg-deploy/update.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def activate(site, client, work, revision, client_revision, changed_client):
    if not changed_client:
        current_main(revision, client_revision)
        exchange(LIVE, site)
        return
    update = server_updater()
    config = json.loads(update.CONFIG.read_text())
    update.rehearse(update.LIVE, work, {**config, 'client': str(client)})
    update.start_backup()
    with update.LAST_BACKUP.with_name('backup.lock').open('rb') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current_main(revision, client_revision)
        update.warn_restart(config)
        current_main(revision, client_revision)
        update.stop_prepared(config, work)
        cutover = 'shutdown_result'
        try:
            require(subprocess.check_output(['systemctl', 'show', 'openrotmg', '-p', 'Result', '--value'], text=True).strip() == 'success',
                    'Shutdown save failed; no client exchange performed')
            cutover = 'freeze_recovery'
            frozen = work / 'cutover'
            frozen.mkdir(mode=0o700)
            update.copy_db(Path(config['state']) / 'game.db', frozen / 'game.db')
            shutil.copyfile(Path(config['state']) / 'server.pem', frozen / 'server.pem')
            (frozen / 'server.pem').chmod(0o600)
            cutover = 'client_exchange'
            # The SWF is cached in memory, unlike the website and runtime files.
            exchange(CLIENT, client)
            atomic(CLIENT.with_suffix('.REVISION'), (client_revision + '\n').encode())
            atomic(CLIENT.with_suffix('.sha256.json'), json.dumps(files(CLIENT), sort_keys=True).encode())
            cutover = 'site_exchange'
            exchange(LIVE, site)
            cutover = 'start'
            update.run('systemctl', 'start', 'openrotmg.service')
            cutover = 'verify_running'
            update.ready(int(config['bind'].rsplit(':', 1)[1]))
        except BaseException as error:
            post_stop_failure(work, cutover, error, site, client)
    try:
        update.start_backup()
    except BaseException as error:
        post_stop_failure(work, 'backup_after_start', error, site, client)


def post_stop_failure(work, stage, error, site, client):
    failure = {'stage': stage, 'error': str(error), 'recovery': str(work),
               'previous_site': str(site), 'previous_client': str(client)}
    (work / 'post-stop-failure.json').write_text(json.dumps(failure, indent=2) + '\n')
    raise RuntimeError(f'Post-stop {stage} failed: {error}; recovery: {work}') from error


def deploy(revision, client_revision, raw):
    site, client = payload(raw, revision, client_revision)
    current_main(revision, client_revision)
    before = {}
    for tree in [LIVE, CLIENT]:
        before[tree.name] = files(tree)
        require(before[tree.name] == json.loads(tree.with_suffix('.sha256.json').read_text()),
                'Live tree differs from its recorded manifest: ' + str(tree))
    changed_client = CLIENT.with_suffix('.REVISION').read_text().strip() != client_revision
    require(changed_client or before[CLIENT.name] == {n: digest(d) for n, d in client.items()},
            'Same client revision produced different files')
    STATE.mkdir(mode=0o700, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix=revision + '-', dir=STATE))
    status = {'revision': revision, 'client_revision': client_revision, 'client_restarted': changed_client,
              'prior_revision': LIVE.with_suffix('.REVISION').read_text().strip(),
              'recovery': str(work), 'state': 'staging'}
    try:
        require(shutil.disk_usage(LIVE.parent).free >= 2 * 1024**3, 'Less than 2 GiB free; retained recovery data needs review')
        staged_site = stage_tree(LIVE, site, work)
        staged_client = stage_tree(CLIENT, client, work) if changed_client else None
        status.update(previous_site=str(staged_site), previous_client=str(staged_client) if changed_client else None)
        (work / 'previous-metadata.json').write_text(json.dumps(before))
        status['state'] = 'activating'
        activate(staged_site, staged_client, work, revision, client_revision, changed_client)
        status['state'] = 'activated_unverified'
        atomic(LIVE.with_suffix('.REVISION'), (revision + '\n').encode())
        manifest = {n: digest(d) for n, d in site.items()}
        atomic(LIVE.with_suffix('.sha256.json'), json.dumps(manifest, sort_keys=True).encode())
        public_client = {n: digest(d) for n, d in client.items() if n.startswith('vendor/')}
        # /client.swf is intentionally rewritten with the production RSA key by the server.
        verify_public(manifest | public_client)
        status.update(state='deployed', files=len(manifest), client_files=len(client))
    except Exception as error:
        status['error'] = str(error)
        raise
    finally:
        status['checked_at'] = int(time.time())
        (work / 'receipt.json').write_text(json.dumps(status, indent=2))
        atomic(STATE / 'status.json', json.dumps(status).encode())
        print(json.dumps(status), flush=True)


def main():
    os.umask(0o077)
    require(len(sys.argv) == 2 and re.fullmatch('[0-9a-f]{40} [0-9a-f]{40}', sys.argv[1]),
            'Only exact website and client commit SHAs are accepted')
    raw = sys.stdin.buffer.read(LIMIT + 1)
    with LOCK.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        deploy(*sys.argv[1].split(), raw)


if __name__ == '__main__':
    main()
