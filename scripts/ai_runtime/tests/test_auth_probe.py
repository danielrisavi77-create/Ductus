"""Native auth-output regression tests; no account, credential or model calls."""
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
    def probe(self, output, exit_code=0):
        def resolve(provider):
            if provider != 'claude':
                raise Blocked('blocked_install: synthetic fixture excludes other providers')
            return ['synthetic-claude']
        completed = subprocess.CompletedProcess(['synthetic-claude', 'auth', 'status'],
                                                exit_code, stdout=output, stderr='')
        with tempfile.TemporaryDirectory() as tmp, \
                patch('ai_runtime.cli.resolve_command', side_effect=resolve), \
                patch('ai_runtime.cli.fingerprint', return_value='a' * 64), \
                patch('ai_runtime.cli.subprocess.run', return_value=completed):
            return doctor(Path(tmp))['providers']['claude']

    def test_current_native_claude_ai_login_is_recognized(self):
        # Shape observed from Claude Code 2.1.291; no personal fields retained.
        output = json.dumps({'loggedIn': True, 'authMethod': 'claude.ai',
                             'apiProvider': 'firstParty'})
        self.assertTrue(self.probe(output)['native_subscription_login_verified'])

    def test_legacy_native_aliases_remain_supported(self):
        for method in ('oauth', 'claudeAi'):
            with self.subTest(method=method):
                output = json.dumps({'loggedIn': True, 'authMethod': method,
                                     'apiProvider': 'firstParty'})
                self.assertTrue(self.probe(output)['native_subscription_login_verified'])

    def test_nonzero_exit_cannot_prove_login(self):
        output = json.dumps({'loggedIn': True, 'authMethod': 'oauth',
                             'apiProvider': 'firstParty'})
        self.assertFalse(self.probe(output, 1)['native_subscription_login_verified'])

    def test_other_or_missing_api_provider_cannot_prove_subscription(self):
        for provider in ('bedrock', 'vertex', 'unknown', None):
            with self.subTest(provider=provider):
                output = json.dumps({'loggedIn': True, 'authMethod': 'oauth',
                                     'apiProvider': provider})
                self.assertFalse(self.probe(output)['native_subscription_login_verified'])

    def test_non_subscription_auth_methods_are_rejected(self):
        for method in ('api_key', 'console', 'unknown', None):
            with self.subTest(method=method):
                output = json.dumps({'loggedIn': True, 'authMethod': method,
                                     'apiProvider': 'firstParty'})
                self.assertFalse(self.probe(output)['native_subscription_login_verified'])

    def test_logged_in_requires_literal_true(self):
        for logged_in in (False, None, 'true', 1):
            with self.subTest(logged_in=logged_in):
                output = json.dumps({'loggedIn': logged_in, 'authMethod': 'oauth',
                                     'apiProvider': 'firstParty'})
                self.assertFalse(self.probe(output)['native_subscription_login_verified'])

    def test_invalid_or_non_object_json_fails_closed_without_crash(self):
        for output in ('not-json', '', 'null', '[]', 'true', '42', '"text"'):
            with self.subTest(output=output):
                self.assertFalse(self.probe(output)['native_subscription_login_verified'])

    def test_login_never_authorizes_dispatch_or_exports_private_fields(self):
        output = json.dumps({'loggedIn': True, 'authMethod': 'claude.ai',
                             'apiProvider': 'firstParty', 'email': 'synthetic@example.invalid',
                             'accountUuid': 'synthetic-account'})
        result = self.probe(output)
        self.assertTrue(result['native_subscription_login_verified'])
        self.assertFalse(result['dispatch_ready'])
        self.assertFalse(result['evidence_file_exists'])
        self.assertEqual(result['model_calls'], 0)
        self.assertNotIn('synthetic@example.invalid', json.dumps(result))
        self.assertNotIn('synthetic-account', json.dumps(result))


if __name__ == '__main__':
    unittest.main()
