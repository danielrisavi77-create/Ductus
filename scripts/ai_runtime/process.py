"""Bounded child execution. No persistent daemon or arbitrary process killer."""
import os
import signal
import subprocess
import threading
import time
from .providers import clean_environment, redact

def bounded_process(command, cwd, env, timeout=600, max_bytes=1024*1024, stdin_text=None, heartbeat=None):
    result=bytearray();over=threading.Event()
    flags={'creationflags':subprocess.CREATE_NEW_PROCESS_GROUP} if os.name=='nt' else {'start_new_session':True}
    p=subprocess.Popen(command,cwd=cwd,env=clean_environment(env),stdin=subprocess.PIPE,
                       stdout=subprocess.PIPE,stderr=subprocess.STDOUT,**flags)
    def reader():
        while True:
            chunk=p.stdout.read(4096)
            if not chunk:break
            remaining=max_bytes-len(result)
            result.extend(chunk[:max(remaining,0)])
            if len(chunk)>remaining:over.set()
    thread=threading.Thread(target=reader,daemon=True);thread.start()
    reason=None;start=time.monotonic();last=0
    try:
        if stdin_text:p.stdin.write(stdin_text.encode('utf-8'))
        p.stdin.close()
        while p.poll() is None:
            now=time.monotonic()
            if heartbeat and now-last>3:heartbeat(p.pid);last=now
            if over.is_set():reason='output_limit';break
            if now-start>=timeout:reason='timeout';break
            time.sleep(.04)
    finally:
        if p.poll() is None:
            if os.name=='nt':
                subprocess.run(['taskkill','/PID',str(p.pid),'/T','/F'],capture_output=True,timeout=15)
            else:
                try:os.killpg(p.pid,signal.SIGKILL)
                except ProcessLookupError:pass
            p.wait(timeout=15)
        if os.name!='nt':
            try:os.killpg(p.pid,signal.SIGKILL)
            except ProcessLookupError:pass
        thread.join(timeout=2)
        if not p.stdin.closed:p.stdin.close()
        if not thread.is_alive():p.stdout.close()
    if over.is_set():reason='output_limit'
    return {'pid':p.pid,'exit_code':p.returncode,'exited':p.poll() is not None and not thread.is_alive(),
            'stop_reason':reason,'output':redact(result.decode('utf-8',errors='replace'))}
