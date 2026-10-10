"""Credential isolation, redaction and reservation-release tests; synthetic files only."""
import hashlib
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from ai_runtime import cli
from ai_runtime.policy import Blocked, CHANNELS
from ai_runtime.providers import (ISOLATION, PROMPT_FILE, IsolatedProfile, build_command,
                                  clean_environment, redact, redact_tree, require_isolation)
from ai_runtime.registry import Registry
from test_cli import run_cli
from test_execution import GitFixture, LOGIN, MARK, PLANTED
from test_runtime import task

# The synthetic "provider" looks for files the way a CLI or a prompt-injected
# read does: through the user-directory variables and through "~".
PROBE='''
import hashlib,json,os
from pathlib import Path
names=("HOME","USERPROFILE","APPDATA","LOCALAPPDATA","XDG_CONFIG_HOME","XDG_CACHE_HOME",
       "XDG_DATA_HOME","XDG_STATE_HOME","TEMP","TMP","TMPDIR","VIBE_HOME")
roots={name:os.environ.get(name) for name in names}
roots["EXPANDUSER"]=os.path.expanduser("~");roots["PATH_HOME"]=str(Path.home())
seen={}
# Temporary directories are reported but not walked: only user-directory roots can hold the login.
for root in sorted({value for name,value in roots.items() if value and not name.startswith("T")}):
    for folder,_,files in os.walk(root):
        for name in files:
            file=Path(folder)/name
            seen[file.as_posix()]=hashlib.sha256(file.read_bytes()).hexdigest()
print(json.dumps({"roots":roots,"seen":seen,"inherited":sorted(os.environ)}))
'''

def fake(prefix,body):
    """Assemble a synthetic token at run time so no token-shaped literal is committed."""
    return prefix+body

SECRETS={
    'github fine-grained':fake('github'+'_pat_','11ABCDEFG0'+'aB3'*8+'_'+'xY9'*14),
    'github classic':fake('gh'+'p_','aB3dE6'*6),
    'github oauth':fake('gh'+'o_','aB3dE6'*6),
    'github user':fake('gh'+'u_','aB3dE6'*6),
    'github server':fake('gh'+'s_','aB3dE6'*6),
    'github refresh':fake('gh'+'r_','aB3dE6'*6),
    'openai':fake('s'+'k-','proj-'+'aB3dE6'*6),
    'anthropic':fake('s'+'k-','ant-api03-'+'aB3dE6'*6),
    'xai':fake('xa'+'i-','aB3dE6'*8),
    'gitlab':fake('glp'+'at-','aB3dE6'*4),
    'npm':fake('np'+'m_','aB3dE6'*6),
    'slack':fake('xo'+'xb-','123456-'+'aB3dE6'*3),
    'aws':fake('AK'+'IA','ABCDEFGH12345678'),
    'google':fake('AI'+'za','aB3dE6'*6),
    'jwt':fake('ey'+'J','hbGciOiJub25l.'+'eyJzdWIiOiJzeW50aGV0aWMi.'+'c3ludGhldGlj'),
}

class RedactionTests(unittest.TestCase):
    def test_recognisable_token_shapes_are_redacted_wherever_they_appear(self):
        for name,secret in SECRETS.items():
            for text in (secret,'value '+secret+' trailing','{"note":"'+secret+'"}','x='+secret+';'):
                with self.subTest(name=name,text=text[:12]):
                    self.assertNotIn(secret,redact(text))
                    self.assertIn('[REDACTED]',redact(text))
    def test_review_finding_inputs_are_redacted(self):
        pat=SECRETS['github fine-grained']
        self.assertEqual(redact('oauth_token: '+pat),'oauth_token: [REDACTED]')
        self.assertEqual(redact('    oauth_token: unprefixed-synthetic-value'),'    oauth_token: [REDACTED]')
        self.assertNotIn(pat,redact(pat))
    def test_secret_key_names_hide_values_without_a_known_shape(self):
        value='plain-synthetic-value-0001'
        for text in ('oauth_token: '+value,'"refresh_token": "'+value+'"','"access_token":"'+value+'"',
                     "id_token = '"+value+"'",'MISTRAL_API_KEY='+value,'XAI_API_KEY="'+value+'"',
                     'client_secret: '+value,'password='+value,'passwd: '+value,'apikey: '+value,
                     'GITHUB_TOKEN='+value,'token: '+value,'private_key: '+value,
                     'Authorization: Bearer '+value,'authorization: token '+value,
                     '"Authorization": "Basic '+value+'"','Proxy-Authorization: Bearer '+value,
                     'https://synthetic-user:'+value+'@example.invalid/repo.git'):
            with self.subTest(text=text):
                self.assertNotIn(value,redact(text));self.assertIn('[REDACTED]',redact(text))
    def test_private_key_block_is_redacted(self):
        body='c3ludGhldGljLWtleS1ib2R5'
        text='before\n-----BEGIN OPENSSH '+'PRIVATE KEY-----\n'+body+'\n-----END OPENSSH '+'PRIVATE KEY-----\nafter'
        self.assertNotIn(body,redact(text));self.assertIn('before',redact(text));self.assertIn('after',redact(text))
    def test_ordinary_review_text_survives(self):
        for text in ('{"input_tokens": 1200, "output_tokens": 44}','max_tokens=16000',
                     'src/lib/token.ts:12 the token is compared with ===','Review-Verdict: PASS',
                     'see https://example.invalid/docs/tokens for details','commit '+'a'*40):
            with self.subTest(text=text):self.assertEqual(redact(text),text)
    def test_tree_redaction_reaches_nested_strings_and_keeps_other_types(self):
        secret=SECRETS['github oauth']
        data={'a':[{'b':'oauth_token: '+secret}],'n':3,'f':False,'none':None}
        clean=redact_tree(data)
        self.assertNotIn(secret,json.dumps(clean))
        self.assertEqual((clean['n'],clean['f'],clean['none']),(3,False,None))

