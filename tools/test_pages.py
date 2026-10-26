import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zlib

with patch.dict(os.environ, {'API_ORIGIN': 'https://game.example.test'}):
    spec = importlib.util.spec_from_file_location('pages', Path(__file__).with_name('pages.py'))
    pages = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pages)


class PagesTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.expected = {'server': 'a' * 40, 'client': 'b' * 40, 'runtime': 'c' * 16, 'process': 123}
        self.client = self.root / 'client'
        self.server = self.root / 'server'
        (self.client / 'vendor').mkdir(parents=True)
        (self.client / 'vendor/ruffle.js').write_bytes(b'fixture runtime')
        (self.server / 'data/sfx').mkdir(parents=True)
        (self.server / 'data/sfx/test.mp3').write_bytes(b'fixture audio')
        (self.root / 'dist/2010').mkdir(parents=True)
        (self.root / 'dist/diagnostics-build.json').write_text(json.dumps(self.expected))
        self.snapshot = self.root / 'backend.json'
        self.snapshot.write_text(json.dumps(self.expected))
        body = b'fixture movie transport'
        self.swf = b'CWS\x0a' + (len(body) + 8).to_bytes(4, 'little') + zlib.compress(body)
        for name, value in [('ROOT', self.root), ('SNAPSHOT', self.snapshot)]:
            self.patch(pages, name, value)
        env = patch.dict(os.environ, {'CLIENT_DIR': str(self.client), 'SERVER_DIR': str(self.server),
                         'GITHUB_OUTPUT': str(self.root / 'outputs'), 'EXPECTED_SERVER_REVISION': '', 'EXPECTED_CLIENT_REVISION': ''})
        env.start()
        self.addCleanup(env.stop)

    def patch(self, target, name, *args, **kwargs):
        p = patch.object(target, name, *args, **kwargs)
        result = p.start()
        self.addCleanup(p.stop)
        return result

    def test_inspect_selects_exact_live_revisions_and_rejects_superseded_dispatch(self):
        self.patch(pages, 'identity', return_value=self.expected)
        pages.inspect()
        self.assertEqual(json.loads(self.snapshot.read_text()), self.expected)
        self.assertIn('client=' + self.expected['client'], (self.root / 'outputs').read_text())
        with patch.dict(os.environ, {'EXPECTED_SERVER_REVISION': 'd' * 40}):
            with self.assertRaisesRegex(ValueError, 'superseded: server'):
                pages.inspect()

    def test_assemble_copies_all_static_dependencies_and_preserves_2010_origin(self):
        self.patch(pages, 'identity', return_value=self.expected)
        self.patch(pages, 'download', return_value=self.swf)
        pages.assemble()
        self.assertEqual((self.root / 'dist/client.swf').read_bytes(), self.swf)
        self.assertTrue((self.root / 'dist/vendor/ruffle.js').is_file())
        self.assertTrue((self.root / 'dist/sfx/test.mp3').is_file())
        build = json.loads((self.root / 'dist/diagnostics-build.json').read_text())
        self.assertEqual(build['client_swf_sha256'], hashlib.sha256(self.swf).hexdigest())
        self.assertIn('https://www.openrotmg.org/2010/', (self.root / 'dist/2010/index.html').read_text())

    def test_backend_changes_before_or_during_download_cannot_publish_mixed_assets(self):
        changed = {**self.expected, 'process': 124}
        self.patch(pages, 'download', return_value=self.swf)
        for replies in [[changed], [self.expected, changed]]:
            with patch.object(pages, 'identity', side_effect=replies), self.assertRaisesRegex(ValueError, 'changed|Backend changed'):
                pages.assemble()
        self.assertFalse((self.root / 'dist/client.swf').exists())

    def test_wrong_runtime_and_truncated_or_invalid_movie_fail_closed(self):
        self.patch(pages, 'identity', return_value=self.expected)
        for swf in [b'HTML error page', self.swf[:-1]]:
            with patch.object(pages, 'download', return_value=swf), self.assertRaises((ValueError, zlib.error)):
                pages.assemble()
        (self.root / 'dist/diagnostics-build.json').write_text(json.dumps({**self.expected, 'runtime': 'd' * 16}))
        with patch.object(pages, 'download', return_value=self.swf), self.assertRaisesRegex(ValueError, 'differs'):
            pages.assemble()
