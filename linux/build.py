#!/usr/bin/env python3
"""Build a self-contained GNOME extension; Python + glib-compile-schemas only.

Extract the supported upstream catalog records, validate every asset, and fail if
upstream's source format changes. No npm, Electron, root access, or downloads.
"""
import argparse
import ast
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
UUID = 'lolping-ubuntu@local'


def catalogs():
    text = (ROOT / 'src/shared/pings.ts').read_text()
    pings = []
    names = ['危险', '推进', '正在路上', '全力进攻', '请求协助', '需要视野', '敌人消失', '敌方视野', '普通信号', '诱饵', '视野已清除']
    for record in re.findall(r'\{ id: .*? \}', text):
        fields = dict(re.findall(r"(id|name|icon|sound|color): '([^']*)'", record))
        art = ast.literal_eval(re.search(r'art: (\[[^]]+\])', record)[1])
        pings.append(dict(id=fields['id'], name=fields['name'],
                          icon=f"textures/{fields['icon']}.png",
                          art=[f'textures/{a}.png' for a in art],
                          sound=f"sounds/{fields['sound']}.wav", color=fields['color']))
    assert len(pings) == 11, 'Upstream ping catalog changed; update adapter'
    for ping, name in zip(pings, names):
        ping['name'] = name
    text = (ROOT / 'src/shared/emoteCatalog.ts').read_text()
    slugs = ast.literal_eval(re.search(r'DEFAULT_EMOTE_WHEEL[^=]*= (\[[^]]+\])', text)[1])
    emotes = []
    for slug in slugs:
        record = next(line for line in text.splitlines() if f"slug: '{slug}'" in line)
        name = ast.literal_eval(re.search(r"nameZh: ('(?:\\.|[^'])*')", record)[1])
        emotes.append(dict(id=slug, name=name, icon=f'emotes/{slug}.png',
                           art=[f'emotes/{slug}.png'], sound=f'emotes/{slug}.ogg', color='#c8aa6e'))
    assert len(emotes) == 8
    return pings, emotes


def build(stage, output):
    stage.mkdir(parents=True)
    source = ROOT / 'linux/gnome'
    shutil.copytree(source, stage, dirs_exist_ok=True)
    pings, emotes = catalogs()
    (stage / 'catalog.js').write_text('// Generated from the upstream catalogs by linux/build.py.\n'
                                    + 'export const PINGS = ' + json.dumps(pings, ensure_ascii=False, indent=2) + ';\n'
                                    + 'export const EMOTES = ' + json.dumps(emotes, ensure_ascii=False, indent=2) + ';\n')
    assets = set()
    for item in pings + emotes:
        assets.update([item['icon'], item['sound'], *item['art']])
    for relative in sorted(assets):
        target = stage / 'assets' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / 'assets' / relative, target)
    shutil.copy2(ROOT / 'LICENSE', stage / 'LICENSE')
    shutil.copy2(ROOT / 'linux/README.md', stage / 'README.md')
    shutil.copytree(ROOT / 'linux/media', stage / 'media')
    (stage / 'UPSTREAM.txt').write_text('https://github.com/darrenprx/lolPing\n'
        + subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True)
        + 'Local GNOME adaptation. Code: MIT. Icons and sounds: © Riot Games, excluded from MIT.\n')
    subprocess.run(['glib-compile-schemas', '--strict', str(stage / 'schemas')], check=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(stage.rglob('*')):
            if file.is_file():
                archive.write(file, file.relative_to(stage))
    print(f'Built {output} ({output.stat().st_size:,} bytes)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--stage', type=Path, help='New directory to retain unpacked extension for testing')
    args = parser.parse_args()
    if args.stage:
        build(args.stage, args.output)
    else:
        with tempfile.TemporaryDirectory(prefix='lolping-build-') as temp:
            build(Path(temp) / UUID, args.output)
