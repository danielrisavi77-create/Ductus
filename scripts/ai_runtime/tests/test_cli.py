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
from ai_runtime import cli, process, providers, registry, workspace
from ai_runtime.cli import main, runtime_home, read_json, check_ready
from ai_runtime.policy import Blocked
from test_runtime import task

def run_cli(*argv):
    out=io.StringIO()
    with contextlib.redirect_stdout(out),contextlib.redirect_stderr(io.StringIO()):
        try:code=main(list(argv))
        except SystemExit as exc:return exc.code,None
    return code,json.loads(out.getvalue())

class CliTests(unittest.TestCase):
    def test_roster_lists_only_read_only_roles_and_non_claude_providers(self):
        code,data=run_cli('roster');self.assertEqual(code,0)
        self.assertEqual(sorted(r['role'] for r in data['roles']),
                         ['accessibility','architecture','bug-hunter','privacy-pilot','product-ux','qa','reviewer','security'])
        self.assertEqual(sum(r['writer'] for r in data['roles']),0)
        self.assertEqual(data['providers'],['codex','grok','mistral'])
        self.assertIs(data['canonical_review'],False)
    def test_writer_orchestration_commands_do_not_exist(self):
        for argv in (['prepare','task.json'],['mode','normal'],['mode','catch-up']):
            with self.subTest(argv=argv):self.assertEqual(run_cli(*argv),(2,None))
    def test_controller_source_has_no_github_write_or_write_sandbox(self):
        # Structural guard: the runner has no code path that talks to GitHub or
        # selects a provider write mode. Publishing a verdict stays a human/App act.
        for module in (cli,process,providers,registry,workspace):
            source=Path(module.__file__).read_text(encoding='utf-8')
            for token in ("'gh'",'"gh"','api.github.com','workspace-write','acceptEdits',
                          "'push'","'commit'","'merge'",'urllib','http.client','requests','socket'):
                with self.subTest(module=module.__name__,token=token):self.assertNotIn(token,source)
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
            with patch('ai_runtime.cli.inspect_workspace') as inspect, \
                    patch('ai_runtime.cli.bounded_process') as spawn:
                with self.assertRaises(Blocked) as caught:check_ready(task(),Path(tmp),Path(tmp))
                self.assertIn('blocked_funding',str(caught.exception))
                with self.assertRaises(Blocked):cli.execute(task(),Path(tmp),Path(tmp))
                inspect.assert_not_called();spawn.assert_not_called()
    def test_run_without_evidence_exits_2_with_blocked_funding(self):
        with tempfile.TemporaryDirectory() as tmp,patch('ai_runtime.cli.runtime_home',return_value=Path(tmp)):
            file=Path(tmp)/'task.json';file.write_text(json.dumps(task()))
            for action in ('check','run'):
                code,data=run_cli(action,str(file))
                with self.subTest(action=action):
                    self.assertEqual(code,2);self.assertIn('blocked_funding',data['reason'])
            self.assertFalse((Path(tmp)/'runs').exists())
    def test_run_refuses_task_with_write_paths_or_claude(self):
        with tempfile.TemporaryDirectory() as tmp,patch('ai_runtime.cli.runtime_home',return_value=Path(tmp)):
            for overrides,reason in ((dict(scopes=['src/']),'blocked_scope'),(dict(provider='claude'),'blocked_provider'),
                                     (dict(role='platforma',scopes=['scripts/']),'blocked_task')):
                file=Path(tmp)/'task.json';file.write_text(json.dumps(task(**overrides)))
                code,data=run_cli('run',str(file))
                with self.subTest(overrides=overrides):
                    self.assertEqual(code,2);self.assertIn(reason,data['reason'])
    def test_status_exposes_limit_not_fake_active_agents(self):
        with tempfile.TemporaryDirectory() as tmp,patch('ai_runtime.cli.runtime_home',return_value=Path(tmp)):
            code,data=run_cli('status');self.assertEqual(code,0)
            self.assertEqual(data['active'],[])
            self.assertEqual(data['limits']['read_only_runs'],3)
    def test_cli_denies_arbitrary_api_provider(self):
        with tempfile.TemporaryDirectory() as tmp,patch('ai_runtime.cli.runtime_home',return_value=Path(tmp)):
            file=Path(tmp)/'task.json';file.write_text(json.dumps(task(provider='deepseek')))
            code,data=run_cli('check',str(file))
            self.assertEqual(code,2);self.assertEqual(data['status'],'blocked')

if __name__=='__main__':unittest.main()
