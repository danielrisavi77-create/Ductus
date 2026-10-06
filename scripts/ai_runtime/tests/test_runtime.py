"""DAN-41: negative policy and actual SQLite concurrency tests."""
import concurrent.futures
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from ai_runtime.policy import Blocked, validate_task, validate_funding, scopes_overlap
from ai_runtime.registry import Registry

SHA = 'a' * 40

def task(**overrides):
    data = dict(id='DAN-99', owner='codex:a:platforma', role='platforma', provider='codex',
                base_sha=SHA, worktree='/isolated/a', scopes=['scripts/'],
                goal='Synthetic test', acceptance='Tests pass', risk='critical', heavy=False)
    data.update(overrides)
    return data

def evidence(now=100, **overrides):
    data = dict(provider='codex', channel='chatgpt_subscription', login_verified=True,
                extra_spend_disabled=True, included_quota_available=True,
                observed_at=now-10, expires_at=now+100, source='native-account-observation',
                executable_sha256='b'*64)
    data.update(overrides)
    return data

class PolicyTests(unittest.TestCase):
    def test_valid_task(self):
        self.assertEqual(validate_task(task())['id'], 'DAN-99')
    def test_unknown_fields_and_bad_values(self):
        for overrides in [dict(role='god'),dict(role=[]),dict(provider={}), dict(provider='openrouter'), dict(base_sha='main'),
                          dict(id='../escape'),dict(scopes=['../secret']),dict(scopes=['.git/']),
                          dict(scopes=['/etc']),dict(scopes=['src/../.env']),dict(scopes=[]),
                          dict(heavy='false'),dict(timeout=0),dict(extra='surprise')]:
            with self.subTest(overrides=overrides),self.assertRaises(Blocked):
                validate_task(task(**overrides))
    def test_orchestrator_cannot_write_code(self):
        with self.assertRaises(Blocked):
            validate_task(task(role='orchestrator'))
    def test_read_only_roles_have_no_scopes(self):
        self.assertEqual(validate_task(task(role='reviewer',scopes=[]))['role'],'reviewer')
    def test_scope_overlap_handles_ancestor_and_boundary(self):
        self.assertTrue(scopes_overlap(['src/'],['src/domain/']))
        self.assertFalse(scopes_overlap(['src/lib/'],['src/library/']))
        self.assertTrue(scopes_overlap(['src/A.ts'],['SRC/a.ts']))
    def test_funding_happy_path(self):
        validate_funding('codex',evidence(),100,'b'*64)
    def test_funding_fails_closed(self):
        for change in [dict(channel='api'),dict(login_verified=False),
                       dict(extra_spend_disabled=False),dict(included_quota_available=False),
                       dict(expires_at=90),dict(observed_at=101),dict(expires_at=1000000),
                       dict(provider='grok'),dict(executable_sha256='c'*64),dict(source=''),
                       dict(extra_spend_disabled='true')]:
            with self.subTest(change=change), self.assertRaises(Blocked):
                validate_funding('codex',evidence(**change),100,'b'*64)
    def test_missing_funding_not_assumed(self):
        with self.assertRaises(Blocked): validate_funding('codex',None,100,'b'*64)
    def test_paid_mistral_and_web_meta_never_dispatch(self):
        for provider,channel in [('mistral','subscription'),('meta','meta_web_free'),('deepseek','api')]:
            with self.subTest(provider=provider),self.assertRaises(Blocked):
                validate_funding(provider,evidence(provider=provider,channel=channel),100,'b'*64)

class RegistryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.path=Path(self.temp.name)/'state.sqlite'
        self.reg=Registry(self.path)
    def tearDown(self): self.temp.cleanup()
    def take(self,n,role='reviewer',**kwargs):
        return self.reg.acquire(task(id=f'DAN-{n}',owner=f'codex:{n}:{role}',role=role,
                           worktree=f'/isolated/{n}',scopes=[] if role not in ('backend','frontend','platforma') else [f'src/{n}/'], **kwargs),now=100,controller_pid=10001)
    def test_connection_is_closed_after_transaction(self):
        with self.reg.connect() as db:
            db.execute('SELECT 1')
        with self.assertRaises(sqlite3.ProgrammingError): db.execute('SELECT 1')
    def test_old_active_claim_visible_after_many_completed_jobs(self):
        self.take(1)
        for n in range(2,110):
            run,token=self.take(n)
            self.reg.finish(run,token,'completed')
        self.assertEqual(len(self.reg.status()['active']),1)
    def test_same_task_cannot_run_twice(self):
        self.take(1)
        with self.assertRaises(Blocked): self.take(1)
    def test_same_worktree_cannot_run_twice(self):
        self.take(1)
        with self.assertRaises(Blocked):
            self.reg.acquire(task(id='DAN-2',role='reviewer',scopes=[],worktree='/isolated/1'),now=100)
    def test_maximum_three_managed_runs(self):
        for n in range(3): self.take(n)
        with self.assertRaises(Blocked): self.take(4)
    def test_one_writer_in_catchup(self):
        self.take(1,'backend')
        with self.assertRaises(Blocked): self.take(2,'frontend')
    def test_two_writers_in_normal_mode(self):
        self.reg=Registry(self.path,mode='normal')
        self.take(1,'backend');self.take(2,'frontend')
        with self.assertRaises(Blocked): self.take(3,'platforma')
    def test_one_orchestrator(self):
        self.take(1,'orchestrator')
        with self.assertRaises(Blocked): self.take(2,'orchestrator')
    def test_only_one_heavy_job(self):
        self.take(1,heavy=True)
        with self.assertRaises(Blocked): self.take(2,heavy=True)
    def test_wrong_token_cannot_release(self):
        run,token=self.take(1)
        with self.assertRaises(Blocked): self.reg.finish(run,'wrong','completed')
        self.assertEqual(len(self.reg.status()['active']),1)
    def test_finish_releases_capacity_and_hides_token(self):
        run,token=self.take(1)
        self.reg.finish(run,token,'completed')
        self.assertEqual(len(self.reg.status()['active']),0)
        self.assertNotIn(token,str(self.reg.status()))
        self.take(1)
    def test_stale_still_holds_slot(self):
        for n in range(3): self.take(n)
        self.assertEqual(self.reg.orphans(now=1000,ttl=60),3)
        with self.assertRaises(Blocked): self.take(4)
    def test_recovery_refuses_live_and_unknown_pids(self):
        run,_=self.take(1)
        self.reg.orphans(now=1000,ttl=60)
        for alive in [True,None]:
            with self.assertRaises(Blocked): self.reg.recover(run,lambda pid:alive)
        self.reg.recover(run,lambda pid:False)
        self.assertEqual(len(self.reg.status()['active']),0)
    def test_real_concurrent_claims_have_one_winner(self):
        def race(_):
            try:
                Registry(self.path).acquire(task(),now=100)
                return True
            except Blocked: return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            self.assertEqual(sum(pool.map(race,range(8))),1)
    def test_overlapping_scopes_block_even_different_worktrees(self):
        self.reg=Registry(self.path,mode='normal')
        self.reg.acquire(task(worktree='/a',scopes=['src/']),now=100)
        with self.assertRaises(Blocked):
            self.reg.acquire(task(id='DAN-2',owner='codex:b:backend',role='backend',worktree='/b',scopes=['src/domain/']),now=100)
    def test_started_orphan_requires_process_tree_review(self):
        run,token=self.take(1)
        self.reg.heartbeat(run,token,child_pid=12345)
        self.reg.orphans(now=time.time()+200,ttl=90)
        with self.assertRaises(Blocked):self.reg.recover(run,lambda pid:False)
    def test_registry_mode_cannot_silently_change(self):
        self.take(1,'backend')
        with self.assertRaises(Blocked): Registry(self.path,mode='normal')

if __name__=='__main__':unittest.main()
