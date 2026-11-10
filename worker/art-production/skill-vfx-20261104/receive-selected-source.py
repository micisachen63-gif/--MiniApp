from pathlib import Path
from PIL import Image
import argparse, base64, hashlib, json, os, sys
p=argparse.ArgumentParser()
p.add_argument("--file",required=True)
p.add_argument("--index",required=True,type=int)
args=p.parse_args()
root=Path(__file__).resolve().parent
manifest=json.loads((root/"source-transfer-manifest.json").read_text(encoding="utf-8"))
asset=next((a for a in manifest["assets"] if a["file"]==args.file),None)
if asset is None or not 0<=args.index<asset["parts"]:
    raise ValueError("Unexpected source or part")
source=root/"source"
source.mkdir(exist_ok=True)
target=source/asset["file"]
expected=asset["sha256"]
if target.exists():
    if hashlib.sha256(target.read_bytes()).hexdigest()!=expected:
        raise ValueError("Refusing to replace a different source")
    print(json.dumps({"file":asset["file"],"status":"complete","sha256":expected,"alreadyPresent":True}))
    sys.exit(0)
text=sys.stdin.buffer.read().decode("ascii")
data=base64.b64decode("".join(text.split()),validate=True)
size=min(manifest["partBytes"],asset["bytes"]-args.index*manifest["partBytes"])
if len(data)!=size:
    raise ValueError("Invalid decoded chunk length")
parts=root/"source-transfer"
parts.mkdir(exist_ok=True)
part=parts/(asset["file"]+".part"+str(args.index).zfill(3)+".bin")
if part.exists() and part.read_bytes()!=data:
    raise ValueError("Conflicting source chunk")
temp=part.with_suffix(".tmp")
temp.write_bytes(data)
os.replace(temp,part)
allparts=[parts/(asset["file"]+".part"+str(i).zfill(3)+".bin") for i in range(asset["parts"])]
count=sum(p.is_file() for p in allparts)
if count<asset["parts"]:
    print(json.dumps({"file":asset["file"],"status":"receiving","received":count,"parts":asset["parts"]}))
    sys.exit(0)
raw=b"".join(p.read_bytes() for p in allparts)
if len(raw)!=asset["bytes"] or hashlib.sha256(raw).hexdigest()!=expected:
    raise ValueError("Whole-source hash mismatch")
temp=target.with_suffix(".tmp.png")
temp.write_bytes(raw)
with Image.open(temp) as im:
    im.load()
    if im.format!="PNG" or list(im.size)!=[1254,1254]:
        raise ValueError("Invalid original PNG")
os.replace(temp,target)
for p in allparts:
    p.unlink()
ready=[]
for a in manifest["assets"]:
    q=source/a["file"]
    if q.is_file() and hashlib.sha256(q.read_bytes()).hexdigest()==a["sha256"]:
        ready.append({"file":a["file"],"bytes":q.stat().st_size,"sha256":a["sha256"]})
report={"schemaVersion":1,"ready":ready,"readyCount":len(ready),"total":len(manifest["assets"]),"unmodifiedOriginalPng":True}
(root/"source-materialization-receipt.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps({"file":asset["file"],"status":"complete","sha256":expected,"bytes":len(raw),"totalReady":len(ready)}))
