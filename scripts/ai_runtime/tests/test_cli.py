"""CLI, readiness and artifact tests; never invoke a hosted model."""
import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from ai_runtime.cli import main, runtime_home, read_json, check_ready
from ai_runtime.policy import Blocked
from ai_runtime.registry import Registry
from test_runtime import task

class CliTests(unittest.TestCase):
    def test_roster_has_twelve_unique_roles_without_starting_jobs(self):
        out=io.StringIO()
        with contextlib.redirect_stdout(out):code=main(['roster'])
        data=json.loads(out.getvalue());self.assertEqual(code,0)
        self.assertEqual(len(data['roles']),12)
        self.assertEqual(sum(r['writer'] for r in data['roles']),3)
    def test_invalid_json_and_duplicate_keys_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/'bad.json'
            for text in ('{oops','{"x":1,"x":2}','{"x":NaN}'):
                file.write_text(text)
                with self.subTest(text=text),self.assertRaises(Blocked):read_json(file)
    def test_state_is_not_per_worktree(self):
        with patch.dict(os.environ,{'LOCALAPPDATA':'C:/Synthetic','HOME':'/synthetic'},clear=False):
            self.assertEqual(runtime_home(),runtime_home())
            self.assertIn('DucturaRuntime',str(runtime_home()))
    def test_missing_evidence_blocks_before_workspace_or_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch('ai_runtime.cli.inspect_workspace') as inspect:
                with self.assertRaises(Blocked):check_ready(task(),Path(tmp),Path(tmp))
                inspect.assert_not_called()
    def test_status_exposes_limit_not_fake_active_agents(self):
        with tempfile.TemporaryDirectory() as tmp,patch('ai_runtime.cli.runtime_home',return_value=Path(tmp)):
            out=io.StringIO()
            with contextlib.redirect_stdout(out):code=main(['status'])
            data=json.loads(out.getvalue());self.assertEqual(code,0)
            self.assertEqual(data['active'],[])
            self.assertEqual(data['limits']['managed_runs'],3)
    def test_cli_denies_arbitrary_api_provider(self):
        with tempfile.TemporaryDirectory() as tmp,patch('ai_runtime.cli.runtime_home',return_value=Path(tmp)):
            file=Path(tmp)/'task.json';file.write_text(json.dumps(task(provider='deepseek')))
            out=io.StringIO()
            with contextlib.redirect_stdout(out):code=main(['check',str(file)])
            self.assertEqual(code,2);self.assertIn('blocked',out.getvalue())

if __name__=='__main__':unittest.main()
