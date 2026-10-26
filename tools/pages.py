import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import urllib.request
import zlib

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / '.local/pages-backend.json'
API = os.environ['API_ORIGIN'].rstrip('/')


def download(path, limit=1024 * 1024):
    request = urllib.request.Request(API + path, headers={'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Game publication response exceeds limit: ' + path)
    return data


def identity():
    health = json.loads(download('/health'))
    client = json.loads(download('/diagnostics-build.json'))
    result = {'server': health['revision'], 'process': health['process'], 'client': client['client'], 'runtime': client['runtime']}
    if (any(not re.fullmatch('[0-9a-f]{40}', result[key]) for key in ['server', 'client'])
            or type(result['process']) is not int or result['process'] <= 0):
        raise ValueError('Invalid deployed game/client identity')
    return result


def inspect():
    deployed = identity()
    for field in ['server', 'client']:
        expected = os.environ.get('EXPECTED_' + field.upper() + '_REVISION', '')
        if expected and deployed[field] != expected:
            raise ValueError('Game publication was superseded: ' + field)
    SNAPSHOT.parent.mkdir(exist_ok=True)
    SNAPSHOT.write_text(json.dumps(deployed))
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f"server={deployed['server']}\nclient={deployed['client']}\n")
    print(json.dumps(deployed))


def assemble():
    expected = json.loads(SNAPSHOT.read_text())
    if identity() != expected:
        raise ValueError('Backend changed before static client publication')
    swf = download('/client.swf', 16 * 1024 * 1024)
    if len(swf) < 9 or swf[:3] not in [b'CWS', b'FWS'] or identity() != expected:
        raise ValueError('Invalid or changed backend during static client publication')
    if swf[:3] == b'CWS':
        decoder = zlib.decompressobj()
        body = decoder.decompress(swf[8:], 32 * 1024 * 1024 + 1)
        if not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
            raise ValueError('Incomplete or oversized static client stream')
    else:
        body = swf[8:]
    if len(body) + 8 != int.from_bytes(swf[4:8], 'little'):
        raise ValueError('Static client movie length mismatch')
    dist = ROOT / 'dist'
    build = json.loads((dist / 'diagnostics-build.json').read_text())
    if build['client'] != expected['client'] or build['runtime'] != expected['runtime']:
        raise ValueError('Pages client/runtime differs from the deployed game')
    shutil.copytree(Path(os.environ['CLIENT_DIR']) / 'vendor', dist / 'vendor')
    shutil.copytree(Path(os.environ['SERVER_DIR']) / 'data/sfx', dist / 'sfx')
    (dist / 'client.swf').write_bytes(swf)
    build.update(server=expected['server'], client_swf_sha256=hashlib.sha256(swf).hexdigest())
    (dist / 'diagnostics-build.json').write_text(json.dumps(build))
    (dist / '2010/index.html').write_text('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=https://www.openrotmg.org/2010/"><title>July 2010 Preview</title><link rel="canonical" href="https://www.openrotmg.org/2010/"></head><body><a href="https://www.openrotmg.org/2010/">Open the July 2010 preview</a></body></html>')
    print(json.dumps({'server': build['server'], 'client': build['client'], 'client_swf_sha256': build['client_swf_sha256']}))


if __name__ == '__main__':
    if sys.argv[1:] == ['inspect']:
        inspect()
    elif sys.argv[1:] == ['assemble']:
        assemble()
    else:
        raise SystemExit('Expected inspect or assemble')
