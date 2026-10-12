#!/usr/bin/env python3
"""Run real GNOME Shell/Wayland integration tests on a private headless desktop."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--extension', type=Path, required=True)
parser.add_argument('--work', type=Path, required=True, help='New directory for isolated session and results')
args = parser.parse_args()
work = args.work.resolve()
work.mkdir(parents=True)
for name in ['data', 'config', 'cache', 'runtime']:
    (work / name).mkdir(mode=0o700)
extensions = work / 'data/gnome-shell/extensions'
shutil.copytree(args.extension, extensions / 'lolping-ubuntu@local')
harness = extensions / 'lolping-test@local'
harness.mkdir()
shutil.copyfile(Path(__file__).with_name('integration.js'), harness / 'extension.js')
(harness / 'metadata.json').write_text(json.dumps(dict(uuid='lolping-test@local', name='lolPing Integration Test',
    description='Isolated test runner', **{'shell-version': ['46']})))
env = os.environ.copy()
# Wayland's Unix socket path is limited to 108 bytes; workspaces can be much longer.
runtime = tempfile.TemporaryDirectory(prefix='lolping-test-')
for name in ['DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'SESSION_MANAGER']:
    env.pop(name, None)
env.update(XDG_DATA_HOME=str(work / 'data'), XDG_CONFIG_HOME=str(work / 'config'),
           XDG_CACHE_HOME=str(work / 'cache'), XDG_RUNTIME_DIR=runtime.name,
           GSETTINGS_BACKEND='keyfile', XDG_SESSION_TYPE='wayland', XDG_CURRENT_DESKTOP='GNOME',
           LIBGL_ALWAYS_SOFTWARE='1', LOLPING_TEST_DIR=str(work), GNOME_SHELL_SLOWDOWN_FACTOR='1')
subprocess.run(['gsettings', 'set', 'org.gnome.shell', 'enabled-extensions',
                "['lolping-ubuntu@local', 'lolping-test@local']"], env=env, check=True)
subprocess.run(['gsettings', 'set', 'org.gnome.shell', 'disable-user-extensions', 'false'], env=env, check=True)
with (work / 'shell.log').open('w') as log:
    try:
        run = subprocess.run(['dbus-run-session', '--', 'gnome-shell', '--headless', '--wayland',
                              '--virtual-monitor', '1280x800', '--virtual-monitor', '1024x768',
                              '--no-x11', '--sm-disable', '--force-animations'],
                             env=env, stdout=log, stderr=subprocess.STDOUT, timeout=70)
    except subprocess.TimeoutExpired:
        print(f'Timed out. See {work / "shell.log"}')
        sys.exit(1)
runtime.cleanup()
result = work / 'result.json'
if not result.exists():
    print((work / 'shell.log').read_text()[-10000:])
    sys.exit(1)
data = json.loads(result.read_text())
print(json.dumps(data, indent=2, ensure_ascii=False))
sys.exit(0 if data['ok'] else 1)
