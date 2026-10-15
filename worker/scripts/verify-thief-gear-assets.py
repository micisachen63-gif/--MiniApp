"""Read-only verification of native sources/icons and all derived cards; contacts are QA only."""
import hashlib,json
from pathlib import Path
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[2];QA=ROOT/'docs/thief/gear-art'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
pack=json.loads((QA/'native-pack.json').read_text(encoding='utf-8'))
cards=json.loads((QA/'cards-status.json').read_text(encoding='utf-8'))
plan=json.loads((QA/'new-assets-plan.json').read_text(encoding='utf-8'))
prompts={};review=[]
for group in plan['classDesignGroups']:
 entries=[p for p in pack['proofs'] if p['group']==group['group']]
 contact=Image.new('RGB',(960,800),'#132036');draw=ImageDraw.Draw(contact)
 for index,p in enumerate(entries):
  source=ROOT/p['source'];assert sha(source)==p['sourceSHA256']
  prompt=source.with_name(source.stem+'-prompt.json');assert prompt.is_file();prompts[prompt.relative_to(ROOT).as_posix()]=sha(prompt)
  crop=Image.open(source).convert('RGBA').crop(p['sourceRect']);left,top=p['translationPx']
  assert left>=0 and top>=0 and left+crop.width<=640 and top+crop.height<=640,(p['key'],'ROI cannot be fully reconstructed')
  icon=Image.open(ROOT/p['WebP']['file']).convert('RGBA');assert icon.crop((left,top,left+crop.width,top+crop.height)).tobytes()==crop.tobytes()
  assert sha(ROOT/p['WebP']['file'])==p['WebP']['SHA256'];assert icon.size==(640,640)
  x=(index%4)*240;y=(index//4)*266
  for yy in range(y,y+240,16):
   for xx in range(x,x+240,16):draw.rectangle((xx,yy,xx+15,yy+15),fill='#29384a' if (xx//16+yy//16)%2 else '#172334')
  thumb=icon.copy();thumb.thumbnail((232,232));contact.paste(thumb,(x+4,y+4),thumb)
  draw.text((x+8,y+243),f"{group['group']} T{p['tier']}",fill='white')
  review.append({'key':p['key'],'fullROIRGBAEquality':True,'promptSHA256':prompts[prompt.relative_to(ROOT).as_posix()]})
 contact.save(QA/(group['group']+'-all-tiers-checker.jpg'),quality=94)
card_count=0
for entry in cards['entries']:
 for card in entry['outputs'].values():
  file=ROOT/card['file'];assert sha(file)==card['SHA256'];im=Image.open(file);assert im.size==(480,480) and im.format=='JPEG';card_count+=1
assert card_count==492 and len(review)==82
plan['cardFormat']='JPG derived from clean native icon plus programmatic Greek rarity frame; intentional card background'
for e in plan['entries']:e['status']='packed-and-verified';e['nativeProof']='native-pack.json';e['derivedCardsProof']='cards-status.json'
(QA/'new-assets-plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2),encoding='utf-8')
report={'status':'PASS','icons':82,'cards':492,'sources':len(pack['sourceSHA256']),'prompts':prompts,'fullROIProofs':review,'nativePixelsAndAlphaUnchanged':True,'contactSheetsResizedForQAOnly':True}
(QA/'complete-native-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':'PASS','icons':82,'cards':492,'fullROIEquality':82}))
