from pathlib import Path
from PIL import Image
from datetime import datetime, timezone
import hashlib, json, os
root=Path(__file__).resolve().parent
public=root.parent.parent/"public"/"art"/"skill-vfx-20261104"
sourceManifest=json.loads((root/"source-transfer-manifest.json").read_text(encoding="utf-8"))
runtimeManifest=json.loads((root/"runtime-transfer-manifest.json").read_text(encoding="utf-8"))
sourceNames={"sword-atlas-v2.png","mage-atlas-v2.png","archer-atlas-v2.png","thief-atlas-v2.png","hawk-v1.png","fire-spirit-v1.png"}
runtimeNames={"sword-atlas.webp","mage-atlas.webp","archer-atlas.webp","thief-atlas.webp","hawk.webp","fire-spirit.webp"}
assert {a["file"] for a in sourceManifest["assets"]}==sourceNames
assert {a["file"] for a in runtimeManifest["assets"]}==runtimeNames
def verify(folder, a, fmt, dimensions):
    file=folder/a["file"]
    raw=file.read_bytes()
    digest=hashlib.sha256(raw).hexdigest()
    assert len(raw)==a["bytes"] and digest==a["sha256"],a["file"]+": bytes/hash mismatch"
    with Image.open(file) as im:
        im.load()
        assert im.format==fmt and list(im.size)==dimensions,a["file"]+": format/dimensions mismatch"
        assert "A" in im.getbands(),a["file"]+": missing alpha"
        mode=im.mode
    return {"file":a["file"],"path":str(file),"bytes":len(raw),"sha256":digest,"format":fmt,"size":dimensions,"mode":mode,"decoded":True}
sources=[verify(root/"source",a,"PNG",[1254,1254]) for a in sourceManifest["assets"]]
runtime=[verify(public,a,"WEBP",a["size"]) for a in runtimeManifest["assets"]]
proof=json.loads((root/"runtime-proof-receipt.json").read_text(encoding="utf-8"))
for entry in proof["inputs"]:
    actual=next(a for a in runtime if a["file"]==entry["file"])
    assert entry["sha256"]==actual["sha256"]
for entry in proof["outputs"]:
    actual=root/entry["file"]
    assert actual.is_file() and hashlib.sha256(actual.read_bytes()).hexdigest()==entry["sha256"]
provenance=json.loads((root/"provenance.json").read_text(encoding="utf-8"))
assert all(a.get("unselectedHistoryOnly") is True and a.get("originalSourceFile") is None for a in provenance["assets"])
pending=[]
for name in ["runtime-transfer","source-transfer"]:
    d=root/name
    if d.exists():
        pending.extend(str(p.relative_to(root)) for p in d.rglob("*") if p.is_file())
pending.extend(str(p.relative_to(root)) for p in (root/"source").glob("*.b64"))
pending.extend(str(p) for p in public.glob("*.uploading"))
assert not pending,"Unexpected remaining transfer files: "+repr(pending)
now=datetime.now(timezone.utc).isoformat()
def atomic(name,obj):
    target=root/name
    temp=target.with_name(target.name+".tmp")
    temp.write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding="utf-8")
    os.replace(temp,target)
sourceReceipt={"schemaVersion":1,"verifiedAt":now,"ready":sources,"readyCount":6,"total":6,"unmodifiedOriginalPng":True}
atomic("source-materialization-receipt.json",sourceReceipt)
delivery={"schemaVersion":1,"verifiedAt":now,"sources":sources,"runtime":runtime,"sourceCount":6,"runtimeCount":6,"sourceBytes":sum(a["bytes"] for a in sources),"runtimeBytes":sum(a["bytes"] for a in runtime),"pendingTransferFiles":pending,"unselectedAtlasV1Delivered":False,"paddedSummonIntermediatesDelivered":False,"proofHashesMatch":True,"originalPngBytesPreserved":True,"status":"passed"}
atomic("delivery-verification.json",delivery)
print(json.dumps({k:delivery[k] for k in ["status","verifiedAt","sourceCount","runtimeCount","sourceBytes","runtimeBytes","pendingTransferFiles","proofHashesMatch","originalPngBytesPreserved"]}))