class AdapterIsolationPolicyTests(unittest.TestCase):
    def test_only_mistral_is_enabled_and_every_channel_has_a_declared_profile(self):
        self.assertEqual(set(ISOLATION),set(CHANNELS))
        self.assertEqual(sorted(p for p,spec in ISOLATION.items() if spec['enabled']),['mistral'])
        for provider,spec in ISOLATION.items():
            with self.subTest(provider=provider):
                self.assertTrue(spec['login']);self.assertTrue(spec['home_env'].endswith('_HOME'))
                self.assertEqual(bool(spec['reason']),not spec['enabled'])
    def test_disabled_adapters_refuse_with_named_reason_and_never_build_a_profile(self):
        for provider in ('codex','grok'):
            with self.subTest(provider=provider):
                with self.assertRaises(Blocked) as caught:require_isolation(provider)
                self.assertIn('blocked_isolation: '+provider+' adapter is disabled',str(caught.exception))
                with patch('ai_runtime.providers.tempfile.mkdtemp') as make, \
                        patch('ai_runtime.providers.user_home') as home,self.assertRaises(Blocked):
                    IsolatedProfile(provider)
                make.assert_not_called();home.assert_not_called()
        with self.assertRaises(Blocked):require_isolation('claude')
    def test_check_and_run_refuse_a_disabled_adapter_before_reading_evidence_or_spawning(self):
        with tempfile.TemporaryDirectory() as tmp,patch('ai_runtime.cli.runtime_home',return_value=Path(tmp)), \
                patch('ai_runtime.cli.bounded_process') as spawn,patch('ai_runtime.cli.read_json',wraps=cli.read_json) as read:
            for provider in ('codex','grok'):
                (Path(tmp)/'evidence').mkdir(exist_ok=True)
                (Path(tmp)/'evidence'/f'{provider}.json').write_text('{}')
                file=Path(tmp)/'task.json';file.write_text(json.dumps(task(provider=provider)))
                for action in ('check','run'):
                    code,data=run_cli(action,str(file))
                    with self.subTest(provider=provider,action=action):
                        self.assertEqual(code,2);self.assertIn('blocked_isolation',data['reason'])
            spawn.assert_not_called()
            self.assertEqual([c.args[0] for c in read.call_args_list],[str(file)]*4)
            self.assertFalse((Path(tmp)/'runs').exists())
    def test_roster_names_enabled_providers(self):
        code,data=run_cli('roster')
        self.assertEqual((code,data['enabled_providers']),(0,['mistral']))
    def test_no_adapter_puts_the_prompt_on_the_command_line(self):
        for provider in CHANNELS:
            cmd=build_command(task(provider=provider,goal='UNIQUE-GOAL-TEXT'),['x'])
            with self.subTest(provider=provider):
                self.assertFalse([arg for arg in cmd if 'UNIQUE-GOAL-TEXT' in arg or '\n' in arg])
                self.assertNotIn('--single',cmd)
        grok=build_command(task(provider='grok'),['grok'])
        self.assertEqual(grok[-2:],['--prompt-file',PROMPT_FILE])
        self.assertEqual(build_command(task(provider='mistral'),['vibe'])[-1],'--prompt')
        self.assertEqual(build_command(task(provider='codex'),['codex'])[-1],'-')
    def test_controller_paths_override_inherited_ones_but_inherited_redirects_stay_dropped(self):
        from ai_runtime.process import bounded_process
        code='import os;print(os.environ.get("VIBE_HOME"),os.environ.get("GROK_HOME"),os.environ.get("HOME"))'
        with tempfile.TemporaryDirectory() as tmp:
            result=bounded_process([sys.executable,'-c',code],tmp,
                                   {'SYSTEMROOT':os.environ.get('SYSTEMROOT',''),'HOME':'inherited',
                                    'VIBE_HOME':'inherited','GROK_HOME':'inherited'},timeout=20,
                                   env_overrides={'HOME':'chosen','VIBE_HOME':'chosen'})
        self.assertEqual(result['output'].split(),['chosen','None','chosen'])
        self.assertNotIn('VIBE_HOME',clean_environment({'VIBE_HOME':'inherited'}))

