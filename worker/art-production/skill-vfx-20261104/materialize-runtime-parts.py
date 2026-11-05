from pathlib import Path
from PIL import Image
import base64, hashlib, json, os
root = Path(__file__).resolve().parent
manifest = json.loads((root / "runtime-transfer-manifest.json").read_text(encoding="utf-8"))
public = root.parent.parent / "public" / "art" / "skill-vfx-20261104"
public.mkdir(parents=True, exist_ok=True)
chunks = root / "runtime-transfer"
ready = []
pending = []
for asset in manifest["assets"]:
    name = asset["file"]
    if name not in ["sword-atlas.webp","mage-atlas.webp","archer-atlas.webp","thief-atlas.webp","hawk.webp","fire-spirit.webp"]:
        raise ValueError("Unexpected asset filename")
    target = public / name
    if target.exists():
        if hashlib.sha256(target.read_bytes()).hexdigest() != asset["sha256"]:
            raise ValueError("Refusing to replace different runtime: " + name)
    else:
        parts = [chunks / (name + ".part" + str(i).zfill(3) + ".b64") for i in range(asset["parts"])]
        if not all(p.is_file() for p in parts):
            pending.append({"file":name,"received":sum(p.is_file() for p in parts),"total":len(parts)})
            continue
        raw = b"".join(base64.b64decode("".join(p.read_text(encoding="ascii").split()), validate=True) for p in parts)
        if len(raw) != asset["bytes"] or hashlib.sha256(raw).hexdigest() != asset["sha256"]:
            raise ValueError("Part hash/length mismatch: " + name)
        temp = public / (name + ".uploading")
        temp.write_bytes(raw)
        with Image.open(temp) as im:
            im.load()
            if list(im.size) != asset["size"]:
                raise ValueError("Dimensions mismatch: " + name)
        os.replace(temp, target)
        for p in parts:
            p.unlink()
    with Image.open(target) as im:
        im.load()
        dims = list(im.size)
    ready.append({"file":name,"bytes":target.stat().st_size,"size":dims,"sha256":hashlib.sha256(target.read_bytes()).hexdigest(),"decoded":True})
report = {"schemaVersion":1,"ready":ready,"pending":pending,"readyCount":len(ready),"total":len(manifest["assets"])}
(root / "runtime-materialization-receipt.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(report,ensure_ascii=False))
