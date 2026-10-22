"""Deployment paths for the pinned upstream engine and executor; no orchestration logic."""
from pathlib import Path
from harness2 import config

STUDIO = Path(__file__).resolve().parents[2]
RUNTIME = STUDIO / '.studio' / 'harness2' / 'runtime'

def configure():
    config.DEPENDENCIES = RUNTIME
    config.OPENCODE_DIR = RUNTIME / 'opencode'
    config.BUN = RUNTIME / 'tools/node_modules/.bin/bun'
    config.THIRD_PARTY = Path(__file__).resolve().parent / 'upstream'
    return config