class IsolatedRunTests(GitFixture):
    def test_child_sees_only_the_login_and_none_of_the_planted_credentials(self):
        home=self.user_directory().resolve()
        result,_=self.run_child(PROBE,home=home)
        self.assertEqual(result['status'],'completed');self.assertIs(result['profile_removed'],True)
        text=(Path(result['artifacts'])/'output.txt').read_text(encoding='utf-8')
        self.assertNotIn(MARK,text)
        seen=json.loads(text)
        roots={name:Path(value) for name,value in seen['roots'].items() if value}
        self.assertEqual(set(seen['roots'])-set(roots),set())
        child_home=roots['HOME']
        for name,root in roots.items():
            with self.subTest(variable=name):
                self.assertNotEqual(root,home);self.assertNotIn(home,root.parents)
                self.assertIn(child_home.parent,[root,*root.parents])
        self.assertEqual({roots['USERPROFILE'],roots['EXPANDUSER'],roots['PATH_HOME']},{child_home})
        files={Path(path).relative_to(child_home).as_posix():digest for path,digest in seen['seen'].items()}
        self.assertEqual(set(files),{'.vibe/.env','.vibe/config.toml'})
        self.assertEqual(files['.vibe/.env'],hashlib.sha256(LOGIN.encode()).hexdigest())
        for name in ('GITHUB_TOKEN','GH_TOKEN','MISTRAL_API_KEY','OPENAI_API_KEY'):
            self.assertNotIn(name,seen['inherited'])
        # The profile is gone afterwards and the user's own files were only read.
        self.assertFalse(child_home.parent.exists())
        for relative in PLANTED:self.assertEqual((home/relative).read_text(encoding='utf-8'),MARK)
        self.assertEqual((home/'.vibe'/'.env').read_bytes(),LOGIN.encode())
    def test_profile_is_removed_when_the_child_fails_or_times_out(self):
        result,_=self.run_child('import os;print(os.environ["HOME"]);raise SystemExit(7)')
        self.assertEqual((result['status'],result['exit_code'],result['profile_removed']),('failed',7,True))
        child_home=Path((Path(result['artifacts'])/'output.txt').read_text(encoding='utf-8').strip())
        self.assertFalse(child_home.parent.exists())
        self.wt=self.worktree();self.t=task(worktree=str(self.wt),base_sha=self.sha,provider='mistral',timeout=1)
        result,_=self.run_child('import os,time;print(os.environ["HOME"],flush=True);time.sleep(30)')
        self.assertEqual((result['status'],result['stop_reason'],result['profile_removed']),('failed','timeout',True))
        child_home=Path((Path(result['artifacts'])/'output.txt').read_text(encoding='utf-8').strip())
        self.assertFalse(child_home.parent.exists())
    def test_unremovable_profile_is_reported_and_the_run_is_not_completed(self):
        with patch('ai_runtime.providers.IsolatedProfile.remove',return_value=False):
            result,_=self.run_child('print("synthetic")')
        self.addCleanup(shutil.rmtree,result['profile_path'],True)
        self.assertEqual((result['status'],result['profile_removed']),('failed',False))
        self.assertTrue(Path(result['profile_path']).name.startswith('ductus-run-'))
    def test_missing_login_fails_closed_without_spawning_and_releases_the_slot(self):
        with patch('ai_runtime.cli.bounded_process') as spawn:
            result,state=self.run_child('print("never")',home=self.user_directory(login=False))
        spawn.assert_not_called()
        self.assertEqual(result['status'],'blocked_runtime');self.assertIn('blocked_isolation',result['reason'])
        self.assertEqual(Registry(state/'review-registry.sqlite3').status()['active'],[])
    def test_disabled_adapter_cannot_run_even_if_readiness_is_bypassed(self):
        for provider in ('codex','grok'):
            self.wt=self.worktree();self.t=task(worktree=str(self.wt),base_sha=self.sha,provider=provider,
                                               id=f'DAN-{provider}',owner=f'{provider}:a:reviewer')
            with self.subTest(provider=provider),patch('ai_runtime.cli.bounded_process') as spawn:
                result,state=self.run_child('print("never")')
                spawn.assert_not_called()
                self.assertEqual(result['status'],'blocked_runtime');self.assertIn('blocked_isolation',result['reason'])
                self.assertEqual(Registry(state/'review-registry.sqlite3').status()['active'],[])
    def test_prompt_reaches_the_child_on_stdin_and_never_as_an_argument(self):
        self.t=dict(self.t,goal='UNIQUE-GOAL-TEXT')
        result,_=self.run_child('import sys;print(len(sys.argv));print("UNIQUE-GOAL-TEXT" in sys.stdin.read())')
        text=(Path(result['artifacts'])/'output.txt').read_text(encoding='utf-8').split()
        self.assertEqual(text,['1','True'])
    def test_prompt_file_placeholder_resolves_inside_the_profile_and_is_deleted(self):
        home=self.user_directory()
        with patch('ai_runtime.providers.user_home',return_value=home):profile=IsolatedProfile('mistral')
        try:
            command=profile.command(['tool','--prompt-file',PROMPT_FILE],'synthetic prompt')
            file=Path(command[-1])
            self.assertEqual(file.read_text(encoding='utf-8'),'synthetic prompt')
            self.assertEqual(file.parent,profile.root);self.assertNotIn(self.wt.resolve(),file.parents)
        finally:self.assertTrue(profile.remove())
        self.assertFalse(file.exists())
    def test_output_reason_and_task_copy_are_redacted_on_disk(self):
        secret=SECRETS['github fine-grained'];other=SECRETS['github oauth']
        self.t=dict(self.t,goal='Synthetic goal quoting oauth_token: '+other)
        code='print("oauth_token: "+"'+secret[:11]+'"+"'+secret[11:]+'");print("'+other[:4]+'"+"'+other[4:]+'")'
        result,state=self.run_child(code)
        folder=Path(result['artifacts'])
        for name in ('output.txt','task.json','result.json','HANDOFF.md'):
            text=(folder/name).read_text(encoding='utf-8')
            with self.subTest(file=name):
                self.assertNotIn(secret,text);self.assertNotIn(other,text)
        self.assertIn('[REDACTED]',(folder/'output.txt').read_text(encoding='utf-8'))
        self.assertIn('[REDACTED]',(folder/'task.json').read_text(encoding='utf-8'))
        self.wt=self.worktree();self.t=task(worktree=str(self.wt),base_sha=self.sha,provider='mistral',id='DAN-98',owner='mistral:b:reviewer')
        with patch('ai_runtime.cli.bounded_process',side_effect=RuntimeError('failed with oauth_token: '+secret)):
            result,_=self.run_child('print("never")',state=state)
        self.assertNotIn(secret,json.dumps(result));self.assertIn('[REDACTED]',result['reason'])
        self.assertNotIn(secret,(Path(result['artifacts'])/'result.json').read_text(encoding='utf-8'))
    def test_failed_run_folder_creation_releases_the_reservation(self):
        state=self.root/f'runtime-{next(self.counter)}';state.mkdir()
        (state/'runs').write_text('a file where the runs directory should be')
        with patch('ai_runtime.cli.bounded_process') as spawn:
            result,_=self.run_child('print("never")',state=state)
        spawn.assert_not_called()
        self.assertEqual(result['status'],'blocked_runtime');self.assertIsNone(result['artifacts'])
        self.assertIn('reason',result);self.assertIs(result['canonical_review'],False)
        registry=Registry(state/'review-registry.sqlite3')
        self.assertEqual(registry.status()['active'],[])
        self.assertEqual([row['status'] for row in registry.status()['history']],['blocked_runtime'])
        # The same task, worktree and owner can be claimed again straight away.
        (state/'runs').unlink()
        result,_=self.run_child('print("after recovery")',state=state)
        self.assertEqual(result['status'],'completed')

if __name__=='__main__':unittest.main()
