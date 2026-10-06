"""Integration tests use temporary real Git worktrees; no model/network calls."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from ai_runtime.policy import Blocked
from ai_runtime.workspace import canonical_repo, inspect_workspace, audit_scope, git
from ai_runtime.providers import build_command, clean_environment, redact
from ai_runtime.process import bounded_process
from test_runtime import task

class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.repo=self.root/'Ductus';self.repo.mkdir()
        subprocess.run(['git','init','-b','main',str(self.repo)],check=True,capture_output=True)
        git(self.repo,'config','user.name','Synthetic');git(self.repo,'config','user.email','synthetic@example.invalid')
        git(self.repo,'remote','add','origin','https://github.com/danielrisavi77-create/Ductus.git')
        (self.repo/'src').mkdir();(self.repo/'src'/'demo.txt').write_text('baseline')
        (self.repo/'.gitignore').write_text('node_modules/\n__pycache__/\n')
        git(self.repo,'add','src/demo.txt','.gitignore');git(self.repo,'commit','-m','test: baseline')
        self.sha=git(self.repo,'rev-parse','HEAD').strip()
        self.wt=self.root/'work';git(self.repo,'worktree','add','-b','worker/demo',str(self.wt),self.sha)
        self.t=task(worktree=str(self.wt),scopes=['src'],base_sha=self.sha)
    def tearDown(self): self.temp.cleanup()
    def test_linked_worktree_and_common_root(self):
        self.assertEqual(canonical_repo(self.wt),self.repo.resolve())
        self.assertEqual(inspect_workspace(self.t,self.repo),self.wt.resolve())
    def test_main_checkout_cannot_be_agent_worktree(self):
        with self.assertRaises(Blocked):inspect_workspace(dict(self.t,worktree=str(self.repo)),self.repo)
    def test_execute_real_synthetic_child_records_handoff(self):
        from unittest.mock import patch
        from ai_runtime.cli import execute
        from ai_runtime.registry import Registry
        state=self.root/'runtime'
        with patch('ai_runtime.cli.check_ready',return_value=(self.wt,[sys.executable,'-c','print("synthetic test child")'],{})):
            result=execute(self.t,self.repo,state)
        self.assertEqual(result['status'],'completed')
        self.assertFalse(result['canonical_review'])
        self.assertTrue((Path(result['artifacts'])/'HANDOFF.md').is_file())
        self.assertEqual(Registry(state/'registry.sqlite3').status()['active'],[])
    def test_execute_retains_out_of_scope_changes_and_blocks(self):
        from unittest.mock import patch
        from ai_runtime.cli import execute
        state=self.root/'runtime'
        code='from pathlib import Path;Path("outside.txt").write_text("preserve evidence")'
        with patch('ai_runtime.cli.check_ready',return_value=(self.wt,[sys.executable,'-c',code],{})):
            result=execute(self.t,self.repo,state)
        self.assertEqual(result['status'],'blocked_scope')
        self.assertEqual((self.wt/'outside.txt').read_text(),'preserve evidence')
    def test_wrong_origin_is_blocked(self):
        git(self.repo,'remote','set-url','origin','https://github.com/not-owner/Ductus.git')
        with self.assertRaises(Blocked):inspect_workspace(self.t,self.repo)
    def test_wrong_sha_and_dirty_worktree_blocked(self):
        with self.assertRaises(Blocked):inspect_workspace(dict(self.t,base_sha='b'*40),self.repo)
        (self.wt/'src'/'demo.txt').write_text('changed')
        with self.assertRaises(Blocked):inspect_workspace(self.t,self.repo)
    def test_other_repository_cannot_use_task(self):
        with self.assertRaises(Blocked):inspect_workspace(self.t,self.root/'elsewhere')
    def test_allowed_change_and_untracked_violation(self):
        (self.wt/'src'/'demo.txt').write_text('changed')
        self.assertEqual(audit_scope(self.t),[])
        (self.wt/'unexpected.txt').write_text('oops')
        self.assertEqual(audit_scope(self.t),['unexpected.txt'])
    def test_readonly_and_rename_violation(self):
        git(self.wt,'mv','src/demo.txt','outside.txt')
        self.assertEqual(audit_scope(self.t),['outside.txt'])
        violations=audit_scope(dict(self.t,role='reviewer',scopes=[]))
        self.assertIn('src/demo.txt',violations)
    def test_ignored_environment_file_blocks_native_dispatch(self):
        (self.wt/'.gitignore').write_text('node_modules/\n.env\n')
        git(self.wt,'add','.gitignore');git(self.wt,'commit','-m','test: ignore env')
        updated=dict(self.t,base_sha=git(self.wt,'rev-parse','HEAD').strip())
        (self.wt/'.env').write_text('SYNTHETIC=never-send')
        with self.assertRaises(Blocked):inspect_workspace(updated,self.repo)
    def test_commits_are_audited_against_original_base(self):
        (self.wt/'outside.txt').write_text('oops');git(self.wt,'add','outside.txt');git(self.wt,'commit','-m','test: oops')
        self.assertIn('outside.txt',audit_scope(self.t))

class AdapterTests(unittest.TestCase):
    def test_codex_is_native_subscription_and_sandboxed(self):
        cmd=build_command(task(),['codex'],'prompt')
        self.assertIn('workspace-write',cmd);self.assertIn('multi_agent',cmd)
        self.assertIn('forced_login_method="chatgpt"',cmd)
        self.assertNotIn('--dangerously-bypass-approvals-and-sandbox',cmd)
    def test_readonly_codex(self):
        cmd=build_command(task(role='reviewer',scopes=[]),['codex'],'prompt')
        self.assertIn('read-only',cmd)
    def test_claude_never_api_only_bare_mode(self):
        cmd=build_command(task(provider='claude',role='reviewer',scopes=[]),['claude'],'prompt')
        self.assertIn('--restricted',cmd);self.assertIn('--strict-mcp-config',cmd)
        self.assertNotIn('--bare',cmd)
    def test_grok_no_subagents_or_shell_tools(self):
        cmd=build_command(task(provider='grok',role='reviewer',scopes=[]),['grok'],'prompt')
        self.assertIn('--no-subagents',cmd);self.assertIn('--tools',cmd)
    def test_mistral_advisory_only(self):
        cmd=build_command(task(provider='mistral',role='reviewer',scopes=[]),['vibe'],'prompt')
        self.assertIn('--disabled-tools',cmd);self.assertIn('*',cmd)
    def test_meta_and_deepseek_fail_without_spawning(self):
        for provider in ('meta','deepseek'):
            with self.assertRaises(Blocked):build_command(task(provider=provider),['anything'],'prompt')
    def test_environment_drops_credentials_and_provider_redirects(self):
        env=clean_environment({'PATH':'/bin','HOME':'/tmp','OPENAI_API_KEY':'secret','ANTHROPIC_BASE_URL':'evil','GROK_HOME':'evil','GITHUB_TOKEN':'secret','VIBE_API_KEY':'secret'})
        self.assertEqual(env['PATH'],'/bin');self.assertEqual(env['HOME'],'/tmp')
        for key in ('OPENAI_API_KEY','ANTHROPIC_BASE_URL','GROK_HOME','GITHUB_TOKEN','VIBE_API_KEY'): self.assertNotIn(key,env)
    def test_common_secrets_are_redacted(self):
        self.assertNotIn('fake-token-12345',redact('Authorization: Bearer fake-token-12345'))
        self.assertNotIn('synthetic-key',redact('api_key="synthetic-key"'))

class ProcessTests(unittest.TestCase):
    def test_real_child_success_and_nonzero(self):
        with tempfile.TemporaryDirectory() as tmp:
            result=bounded_process([sys.executable,'-c','print("synthetic")'],tmp,{},timeout=5)
            self.assertEqual(result['exit_code'],0);self.assertIn('synthetic',result['output'])
            result=bounded_process([sys.executable,'-c','raise SystemExit(3)'],tmp,{},timeout=5)
            self.assertEqual(result['exit_code'],3)
    def test_timeout_terminates_only_own_child(self):
        with tempfile.TemporaryDirectory() as tmp:
            result=bounded_process([sys.executable,'-c','import time;time.sleep(15)'],tmp,{},timeout=0.2)
            self.assertEqual(result['stop_reason'],'timeout');self.assertTrue(result['exited'])
    def test_output_cap_stops_flood(self):
        with tempfile.TemporaryDirectory() as tmp:
            result=bounded_process([sys.executable,'-u','-c','print("x"*1000000)'],tmp,{},timeout=5,max_bytes=2048)
            self.assertEqual(result['stop_reason'],'output_limit');self.assertLessEqual(len(result['output']),2048)

if __name__=='__main__':unittest.main()
