"""Deterministic packing of authored thief artwork; no resampling or retouching.

Layout is a reviewed JSON file with twelve entries containing sourceRect,
bodyCenterX and castAnchorPx (absolute source coordinates). Supply two native
1536x1024 sheets, each with six authored poses. No anatomy inference is used.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
args = argparse.ArgumentParser(description=__doc__)
for option in ['key', 'name', 'gender', 'hero', 'first', 'last', 'layout', 'source-dir', 'qa-dir']:
    args.add_argument('--' + option, required=True)
args.add_argument('--class-path', default='')
opts = args.parse_args()
expected = f'adv{len(opts.class_path)}_thief_{opts.class_path}_{opts.gender}' if opts.class_path else f'thief_{opts.gender}'
assert opts.key == expected and opts.gender in ['m', 'f']
source_dir, qa_dir = ROOT / opts.source_dir, ROOT / opts.qa_dir
out = ROOT / 'worker/public/art/thief-20261015' / opts.key
for directory in [source_dir, qa_dir, out]:
    directory.mkdir(parents=True, exist_ok=True)
sources = {'hero.png': Path(opts.hero), 'attack-0-5.png': Path(opts.first), 'attack-6-11.png': Path(opts.last)}
for name, original in sources.items():
    target = source_dir / name
    if target.resolve() != original.resolve():
        if target.exists():
            assert target.read_bytes() == original.read_bytes(), 'Use a versioned source for replacements'
        else:
            shutil.copyfile(original, target)

def sha(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()

def alpha_bounds(image, threshold=16):
    return image.getchannel('A').point(lambda x: 255 if x >= threshold else 0).getbbox()

layout = json.loads(Path(opts.layout).read_text(encoding='utf-8-sig'))
assert len(layout['frames']) == 12
release = layout.get('releaseFrameIndex', 6)
assert isinstance(release, int) and 0 <= release < 12
durations = layout.get('durationsMs', [100, 70, 70, 65, 65, 70, 90, 80, 80, 90, 110, 110])
assert len(durations) == 12 and sum(durations) == 1000
atlas = Image.new('RGBA', (2560, 1920), (0, 0, 0, 0))
frames, seen, anchors = [], set(), []
for index, spec in enumerate(layout['frames']):
    name = 'attack-0-5.png' if index < 6 else 'attack-6-11.png'
    original = Image.open(source_dir / name).convert('RGBA')
    assert original.size == (1536, 1024), 'Never resize an authored sheet to fit the template'
    rect = spec['sourceRect']
    assert len(rect) == 4 and all(isinstance(v, int) for v in rect)
    assert 0 <= rect[0] < rect[2] <= original.width and 0 <= rect[1] < rect[3] <= original.height
    crop = original.crop(rect)
    box = alpha_bounds(crop)
    assert box and box[0] > 0 and box[1] > 0 and box[2] < crop.width and box[3] < crop.height, (index, 'Source clipping', box)
    dx, dy = 320 - (spec['bodyCenterX'] - rect[0]), 600 - box[3]
    assert all(isinstance(v, int) for v in [dx, dy])
    assert dx + box[0] >= 20 and dx + box[2] <= 620 and dy + box[1] >= 20, (index, 'Packed margin', box)
    frame = Image.new('RGBA', (640, 640), (0, 0, 0, 0))
    frame.paste(crop, (dx, dy))
    assert frame.crop((dx + box[0], dy + box[1], dx + box[2], dy + box[3])).tobytes() == crop.crop(box).tobytes()
    anchor = [spec['castAnchorPx'][0] - rect[0] + dx, spec['castAnchorPx'][1] - rect[1] + dy]
    assert all(isinstance(v, int) and 0 <= v < 640 for v in anchor)
    anchors.append(anchor)
    rgba_sha = hashlib.sha256(frame.tobytes()).hexdigest()
    assert rgba_sha not in seen, 'Duplicate animation pose'
    seen.add(rgba_sha)
    atlas.paste(frame, (index % 4 * 640, index // 4 * 640))
    frames.append({'index': index, 'source': name, 'sourceRect': rect, 'translation': [dx, dy],
                   'alphaBounds': alpha_bounds(frame), 'footBaseline': alpha_bounds(frame)[3],
                   'castAnchorPx': anchor, 'rgbaSHA256': rgba_sha, 'nativePixelsPreserved': True})
hero = Image.open(source_dir / 'hero.png').convert('RGBA')
assert hero.getchannel('A').getextrema()[0] == 0 and hero.width >= 768 and hero.height >= 1024
body = layout['neutralBodyBoundsPx']
assert len(body) == 4 and 0 <= body[0] < body[2] <= 640 and 0 <= body[1] < body[3] <= 640
body_bounds = [v / 640 for v in body]
for name in ['hero.png', 'portrait.png']:
    shutil.copyfile(source_dir / 'hero.png', out / name)
atlas.save(out / 'character.png')
atlas.save(out / 'character.webp', lossless=True, exact=True, method=6)
assert np.array_equal(np.array(atlas), np.array(Image.open(out / 'character.webp').convert('RGBA')))
hashes = {name: sha(out / name) for name in ['hero.png', 'portrait.png', 'character.png', 'character.webp']}
prefix = f'art/thief-20261015/{opts.key}/'
url = lambda name: prefix + name + '?v=' + hashes[name][:12]
boxes = [[v / 640 for v in frame['alphaBounds']] for frame in frames]
union = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]
hb = [v / hero.size[i % 2] for i, v in enumerate(alpha_bounds(hero))]
entry = {'key': opts.key, 'name': opts.name, 'baseClass': 'thief', 'classPath': opts.class_path, 'gender': opts.gender,
         'hero': url('hero.png'), 'portrait': url('portrait.png'), 'heroBounds': hb, 'heroMeta': {'fig': hb},
         'animation': {'src': url('character.webp'), 'png': url('character.png'), 'cols': 4, 'rows': 3,
                       'firstFrame': 0, 'totalFrames': 12, 'frames': 12, 'cellWidth': 640, 'cellHeight': 640,
                       'durationMs': 1000, 'durationsMs': durations, 'frameBounds': union, 'frameBoundsPerFrame': boxes,
                       'frameFig': body_bounds, 'bodyBounds': body_bounds,
                       'heightScale': (hb[3]-hb[1])/(body_bounds[3]-body_bounds[1]), 'useAsIdle': False,
                       'neutralBodyBoundsPx': body,
                       'footBaseline': 600, 'releaseFrameIndex': release, 'releaseAtMs': sum(durations[:release]),
                       'castAnchorsPx': anchors, 'castAnchorRole': 'active-blade-hand',
                       'castAnchorMethod': 'Manual source coordinates with exact integer pack translation',
                       'nativePixelsPreserved': True, 'authoredEffects': True, 'preservePlacement': True},
         'normalFx': {'renderer': 'thief-native-canvas', 'kind': 'dagger', 'durationMs': 360},
         'skillFx': {'renderer': 'thief-native-canvas', 'kind': layout.get('skillKind', 'cross'), 'durationMs': 560},
         'guardianCategory': 'melee', 'status': 'native-packed-review-pending', 'visualAccepted': False,
         'actualEventVerified': False, 'provenance': {'generator': 'built-in image_gen',
         'sourceSHA256': {name: sha(source_dir / name) for name in sources}, 'packingEvidence': str((qa_dir / 'native-pack.json').relative_to(ROOT)).replace('\\', '/')}}
report = {'status': 'native-packing-pass', 'key': opts.key, 'frames': frames, 'distinctFrames': len(seen),
          'cellSize': 640, 'columns': 4, 'rows': 3, 'nativePixelsPreserved': True, 'noUpscaling': True,
          'noBackgroundEditing': True, 'heroBounds': alpha_bounds(hero), 'heroDimensions': list(hero.size),
          'sources': entry['provenance']['sourceSHA256'], 'outputs': hashes, 'visualAccepted': False, 'runtimeAccepted': False}
(qa_dir / 'native-pack.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
(qa_dir / 'fragment.json').write_text(json.dumps(entry, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'key': opts.key, 'nativePacking': 'PASS', 'frames': len(frames), 'pixelsPreserved': True}))
