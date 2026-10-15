"""Pack authored poses without retouching, scaling, recoloring or alpha removal."""
from pathlib import Path
from PIL import Image
import hashlib
import json
import shutil
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
ORIGINALS = Path('C:/Users/User/.codex/generated_images/01a137f7-1f11-7f73-acbb-6046125807a7')
SOURCE = ROOT / 'worker/art-production/thief-20261015/thief_f'
OUT = ROOT / 'worker/public/art/thief-20261015/thief_f'
QA = ROOT / 'docs/thief'
SOURCES = {
    'hero.png': 'exec-ee34bde0-60fb-4cb4-9381-60cb100d1c51.png',
    'attack-0-5.png': 'exec-e80949a5-4fd9-48a3-832b-d7ac567fe61d.png',
    'attack-6-11.png': 'exec-4bbd846e-cc44-45c6-a2a8-fffab3f7dfa0.png',
}
for folder in (SOURCE, OUT, QA):
    folder.mkdir(parents=True, exist_ok=True)
for name, original in SOURCES.items():
    if not (SOURCE / name).exists():
        shutil.copyfile(ORIGINALS / original, SOURCE / name)

def sha(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()

def bounds(image, threshold=16):
    alpha = image.getchannel('A')
    return alpha.point(lambda x: 255 if x >= threshold else 0).getbbox()

# Rectangle boundaries follow real transparent gutters. Pose 4's knife extends
# beyond the nominal column boundary but remains separate from pose 5.
rectangles = [
    (0, 0, 512, 512), (512, 0, 1024, 512), (1024, 0, 1536, 512),
    (0, 512, 512, 1024), (512, 512, 1072, 1024), (1072, 512, 1536, 1024),
] + [
    (0, 0, 512, 512), (512, 0, 1024, 512), (1024, 0, 1536, 512),
    (0, 512, 512, 1024), (512, 512, 1024, 1024), (1024, 512, 1536, 1024),
]
centers = [256, 784, 1300, 270, 790, 1300, 280, 790, 1280, 280, 785, 1280]
cell_size, baseline = 640, 600
atlas = Image.new('RGBA', (cell_size * 4, cell_size * 3), (0, 0, 0, 0))
frames = []
seen = set()
for index, rect in enumerate(rectangles):
    name = 'attack-0-5.png' if index < 6 else 'attack-6-11.png'
    source = Image.open(SOURCE / name).convert('RGBA')
    assert source.size == (1536, 1024), (name, source.size)
    crop = source.crop(rect)
    box = bounds(crop)
    assert box, index
    # A crop may include low-alpha edge particles. Significant paint must not be
    # clipped at any rectangle edge, nor borrowed from a neighboring character.
    assert box[0] > 0 and box[1] > 0 and box[2] < crop.width and box[3] < crop.height, (index, box)
    dx = cell_size // 2 - (centers[index] - rect[0])
    dy = baseline - box[3]
    assert dx + box[0] >= 20 and dx + box[2] <= cell_size - 20, (index, dx, box)
    assert dy + box[1] >= 20, (index, dy, box)
    frame = Image.new('RGBA', (cell_size, cell_size), (0, 0, 0, 0))
    frame.paste(crop, (dx, dy))  # No mask: copy original RGBA bytes exactly.
    dst = (index % 4 * cell_size, index // 4 * cell_size)
    atlas.paste(frame, dst)
    visible = np.array(frame)
    digest = hashlib.sha256(visible.tobytes()).hexdigest()
    assert digest not in seen, 'Duplicated animation pose'
    seen.add(digest)
    packed = frame.crop((dx + box[0], dy + box[1], dx + box[2], dy + box[3]))
    native = crop.crop(box)
    assert packed.tobytes() == native.tobytes(), 'Native pixels were modified'
    final_bounds = bounds(frame)
    frames.append({'index': index, 'source': name, 'sourceRect': rect, 'translation': [dx, dy],
                   'alphaBounds': final_bounds, 'footBaseline': final_bounds[3], 'rgbaSHA256': digest,
                   'nativePixelsPreserved': True})

hero = Image.open(SOURCE / 'hero.png').convert('RGBA')
assert hero.getchannel('A').getextrema()[0] == 0
shutil.copyfile(SOURCE / 'hero.png', OUT / 'hero.png')
shutil.copyfile(SOURCE / 'hero.png', OUT / 'portrait.png')
atlas.save(OUT / 'character.png')
atlas.save(OUT / 'character.webp', lossless=True, exact=True, method=6)
webp = Image.open(OUT / 'character.webp').convert('RGBA')
assert np.array_equal(np.array(atlas), np.array(webp)), 'WebP differs from native packed PNG'
report = {
    'status': 'native-packing-pass-visual-and-runtime-review-pending', 'key': 'thief_f',
    'generator': 'built-in image_gen', 'frames': frames, 'distinctFrames': len(seen),
    'cellSize': cell_size, 'columns': 4, 'rows': 3, 'nativePixelsPreserved': True,
    'noUpscaling': True, 'noBackgroundEditing': True,
    'heroBounds': bounds(hero), 'heroDimensions': list(hero.size),
    'sources': {name: sha(SOURCE / name) for name in SOURCES},
    'outputs': {name: sha(OUT / name) for name in ['hero.png', 'portrait.png', 'character.png', 'character.webp']},
    'rejectedSources': [{'file': 'exec-508ff658-bed4-4ec4-9e40-dbcb16f872f9.png',
                         'reason': 'First 4x3 source has cropped right-edge blade effects and overlapping cell bounds; not used.'}],
    'visualAccepted': False, 'runtimeAccepted': False,
}
(QA / 'pilot-native-pack.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({k: report[k] for k in ['status', 'distinctFrames', 'nativePixelsPreserved', 'noUpscaling']}))
