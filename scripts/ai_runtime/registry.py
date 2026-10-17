"""Single-host SQLite lock for read-only runs. Stale jobs retain their slots.

This is a local concurrency guard (one run per worktree, bounded parallel use of
subscription quota). It is not task assignment: Linear and the orchestrator own that.
"""
from contextlib import contextmanager
import hashlib
import os
import secrets
import sqlite3
import time
from pathlib import Path
from .policy import ACTIVE, Blocked, validate_task

MAX_RUNS=3

class Registry:
    def __init__(self,path:Path):
        self.path=Path(path)
        self.path.parent.mkdir(parents=True,exist_ok=True)
        # No write when the tables exist: opening the registry costs no durable commit.
        with self.connect() as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS runs(
                id TEXT PRIMARY KEY,task TEXT NOT NULL,owner TEXT NOT NULL,role TEXT NOT NULL,
                provider TEXT NOT NULL,worktree TEXT NOT NULL,base_sha TEXT NOT NULL,
                status TEXT NOT NULL,heavy INTEGER NOT NULL,created REAL NOT NULL,heartbeat REAL NOT NULL,
                controller_pid INTEGER NOT NULL,child_pid INTEGER,token_hash TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,time REAL,run TEXT,kind TEXT);''')
    @contextmanager
    def connect(self):
        db=sqlite3.connect(self.path,timeout=15)
        db.row_factory=sqlite3.Row
        db.execute('PRAGMA busy_timeout=15000')
        try:
            with db:
                yield db
        finally:
            db.close()
    def acquire(self,task:dict,now:float|None=None,controller_pid:int|None=None):
        t=validate_task(task); now=time.time() if now is None else now
        token=secrets.token_hex(32); run=secrets.token_hex(12)
        wt=os.path.normcase(str(Path(t['worktree']).resolve())).casefold()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            rows=db.execute("SELECT * FROM runs WHERE status IN ('reserved','running','orphaned')").fetchall()
            if len(rows)>=MAX_RUNS: raise Blocked('blocked_capacity: three read-only runs')
            for row in rows:
                if row['task'].casefold()==t['id'].casefold(): raise Blocked('blocked_task_claim')
                if row['worktree']==wt: raise Blocked('blocked_worktree_claim')
                if row['owner']==t['owner']: raise Blocked('blocked_owner_claim')
                if t['heavy'] and row['heavy']: raise Blocked('blocked_heavy_capacity')
                if t['provider'] in ('grok','mistral') and row['provider']==t['provider']:
                    raise Blocked('blocked_provider_capacity')
            db.execute('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (run,t['id'],t['owner'],t['role'],t['provider'],wt,t['base_sha'],
                 'reserved',int(t['heavy']),now,now,controller_pid or os.getpid(),None,hashlib.sha256(token.encode()).hexdigest()))
            db.execute('INSERT INTO events(time,run,kind) VALUES(?,?,?)',(now,run,'reserved'))
        return run,token
    def _owned(self,db,run,token):
        row=db.execute('SELECT * FROM runs WHERE id=?',(run,)).fetchone()
        if not row or not secrets.compare_digest(row['token_hash'],hashlib.sha256(token.encode()).hexdigest()):
            raise Blocked('blocked_ownership')
        if row['status'] not in ACTIVE: raise Blocked('blocked_terminal_run')
        return row
    def heartbeat(self,run,token,child_pid=None):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE'); self._owned(db,run,token)
            db.execute("UPDATE runs SET status='running',heartbeat=?,child_pid=COALESCE(?,child_pid) WHERE id=?",(time.time(),child_pid,run))
    def finish(self,run,token,status):
        if status not in ('completed','failed','blocked_write','blocked_runtime','cancelled'):
            raise Blocked('blocked_status')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE');self._owned(db,run,token)
            db.execute('UPDATE runs SET status=?,heartbeat=? WHERE id=?',(status,time.time(),run))
            db.execute('INSERT INTO events(time,run,kind) VALUES(?,?,?)',(time.time(),run,status))
    def orphans(self,now=None,ttl=90):
        now=time.time() if now is None else now
        with self.connect() as db:
            return db.execute("UPDATE runs SET status='orphaned' WHERE status IN ('reserved','running') AND heartbeat < ?",(now-ttl,)).rowcount
    def recover(self,run,pid_alive):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT * FROM runs WHERE id=?',(run,)).fetchone()
            if not row or row['status']!='orphaned': raise Blocked('blocked_recovery: not orphaned')
            if row['child_pid'] is not None:
                raise Blocked('blocked_recovery: started process tree requires independent review')
            # Unknown or reused PIDs fail closed. No killing arbitrary PIDs.
            if any(pid_alive(pid) is not False for pid in (row['controller_pid'],row['child_pid']) if pid):
                raise Blocked('blocked_recovery: process alive or liveness unknown')
            db.execute("UPDATE runs SET status='cancelled',heartbeat=? WHERE id=?",(time.time(),run))
            db.execute('INSERT INTO events(time,run,kind) VALUES(?,?,?)',(time.time(),run,'recovered_after_confirmed_exit'))
    def status(self,history_limit:int=100):
        with self.connect() as db:
            active=[dict(r) for r in db.execute(
                "SELECT id,task,owner,role,provider,worktree,base_sha,status,heavy,heartbeat,controller_pid,child_pid "
                "FROM runs WHERE status IN ('reserved','running','orphaned') ORDER BY created")]
            history=[dict(r) for r in db.execute(
                "SELECT id,task,owner,role,provider,worktree,base_sha,status,heavy,heartbeat,controller_pid,child_pid "
                "FROM runs WHERE status NOT IN ('reserved','running','orphaned') ORDER BY created DESC LIMIT ?",
                (int(history_limit),))]
        return dict(active=active,history=history,limits=dict(read_only_runs=MAX_RUNS,heavy=1),
                    boundary='single-host read-only runs only; external chats/processes are not controlled')
