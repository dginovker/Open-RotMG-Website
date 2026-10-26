import io
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import deploy
from package import package

REV = 'a' * 40


class WebsiteDeploy(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.build = self.root / 'build'
        self.build.mkdir()
        for name in ['index.html', '404.html', 'game.js', '.nojekyll']:
            (self.build / name).write_text(name)
        self.client = self.root / 'source'
        self.client.mkdir()
        for name in ['index.html', 'client.swf']:
            (self.client / name).write_text(name)
        (self.client / '.gitignore').write_text('vendor/\nnative-texture-editor.swf\n')
        (self.client / 'editor').mkdir()
        (self.client / 'editor/lock.json').write_text(json.dumps({
            'sourceSha256': hashlib.sha256(b'client.swf').hexdigest(),
            'outputSha256': hashlib.sha256(b'editor').hexdigest()}))
        (self.client / 'native-texture-editor.swf').write_bytes(b'editor')
        (self.build / 'draw').mkdir()
        (self.build / 'draw/native-texture-editor.swf').write_bytes(b'editor')
        subprocess.run(['git', 'init', '-q', str(self.client)], check=True)
        subprocess.run(['git', '-C', str(self.client), 'add', '.'], check=True)
        subprocess.run(['git', '-C', str(self.client), '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], check=True)
        self.client_revision = subprocess.check_output(['git', '-C', str(self.client), 'rev-parse', 'HEAD'], text=True).strip()
        (self.client / 'vendor').mkdir()
        (self.client / 'vendor/ruffle.js').write_text('runtime')
        (self.client / 'vendor/openrotmg.json').write_text('{}')
        (self.build / 'diagnostics-build.json').write_text(json.dumps({
            'website': REV, 'client': self.client_revision, 'dirty': False,
            'runtime': deploy.digest(b'{}')[:16], 'client_archive_sha256': 'd' * 64,
            'runtime_bundle_sha256': 'e' * 64, 'runtime_version': '0.7.1-openrotmg.8'}))
        archive = self.root / 'bundle.tar.gz'
        package(self.build, self.client, REV, archive)
        self.raw = archive.read_bytes()
        self.live = self.root / 'site'
        self.live.mkdir()
        (self.live / 'old.html').write_text('previous site')
        self.live_client = self.root / 'client'
        self.live_client.mkdir()
        for name in ['index.html', 'client.swf', '.gitignore', 'editor/lock.json', 'vendor/ruffle.js', 'vendor/openrotmg.json']:
            path = self.live_client / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((self.client / name).read_bytes())
        self.before = deploy.files(self.live)
        for tree, revision in [(self.live, 'b' * 40), (self.live_client, self.client_revision)]:
            tree.with_suffix('.sha256.json').write_text(json.dumps(deploy.files(tree)))
            tree.with_suffix('.REVISION').write_text(revision)
        for name, value in [('LIVE', self.live), ('CLIENT', self.live_client), ('STATE', self.root / 'state')]:
            p = patch.object(deploy, name, value)
            p.start()
            self.addCleanup(p.stop)

    def test_local_or_incomplete_selection_cannot_be_packaged_or_deployed(self):
        build_path = self.build / 'diagnostics-build.json'
        normal = json.loads(build_path.read_text())
        for change in [{'local_client': True}, {'client_archive_sha256': None}, {'runtime_bundle_sha256': None}, {'runtime_version': None}]:
            invalid = normal | change
            invalid = {k: v for k, v in invalid.items() if v is not None}
            build_path.write_text(json.dumps(invalid))
            output = self.root / 'invalid.tar.gz'
            with self.assertRaisesRegex(ValueError, 'normal deployed client selection'):
                package(self.build, self.client, REV, output)
            self.assertFalse(output.exists())
            def rewrite(entries):
                data = {n: d for n, d in entries}
                data['site/diagnostics-build.json'] = json.dumps(invalid).encode()
                meta = json.loads(data['metadata.json'])
                meta['manifest']['site/diagnostics-build.json'] = deploy.digest(data['site/diagnostics-build.json'])
                data['metadata.json'] = json.dumps(meta).encode()
                return data.items()
            with self.assertRaisesRegex(ValueError, 'normal deployed client selection'):
                deploy.payload(self.rewrite(rewrite), REV, self.client_revision)

    def test_package_includes_verified_derived_editor_and_rejects_corruption(self):
        with tarfile.open(fileobj=io.BytesIO(self.raw)) as archive:
            self.assertEqual(archive.extractfile('site/draw/native-texture-editor.swf').read(), b'editor')
            self.assertNotIn('client/native-texture-editor.swf', archive.getnames())
        (self.build / 'draw/native-texture-editor.swf').write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'editor asset checksum mismatch'):
            package(self.build, self.client, REV, self.root / 'corrupt.tar.gz')

    def publish(self):
        deploy.deploy(REV, self.client_revision, self.raw)

    def rewrite(self, transform):
        with tarfile.open(fileobj=io.BytesIO(self.raw)) as archive:
            entries = [(e.name, archive.extractfile(e).read()) for e in archive]
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode='w:gz') as archive:
            for name, data in transform(entries):
                entry = tarfile.TarInfo(name)
                entry.size = len(data)
                archive.addfile(entry, io.BytesIO(data))
        return output.getvalue()

    def test_website_only_publishes_without_loading_server_updater(self):
        with patch.object(deploy, 'current_main') as current, patch.object(deploy, 'verify_public'), \
                patch.object(deploy, 'server_updater') as updater:
            self.publish()
        updater.assert_not_called()
        self.assertEqual(current.call_count, 2)
        self.assertEqual(self.live.with_suffix('.REVISION').read_text().strip(), REV)
        status = json.loads((deploy.STATE / 'status.json').read_text())
        self.assertEqual(status['state'], 'deployed')
        self.assertFalse(status['client_restarted'])
        self.assertEqual((self.live / 'draw/native-texture-editor.swf').read_bytes(), b'editor')
        self.assertFalse((self.live_client / 'native-texture-editor.swf').exists())
        self.assertEqual(deploy.files(Path(status['previous_site'])), self.before)
        self.assertEqual((self.live / 'index.html').stat().st_mode & 0o777, 0o644)

    def updater(self):
        (self.root / 'backup.lock').touch()
        config = self.root / 'config.json'
        config.write_text(json.dumps({'state': str(self.root), 'bind': '127.0.0.1:18923'}))
        (self.root / 'server.pem').write_text('private fixture')
        updater = SimpleNamespace(CONFIG=config, LAST_BACKUP=self.root / 'receipt.json', LIVE=self.root / 'server',
                                  start_backup=Mock(), rehearse=Mock(), warn_restart=Mock(), run=Mock(),
                                  copy_db=Mock(side_effect=lambda src, dst: dst.write_text('frozen')), ready=Mock())
        updater.stop_prepared = Mock(side_effect=lambda config, work: updater.run('systemctl', 'stop', 'openrotmg.service'))
        return updater

    def test_readme_only_client_revision_rehearses_saves_restarts_and_retains_both_trees(self):
        self.live_client.with_suffix('.REVISION').write_text('c' * 40)
        updater = self.updater()
        with patch.object(deploy, 'current_main'), patch.object(deploy, 'verify_public'), \
                patch.object(deploy, 'server_updater', return_value=updater), \
                patch.object(deploy.subprocess, 'check_output', return_value='success'):
            self.publish()
        self.assertEqual(updater.start_backup.call_count, 2)
        updater.rehearse.assert_called_once()
        self.assertNotEqual(updater.rehearse.call_args.args[2]['client'], str(self.live_client))
        self.assertEqual([c.args for c in updater.run.call_args_list], [
            ('systemctl', 'stop', 'openrotmg.service'), ('systemctl', 'start', 'openrotmg.service')])
        self.assertEqual(self.live_client.with_suffix('.REVISION').read_text().strip(), self.client_revision)
        receipt = json.loads((deploy.STATE / 'status.json').read_text())
        self.assertTrue(Path(receipt['previous_client']).is_dir())
        self.assertTrue((Path(receipt['recovery']) / 'cutover/game.db').is_file())

    def test_rehearsal_or_save_failure_never_exchanges_live_files(self):
        for step in ['rehearse', 'save']:
            updater = self.updater()
            self.live_client.with_suffix('.REVISION').write_text('c' * 40)
            if step == 'rehearse':
                updater.rehearse.side_effect = ValueError('rehearsal failed')
            with patch.object(deploy, 'current_main'), patch.object(deploy, 'server_updater', return_value=updater), \
                    patch.object(deploy.subprocess, 'check_output', return_value='failed'), \
                    patch.object(deploy, 'exchange') as exchange:
                with self.assertRaisesRegex(ValueError if step == 'rehearse' else RuntimeError, 'failed'):
                    self.publish()
                exchange.assert_not_called()
            self.assertEqual(deploy.files(self.live), self.before)

    def test_changed_client_warning_preparation_stop_order_and_shared_arguments(self):
        self.live_client.with_suffix('.REVISION').write_text('c' * 40)
        updater = self.updater()
        events = []
        updater.rehearse.side_effect = lambda *args: events.append('rehearse')
        updater.start_backup.side_effect = lambda: events.append('backup')
        updater.warn_restart.side_effect = lambda config: events.append('warning')
        def prepare(config, work):
            events.append('prepare')
            self.assertEqual(config, json.loads(updater.CONFIG.read_text()))
            self.assertEqual(work.parent, deploy.STATE)
            updater.run('systemctl', 'stop', 'openrotmg.service')
        updater.stop_prepared.side_effect = prepare
        updater.run.side_effect = lambda *args: events.append(args[1])
        with patch.object(deploy, 'current_main', side_effect=lambda *args: events.append('main')), \
                patch.object(deploy, 'verify_public'), patch.object(deploy, 'server_updater', return_value=updater), \
                patch.object(deploy.subprocess, 'check_output', return_value='success'):
            self.publish()
        self.assertEqual(events, ['main', 'rehearse', 'backup', 'main', 'warning', 'main', 'prepare', 'stop', 'start', 'backup'])
        updater.stop_prepared.assert_called_once()

    def test_shared_preparation_failures_never_stop_exchange_or_report_success(self):
        self.live_client.with_suffix('.REVISION').write_text('c' * 40)
        before_client = deploy.files(self.live_client)
        for message in ['SQL preparation failed', 'timeout before acceptance', 'timeout after acceptance',
                        'accepted response lost', 'stale receipt', 'process replaced',
                        'SQL preparation failed; drain cancellation failed: unavailable', 'HTTP 404']:
            with self.subTest(message=message):
                updater = self.updater()
                updater.stop_prepared.side_effect = RuntimeError(message)
                with patch.object(deploy, 'current_main'), patch.object(deploy, 'verify_public') as public, \
                        patch.object(deploy, 'server_updater', return_value=updater), \
                        patch.object(deploy, 'exchange') as exchange, self.assertRaisesRegex(RuntimeError, message):
                    self.publish()
                updater.run.assert_not_called()
                exchange.assert_not_called()
                public.assert_not_called()
                self.assertEqual(updater.start_backup.call_count, 1)
                status = json.loads((deploy.STATE / 'status.json').read_text())
                self.assertEqual(status['error'], message)
                self.assertNotEqual(status['state'], 'deployed')
                self.assertFalse((Path(status['recovery']) / 'cutover').exists())
                self.assertEqual(deploy.files(self.live), self.before)
                self.assertEqual(deploy.files(self.live_client), before_client)

    def test_stale_main_before_preparation_and_during_warning_never_stops(self):
        self.live_client.with_suffix('.REVISION').write_text('c' * 40)
        for fail_at in [2, 3]:
            with self.subTest(main_check=fail_at):
                updater = self.updater()
                with patch.object(deploy, 'current_main', side_effect=[None] * (fail_at - 1) + [ValueError('Main advanced')]), \
                        patch.object(deploy, 'server_updater', return_value=updater), \
                        patch.object(deploy, 'exchange') as exchange, self.assertRaisesRegex(ValueError, 'Main advanced'):
                    self.publish()
                updater.stop_prepared.assert_not_called()
                updater.run.assert_not_called()
                exchange.assert_not_called()
                self.assertEqual(updater.warn_restart.call_count, int(fail_at == 3))

    def test_post_stop_failure_retains_stage_evidence_without_rollback_or_restart(self):
        for stage in ['shutdown_result', 'freeze_recovery', 'client_exchange', 'site_exchange',
                      'start', 'verify_running', 'backup_after_start']:
            with self.subTest(stage=stage):
                updater = self.updater()
                work = self.root / stage
                work.mkdir()
                site, client = self.root / 'staged-site', self.root / 'staged-client'
                result = 'failed' if stage == 'shutdown_result' else 'success'
                if stage == 'freeze_recovery':
                    updater.copy_db.side_effect = RuntimeError('injected freeze')
                elif stage == 'start':
                    def run(*args):
                        if args[1] == 'start':
                            raise RuntimeError('injected start')
                    updater.run.side_effect = run
                elif stage == 'verify_running':
                    updater.ready.side_effect = RuntimeError('injected ready')
                elif stage == 'backup_after_start':
                    updater.start_backup.side_effect = [None, RuntimeError('injected backup')]
                effects = [RuntimeError('injected client')] if stage == 'client_exchange' else \
                          [None, RuntimeError('injected site')] if stage == 'site_exchange' else None
                with patch.object(deploy, 'current_main'), patch.object(deploy, 'server_updater', return_value=updater), \
                        patch.object(deploy.subprocess, 'check_output', return_value=result), \
                        patch.object(deploy, 'atomic'), patch.object(deploy, 'exchange', side_effect=effects) as exchange, \
                        self.assertRaisesRegex(RuntimeError, 'Post-stop ' + stage):
                    deploy.activate(site, client, work, REV, self.client_revision, True)
                evidence = json.loads((work / 'post-stop-failure.json').read_text())
                self.assertEqual(evidence['stage'], stage)
                self.assertEqual(evidence['previous_site'], str(site))
                self.assertEqual(evidence['previous_client'], str(client))
                self.assertLessEqual(exchange.call_count, 2)
                calls = [c.args for c in updater.run.call_args_list]
                self.assertEqual(calls.count(('systemctl', 'stop', 'openrotmg.service')), 1)
                self.assertEqual(calls.count(('systemctl', 'start', 'openrotmg.service')),
                                 int(stage in ['start', 'verify_running', 'backup_after_start']))

    def test_stale_main_and_drift_fail_closed(self):
        with patch.object(deploy, 'current_main', side_effect=ValueError('Main advanced')), patch.object(deploy, 'exchange') as exchange:
            with self.assertRaisesRegex(ValueError, 'Main advanced'):
                self.publish()
            exchange.assert_not_called()
        (self.live / 'old.html').write_text('drift')
        with patch.object(deploy, 'current_main'), self.assertRaisesRegex(ValueError, 'recorded manifest'):
            self.publish()

    def test_archive_paths_hashes_and_revisions_are_checked(self):
        for name in ['/etc/evil', 'client/../../evil', 'site//evil', 'site/index.html']:
            raw = self.rewrite(lambda entries: entries + [(name, b'evil')])
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'Unsafe|duplicate'):
                deploy.payload(raw, REV, self.client_revision)
        raw = self.rewrite(lambda entries: [(n, b'corrupt' if n == 'client/client.swf' else d) for n, d in entries])
        with self.assertRaisesRegex(ValueError, 'checksum'):
            deploy.payload(raw, REV, self.client_revision)
        with self.assertRaisesRegex(ValueError, 'revision'):
            deploy.payload(self.raw, REV, 'c' * 40)
        with patch.object(deploy, 'LIMIT', len(self.raw) - 1), self.assertRaisesRegex(ValueError, 'exceeds'):
            deploy.payload(self.raw, REV, self.client_revision)

    def test_public_mismatch_is_not_success_or_rolled_back(self):
        with patch.object(deploy, 'current_main'), patch.object(deploy, 'verify_public', side_effect=ValueError('Public mismatch')):
            with self.assertRaisesRegex(ValueError, 'Public mismatch'):
                self.publish()
        status = json.loads((deploy.STATE / 'status.json').read_text())
        self.assertEqual(status['state'], 'activated_unverified')
        self.assertEqual(status['error'], 'Public mismatch')
        self.assertEqual(deploy.files(Path(status['previous_site'])), self.before)

    def test_public_verification_compares_real_http_bytes(self):
        from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
        import functools
        import threading
        with ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(SimpleHTTPRequestHandler, directory=str(self.build))) as http:
            thread = threading.Thread(target=http.serve_forever)
            thread.start()
            try:
                with patch.object(deploy, 'ORIGIN', f'http://127.0.0.1:{http.server_port}/'):
                    deploy.verify_public(deploy.files(self.build))
                    with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                        deploy.verify_public({'index.html': '0' * 64})
            finally:
                http.shutdown()
                thread.join()


if __name__ == '__main__':
    unittest.main()
