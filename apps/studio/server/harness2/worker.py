"""Stack Proc host adapter for the upstream Harness2/OpenCode substrate.

No inference or model/tool loop is implemented here. OpenCode owns execution;
Harness2 owns tree installation and (in refinement mode) recursion/selection.
Secrets arrive on stdin and are passed to the child in memory, never written.
"""
from __future__ import annotations
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import threading
from types import SimpleNamespace
from paths import STUDIO, configure
from harness2.core import tree as HT
from harness2.substrate.opencode import OpencodeSubstrate, compose_prompt

PIN = '1cfe254e8d25b15f37048c3730134686abe60335'
config = configure()

def emit(kind, **fields):
    print(json.dumps({'type': kind, **fields}), flush=True)

def verify():
    dist = importlib.metadata.distribution('harness2')
    direct = json.loads(dist.read_text('direct_url.json') or '{}')
    if direct.get('vcs_info', {}).get('commit_id') != PIN:
        raise RuntimeError('Harness2 installed revision does not match the lock.')
    revision = subprocess.check_output(['git', '-C', str(config.OPENCODE_DIR), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != config.DEPENDENCY_PINS['opencode']:
        raise RuntimeError('OpenCode installed revision does not match Harness2 pin.')
    OpencodeSubstrate().preflight()
    return {'engine': 'harness2', 'revision': PIN, 'executor': 'opencode', 'executorRevision': revision}

def environment(root: Path, payload, *, refinement=False):
    # Deliberately do not copy developer provider keys, proxy vars or home config.
    env = {key: os.environ[key] for key in ('PATH', 'TMPDIR', 'SYSTEMROOT') if key in os.environ}
    private = root / '.executor'
    private.mkdir(mode=0o700, parents=True, exist_ok=True)
    for key, name in [('HOME', 'home'), ('XDG_CONFIG_HOME', 'config'), ('XDG_DATA_HOME', 'data'), ('XDG_STATE_HOME', 'state'), ('XDG_CACHE_HOME', 'cache')]:
        folder = private / name
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        env[key] = str(folder)
    permission = {'*': 'deny', 'stackproc_*': 'allow'}
    if refinement:
        permission = {'*': 'deny', 'read': {str(root)+'/**': 'allow', '*': 'deny'}, 'edit': {str(root)+'/**': 'allow', '*': 'deny'}, 'list': 'allow', 'glob': 'allow', 'grep': 'allow'}
    provider = {
        'npm': '@ai-sdk/anthropic',
        'name': 'Workspace MiniMax',
        'options': {'baseURL': 'https://api.minimax.io/anthropic/v1', 'apiKey': '{env:STACKPROC_MINIMAX_KEY}'},
        'models': {payload['model']: {'name': payload['model'], 'limit': {'context': 196608, 'output': payload['outputTokens']}}},
    }
    settings = {
        '$schema': 'https://opencode.ai/config.json',
        'model': 'minimax/'+payload['model'],
        'small_model': 'minimax/'+payload['model'],
        'enabled_providers': ['minimax'],
        'provider': {'minimax': provider},
        'permission': permission,
        'share': 'disabled', 'autoupdate': False,
        'agent': {'build': {'steps': payload['steps'], 'permission': permission}},
    }
    if payload.get('bridge') and not refinement:
        settings['mcp'] = {'stackproc': {'type': 'remote', 'url': payload['bridge']['url'], 'headers': {'Authorization': 'Bearer '+payload['bridge']['token']}, 'oauth': False}}
    env.update({
        'STACKPROC_MINIMAX_KEY': payload['secret'],
        'OPENCODE_CONFIG_CONTENT': json.dumps(settings),
        'OPENCODE_DISABLE_PROJECT_CONFIG': 'true',
        'OPENCODE_DISABLE_AUTOUPDATE': 'true',
        'OPENCODE_DISABLE_SHARE': 'true',
        'OPENCODE_DISABLE_DEFAULT_PLUGINS': 'true',
        'OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX': str(payload['outputTokens']),
    })
    return env

def execute(payload):
    provenance = verify()
    root = Path(payload['root']).resolve()
    allowed = (STUDIO / '.studio' / 'harness2' / 'workspaces').resolve()
    if not root.is_relative_to(allowed):
        raise ValueError('Executor root must be a private workspace run directory.')
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    source = Path(__file__).resolve().parent / 'baseline'
    if payload.get('harnessTree'):
        source = root / 'adopted-harness'
        HT.write_tree(OpencodeSubstrate().surface(), payload['harnessTree'], source, stubs=False)
    substrate = OpencodeSubstrate()
    staged = substrate.materialise(source, SimpleNamespace(install_mode='workspace_config'), {})
    child = None
    try:
        # Preserve workspace-native state across activations without sharing other tenants.
        for name in substrate.surface().always_on:
            origin = staged.staging_dir / name
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(origin, target)
        env = environment(root, payload)
        system = compose_prompt(staged.staging_dir).replace('{{ instruction }}', '')
        settings = json.loads(env['OPENCODE_CONFIG_CONTENT'])
        settings['agent']['build']['prompt'] = system
        env['OPENCODE_CONFIG_CONTENT'] = json.dumps(settings)
        emit('provenance', **provenance, harnessFingerprint=staged.fingerprint)
        argv = substrate.run_argv('', root, 'minimax/'+payload['model'], title='Stack Proc workspace work', session=payload.get('sessionId'))
        # OpenCode's upstream CLI reads the prompt from stdin; no customer prompt in argv.
        child = subprocess.Popen(argv, cwd=root, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
        def terminate(*_):
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
        signal.signal(signal.SIGTERM, terminate)
        signal.signal(signal.SIGINT, terminate)
        timer = threading.Timer(payload.get('timeout', 180), terminate)
        timer.start()
        child.stdin.write(payload['prompt'])
        child.stdin.close()
        # Drain stderr concurrently; never forward unfiltered provider/runtime logs to UI.
        errors = []
        def drain():
            for line in child.stderr:
                errors.append(line[-500:])
                if len(errors) > 10: errors.pop(0)
        thread = threading.Thread(target=drain, daemon=True)
        thread.start()
        for line in child.stdout:
            if len(line) > 2*1024*1024:
                terminate()
                raise RuntimeError('Executor event exceeded the event limit.')
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            # Private reasoning is never projected into application activity.
            if event.get('type') in ('step_start', 'step_finish', 'text', 'tool_use', 'error'):
                emit('executor_event', event=event)
        code = child.wait()
        timer.cancel()
        if code:
            raise RuntimeError(f'OpenCode executor exited with status {code}.')
        emit('executor_complete')
    finally:
        if child is not None and child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            child.wait(timeout=10)
        shutil.rmtree(staged.staging_dir, ignore_errors=True)

def main():
    payload = json.loads(sys.stdin.read(512*1024))
    if payload.get('command') == 'check':
        emit('provenance', **verify())
    elif payload.get('command') == 'execute':
        execute(payload)
    elif payload.get('command') == 'refine':
        from refinement import refine
        refine(payload, verify(), environment)
    else:
        raise ValueError('Unsupported Harness2 host command.')

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit('host_error', message=str(error)[:500])
        sys.exit(1)
