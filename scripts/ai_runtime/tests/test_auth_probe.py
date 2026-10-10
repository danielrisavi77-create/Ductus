"""Native login-probe tests for the remaining providers; no account, credential or model calls.

The Claude probe tests left with the Claude adapter (DAN-41 narrowing). The same
properties are asserted here for the Codex probe, which previously had no tests.
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from ai_runtime.cli import doctor
from ai_runtime.policy import Blocked


class AuthProbeTests(unittest.TestCase):
    def probe(self, output, exit_code=0, stderr='', installed=('codex',)):
        def resolve(provider):
            if provider not in installed:
                raise Blocked('blocked_install: synthetic fixture excludes this provider')
            return ['synthetic-' + provider]
        completed = subprocess.CompletedProcess(['synthetic-codex', 'login', 'status'],
                                                exit_code, stdout=output, stderr=stderr)
        with tempfile.TemporaryDirectory() as tmp, \
                patch('ai_runtime.cli.resolve_command', side_effect=resolve), \
                patch('ai_runtime.cli.fingerprint', return_value='a' * 64), \
                patch('ai_runtime.cli.subprocess.run', return_value=completed) as run:
            result = doctor(Path(tmp))
        return result, run

    def test_chatgpt_subscription_login_is_recognized_on_stdout_or_stderr(self):
        for stdout, stderr in (('Logged in using ChatGPT\n', ''), ('', 'Logged in using ChatGPT\n')):
            with self.subTest(stdout=stdout):
                result, _ = self.probe(stdout, stderr=stderr)
                self.assertIs(result['providers']['codex']['native_subscription_login_verified'], True)

    def test_nonzero_exit_cannot_prove_login(self):
        result, _ = self.probe('Logged in using ChatGPT\n', exit_code=1)
        self.assertIs(result['providers']['codex']['native_subscription_login_verified'], False)

    def test_api_key_or_unknown_login_is_not_a_subscription(self):
        for output in ('Logged in using an API key - sk-synthetic\n', 'Not logged in\n', '', '{"loggedIn":true}'):
            with self.subTest(output=output):
                result, _ = self.probe(output)
                self.assertIs(result['providers']['codex']['native_subscription_login_verified'], False)

    def test_login_never_authorizes_dispatch_or_exports_probe_output(self):
        result, _ = self.probe('Logged in using ChatGPT\nsynthetic@example.invalid synthetic-account\n')
        entry = result['providers']['codex']
        self.assertIs(entry['native_subscription_login_verified'], True)
        self.assertIs(entry['dispatch_ready'], False)
        self.assertIs(entry['evidence_file_exists'], False)
        self.assertEqual(entry['model_calls'], 0)
        self.assertEqual(result['model_calls'], 0)
        self.assertNotIn('synthetic@example.invalid', json.dumps(result))
        self.assertNotIn('synthetic-account', json.dumps(result))

    def test_probe_runs_only_the_login_status_command_in_a_clean_environment(self):
        with patch.dict('os.environ', {'OPENAI_API_KEY': 'synthetic', 'GITHUB_TOKEN': 'synthetic'}):
            _, run = self.probe('Logged in using ChatGPT\n')
        run.assert_called_once()
        self.assertEqual(run.call_args.args[0], ['synthetic-codex', 'login', 'status'])
        self.assertNotIn('OPENAI_API_KEY', run.call_args.kwargs['env'])
        self.assertNotIn('GITHUB_TOKEN', run.call_args.kwargs['env'])

    def test_grok_and_mistral_have_no_login_probe_and_are_never_ready(self):
        result, run = self.probe('', installed=('grok', 'mistral'))
        run.assert_not_called()
        for provider in ('grok', 'mistral'):
            with self.subTest(provider=provider):
                self.assertIsNone(result['providers'][provider]['native_subscription_login_verified'])
                self.assertIs(result['providers'][provider]['dispatch_ready'], False)

    def test_doctor_does_not_probe_claude_or_unapproved_channels(self):
        result, _ = self.probe('Logged in using ChatGPT\n')
        self.assertEqual(sorted(result['providers']), ['codex', 'grok', 'mistral'])

    def test_missing_install_is_reported_not_raised(self):
        result, run = self.probe('', installed=())
        run.assert_not_called()
        for entry in result['providers'].values():
            self.assertIn('blocked_install', entry['status'])
            self.assertIs(entry['dispatch_ready'], False)


if __name__ == '__main__':
    unittest.main()
