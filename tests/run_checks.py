#!/usr/bin/env python3
"""Run production JS in GJS without a browser or network.

GJS treats query strings in relative imports as filenames. Strip only asset-cache
queries in a temporary copy; application and test logic are otherwise unchanged.
"""
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'web' if (ROOT / 'web').is_dir() else ROOT
with tempfile.TemporaryDirectory(prefix='gpu-city-checks-') as temporary:
    work = Path(temporary)
    for source in [*WEB.glob('*.js'), *ROOT.glob('tests/*.js')]:
        target = work / (Path('tests') / source.name if source.parent.name == 'tests' else Path(source.name))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(re.sub(r'(\./[^\s\x27\x22]+\.js)\?v=[\w-]+', r'\1', source.read_text().replace('../web/', '../')))
    (work / 'data').symlink_to(WEB / 'data', target_is_directory=True)
    for test in sorted((work / 'tests').glob('test_*.js')):
        subprocess.run(['gjs', '-m', str(test)], cwd=work, check=True)
