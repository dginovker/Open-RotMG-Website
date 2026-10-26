#!/usr/bin/env python3
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import subprocess
import tarfile


def package(root, client, revision, output):
    root = Path(root)
    if not re.fullmatch('[0-9a-f]{40}', revision) or any(p.is_symlink() for p in root.rglob('*')):
        raise ValueError('Invalid revision or symlink in website build')
    files = {str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob('*')) if p.is_file()}
    build = json.loads(files['diagnostics-build.json'])
    if build['website'] != revision or build['dirty'] is not False:
        raise ValueError('Website build does not match the clean source revision')
    if (build.get('local_client') is not None
            or not re.fullmatch('[0-9a-f]{64}', build.get('client_archive_sha256', ''))
            or not re.fullmatch('[0-9a-f]{64}', build.get('runtime_bundle_sha256', ''))
            or not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+-openrotmg\.[0-9]+', build.get('runtime_version', ''))):
        raise ValueError('A complete normal deployed client selection is required; local client builds cannot be packaged')
    client = Path(client)
    actual = subprocess.check_output(['git', '-C', str(client), 'rev-parse', 'HEAD'], text=True).strip()
    subprocess.run(['git', '-C', str(client), 'diff', '--exit-code', 'HEAD'], check=True)
    if build['client'] != actual:
        raise ValueError('Client build revision mismatch')
    names = subprocess.check_output(['git', '-C', str(client), 'ls-files', '-z']).decode().split('\0')[:-1]
    names += [str(p.relative_to(client)) for p in (client / 'vendor').rglob('*') if p.is_file()]
    lock = json.loads((client / 'editor/lock.json').read_text())
    if (hashlib.sha256((client / 'client.swf').read_bytes()).hexdigest() != lock['sourceSha256']
            or hashlib.sha256(files['draw/native-texture-editor.swf']).hexdigest() != lock['outputSha256']):
        raise ValueError('Native editor asset checksum mismatch')
    if any((client / name).is_symlink() for name in names):
        raise ValueError('Symlink in client build')
    files = {'site/' + n: d for n, d in files.items()} | {'client/' + n: (client / n).read_bytes() for n in names}
    metadata = {'revision': revision, 'client_revision': actual,
                'manifest': {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
    with tarfile.open(output, 'w:gz') as archive:
        for name, data in {'metadata.json': json.dumps(metadata).encode(), **files}.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            archive.addfile(entry, io.BytesIO(data))


if __name__ == '__main__':
    package(*sys.argv[1:])
