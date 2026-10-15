import json
from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np
b=Path(__file__).resolve().parents[3];q=b/'docs/thief/gear-art';inv=json.loads((q/'inventory.json').read_text(encoding='utf-8'))
records=[]
for asset in inv['assets']:
 if not asset['src'].endswith('.webp') or not asset['exists']:continue
 p=b/'worker/public'/asset['src'];im=Image.open(p);a=np.array(im.convert('RGBA').getchannel('A'));edge=np.concatenate([a[0],a[-1],a[:,0],a[:,-1]])
 records.append({'src':asset['src'],'size':list(im.size),'mode':im.mode,'minAlpha':int(a.min()),'maxAlpha':int(a.max()),'transparentFraction':float((a<=8).mean()),'borderOpaqueFraction':float((edge>=240).mean()),'cornerAlpha':[int(a[y,x]) for y,x in [(0,0),(0,-1),(-1,0),(-1,-1)]],'alphaBounds':im.convert('RGBA').getchannel('A').point(lambda v:255 if v>=16 else 0).getbbox(),'uses':asset['uses'],'issue':'opaque-no-cutout' if a.min()==255 else 'opaque-edge-background-risk' if (edge>=240).mean()>.1 else 'alpha-present-visual-review-required'})
(q/'alpha-audit.json').write_text(json.dumps({'status':'metrics-complete-pending-visual','assets':records},ensure_ascii=False,indent=2),encoding='utf-8')
for slot in ['belt','ring']:
 items=[e for e in inv['entries'] if e['slot']==slot]
 canvas=Image.new('RGB',(1024,888),(30,28,40));draw=ImageDraw.Draw(canvas)
 for i,e in enumerate(items):
  image=Image.open(b/'worker/public'/e['frontend']['icon']['src']).convert('RGBA');x=(i%4)*256;y=(i//4)*296
  tile=Image.new('RGBA',image.size);checker=ImageDraw.Draw(tile)
  for ty in range(0,256,16):
   for tx in range(0,256,16):checker.rectangle([tx,ty,tx+15,ty+15],fill=(235,235,240,255) if (tx//16+ty//16)%2 else (140,140,155,255))
  tile.alpha_composite(image);canvas.paste(tile.convert('RGB'),(x,y));draw.text((x+5,y+259),f'T{e["tier"]} {e["frontend"]["artId"]}',fill='white')
 canvas.save(q/f'{slot}-checker-review.jpg',quality=95)
new=[e for e in inv['entries'] if e['classSpecific']]
manifest={'totalUsableDesigns':len(new),'newIconsDirectory':'worker/public/art/thief-gear-20261015','newCardsDirectory':'worker/public/art/cards/thief-gear-20261015','iconFormat':'WebP true alpha; native crop and integer translation only, no background color replacement','cardFormat':'JPG composed from clean transparent icon plus existing rarity frame; intentional card background','rarities':['common','advanced','epic','legendary','supreme','relic'],'classDesignGroups':[],'entries':[{'key':e['expectedArtId'],'tier':e['tier'],'kind':e['kind'],'slot':e['slot'],'name':e['name'],'icon':'worker/public/'+e['proposedCleanIcon'],'cardPattern':'worker/public/art/cards/thief-gear-20261015/'+e['expectedArtId']+'_{rarity}.jpg','status':'missing-native-source'} for e in new]}
for kind in ['dagger','dual_daggers','throwing_blades','helmet','armor','gloves','boots']:
 subset=[e for e in manifest['entries'] if (e['kind']==kind if kind in ['dagger','dual_daggers','throwing_blades'] else e['slot']==kind)]
 manifest['classDesignGroups'].append({'group':kind,'count':len(subset),'tierKeys':{str(e['tier']):e['key'] for e in subset}})
(q/'new-assets-plan.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'newDesigns':len(new),'alphaAssets':len(records),'beltRing':[{k:r[k] for k in ['src','minAlpha','transparentFraction','borderOpaqueFraction','issue']} for r in records if any(u.get('slot') in ['belt','ring'] for u in r['uses'])]},ensure_ascii=False))

