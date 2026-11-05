"""Read-only runtime sprite QA; composites are not artwork edits or animation frames."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import hashlib
import json
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
RUNTIME = HERE.parents[1] / "public" / "art" / "skill-vfx-20261104"
BACKGROUND = (20, 32, 43, 255)
CLASSES = ("sword", "mage", "archer", "thief")
KINDS = ("projectile", "crescent slash", "impact", "ground ring", "shield", "spray", "pillar", "vortex", "spark")
FILES = [name + "-atlas.webp" for name in CLASSES] + ["hawk.webp", "fire-spirit.webp"]

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def font(size):
    for filename in ("C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf"):
        try:
            return ImageFont.truetype(filename, size)
        except OSError:
            pass
    return ImageFont.load_default()

def caption(draw, xy, text, size=16, color=(175, 190, 202, 255)):
    draw.text(xy, text, font=font(size), fill=color)

def paste_source_over(sheet, rgba, xy, fit):
    # Keep full cell/canvas gutters. Only the QA preview is resized.
    source = rgba.copy()
    source.thumbnail(fit, Image.Resampling.LANCZOS)
    x, y = xy
    x += (fit[0] - source.width) // 2
    y += (fit[1] - source.height) // 2
    sheet.alpha_composite(source, (x, y))

def main():
    metadata = json.loads((HERE / "provenance.json").read_text(encoding="utf-8"))
    expected = {entry["file"]: entry["sha256"] for entry in metadata["qaSummary"]}
    before = {name: sha(RUNTIME / name) for name in FILES}
    assert all(before[name] == expected[name] for name in FILES), "Runtime input SHA does not match recorded asset."
    decoded = {}
    inputs = []
    for name in FILES:
        with Image.open(RUNTIME / name) as im:
            im.load()
            rgba = im.convert("RGBA")
        expected_size = (1254, 1254) if name.endswith("-atlas.webp") else (840, 840)
        assert rgba.size == expected_size, (name, rgba.size)
        decoded[name] = rgba
        inputs.append({
            "file": name, "relativePath": "../../public/art/skill-vfx-20261104/" + name,
            "size": list(rgba.size), "sha256": before[name],
            "alphaExtrema": list(rgba.getchannel("A").getextrema()),
        })

    # Nine component columns by four class rows: all 36 full cells remain visible.
    cell_w, cell_h, margin, header = 250, 292, 24, 108
    atlas = Image.new("RGBA", (margin * 2 + cell_w * 9, header + cell_h * 4 + 40), BACKGROUND)
    draw = ImageDraw.Draw(atlas)
    caption(draw, (margin, 18), "STARJOURNAL / 36 RUNTIME ATLAS COMPONENTS", 26, (234, 224, 198, 255))
    caption(draw, (margin, 56), "Decoded WebP | source-over on #14202B | full 418px cells | preview scale only | independent layers, not animation frames", 17)
    caption(draw, (margin, 82), "Separate QA composite: original imagegen raw-alpha review and selected source PNG delivery are recorded separately.", 15)
    for row, class_name in enumerate(CLASSES):
        src = decoded[class_name + "-atlas.webp"]
        for index, kind in enumerate(KINDS):
            x, y = margin + index * cell_w, header + row * cell_h
            draw.rounded_rectangle((x + 3, y + 3, x + cell_w - 7, y + cell_h - 9),
                                   radius=8, outline=(51, 67, 81, 255), width=1)
            caption(draw, (x + 13, y + 12), class_name.upper() + " / " + str(index), 16, (234, 224, 198, 255))
            sx, sy = (index % 3) * 418, (index // 3) * 418
            tile = src.crop((sx, sy, sx + 418, sy + 418))
            paste_source_over(atlas, tile, (x + 13, y + 39), (224, 224))
            caption(draw, (x + 13, y + 263), kind, 15)
    caption(draw, (margin, atlas.height - 28), "Source alpha preserved. No screen/additive blend, tint, keying, repainting, or runtime file changes.", 15)
    atlas_path = HERE / "cropped-source-over-proof-final.jpg"
    atlas.convert("RGB").save(atlas_path, quality=94, subsampling=0)

    summon_w, summon_h, summon_header = 716, 756, 108
    summons = Image.new("RGBA", (margin * 2 + summon_w * 2, summon_header + summon_h + 40), BACKGROUND)
    draw = ImageDraw.Draw(summons)
    caption(draw, (margin, 18), "STARJOURNAL / RUNTIME SUMMON SPRITES", 26, (234, 224, 198, 255))
    caption(draw, (margin, 56), "Decoded 840px WebP | source-over on #14202B | full transparent canvas retained | preview scale only", 17)
    caption(draw, (margin, 82), "Separate from original raw-alpha inspection; this sheet shows the shipped runtime assets.", 15)
    for index, name in enumerate(("hawk", "fire-spirit")):
        x, y = margin + summon_w * index, summon_header
        draw.rounded_rectangle((x + 3, y + 3, x + summon_w - 7, y + summon_h - 9),
                               radius=10, outline=(51, 67, 81, 255), width=1)
        caption(draw, (x + 18, y + 15), name.upper() + " / facing right", 22, (234, 224, 198, 255))
        paste_source_over(summons, decoded[name + ".webp"], (x + 18, y + 50), (680, 680))
        caption(draw, (x + 18, y + 729), "Original padding shown; source-over only.", 15)
    caption(draw, (margin, summons.height - 28), "Source alpha preserved. No crop of the creature, no tint, no additive blend, and no runtime file changes.", 15)
    summon_path = HERE / "summons-source-over-proof.jpg"
    summons.convert("RGB").save(summon_path, quality=94, subsampling=0)

    after = {name: sha(RUNTIME / name) for name in FILES}
    assert before == after, "Runtime files changed during proof build."
    assert len(metadata["assets"]) == 4
    assert all(a["originalSourceFile"] is None and a["unselectedHistoryOnly"] is True
               and "NOT delivered to D checkout" in a["originalSourceStatus"] for a in metadata["assets"])
    outputs = []
    for path, size in ((atlas_path, atlas.size), (summon_path, summons.size)):
        outputs.append({"file": path.name, "size": list(size), "bytes": path.stat().st_size, "sha256": sha(path)})
    receipt = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "kind": "runtime-source-over-bitmap-qa", "background": "#14202B",
        "inputs": inputs, "outputs": outputs,
        "runtimeBytesUnchanged": True, "atlasCellCount": 36, "summonCount": 2,
        "separateFromRawAlphaReview": True,
        "limitations": [
            "QA composites decode runtime WebP and resample only these preview sheets.",
            "These sheets do not assess animation recipes, live combat wiring, or mobile GPU performance.",
            "Unselected atlas v1 originals are generation history only, not files delivered to this checkout.",
        ],
    }
    (HERE / "runtime-proof-receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "runtimeBytesUnchanged": True, "outputs": outputs, "receipt": "runtime-proof-receipt.json"}))

if __name__ == "__main__":
    main()
