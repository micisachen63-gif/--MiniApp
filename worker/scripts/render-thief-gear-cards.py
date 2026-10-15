"""Render derived 480px Telegram equipment cards from clean native thief icons.
The six Greek rarity frames are deterministic vector-style drawing, approved by root
after the historical cards.py source was confirmed absent. No old item-card JPG is
opened or mined for frame pixels. Original RGBA icons are never changed.
"""
import argparse,hashlib,json,math
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[2]
QA=ROOT/'docs/thief/gear-art'
RARITIES={'common':('一般','#c8ccd6'),'advanced':('高級','#2ed573'),'epic':('極品','#1e90ff'),'legendary':('傳說','#a855f7'),'supreme':('霸主','#ff4757'),'relic':('遺物','#e9c879')}
FONT=Path('C:/Windows/Fonts/msjhbd.ttc')
def sha(file):return hashlib.sha256(Path(file).read_bytes()).hexdigest()
def rgb(color):return tuple(int(color[i:i+2],16) for i in (1,3,5))
def font(size):return ImageFont.truetype(str(FONT),size)
def center_text(draw,y,text,typeface,fill):
 box=draw.textbbox((0,0),text,font=typeface);draw.text(((480-(box[2]-box[0]))/2,y),text,font=typeface,fill=fill)
def rarity_frame(rarity):
 _,color=RARITIES[rarity];tone=rgb(color);gold=(215,189,124,255)
 frame=Image.new('RGBA',(480,480),(18,24,46,255));g=ImageDraw.Draw(frame)
 # Quiet navy mosaic background. Every pixel comes from this renderer.
 for y in range(24,456,12):
  for x in range(24,456,18):
   n=((x//18)*3+(y//12)*5)%7;v=18+n
   g.rectangle((x+(9 if(y//12)%2 else 0),y,x+15+(9 if(y//12)%2 else 0),y+8),fill=(v,v+7,v+21,255))
 g.rectangle((5,5,474,474),outline=gold,width=3)
 g.rectangle((12,12,467,467),outline=tone+(255,),width=4)
 g.rectangle((21,21,458,458),outline=(120,102,69,255),width=1)
 # Greek meander corners and gold tesserae; shared geometry across six rarities.
 for side in range(4):
  for t in range(36,445,18):
   a,b=(t,8) if side==0 else (471,t) if side==1 else (t,471) if side==2 else (8,t)
   g.rectangle((a-4,b-2,a+4,b+2),fill=gold)
 for cx,cy in [(16,16),(464,16),(16,464),(464,464)]:
  g.polygon([(cx,cy-12),(cx+12,cy),(cx,cy+12),(cx-12,cy)],fill=(83,65,39,255),outline=gold,width=2)
  g.polygon([(cx,cy-5),(cx+5,cy),(cx,cy+5),(cx-5,cy)],fill=tone+(255,))
 if rarity=='relic':
  g.rectangle((17,17,462,462),outline=(186,137,255,255),width=2)
 # Clean title plaque is part of the derived card, not part of the equipment icon.
 g.polygon([(53,374),(427,374),(446,411),(427,452),(53,452),(34,411)],fill=(20,18,23,255),outline=gold,width=2)
 g.line((64,380,416,380),fill=tone+(255,),width=2)
 g.line((64,446,416,446),fill=tone+(255,),width=2)
 return frame
def compose_card(source,item,rarity):
 original=Image.open(source).convert('RGBA')
 assert original.getchannel('A').getextrema()[0]==0,'Icon must have real transparent alpha'
 alpha=original.getchannel('A')
 assert sum(alpha.histogram()[:9])>original.width*original.height*.1,'Icon background is not clean'
 box=alpha.point(lambda value:255 if value>=16 else 0).getbbox();assert box,'Empty icon'
 crop=original.crop(box);scale=min(348/crop.width,312/crop.height,1)
 thumbnail=crop.resize((max(1,round(crop.width*scale)),max(1,round(crop.height*scale))),Image.Resampling.LANCZOS)
 placement=((480-thumbnail.width)//2,40+(312-thumbnail.height)//2)
 frame=rarity_frame(rarity);frame.alpha_composite(thumbnail,placement)
 draw=ImageDraw.Draw(frame);name=item['name'];size=20
 while draw.textbbox((0,0),name,font=font(size))[2]>340 and size>13:size-=1
 center_text(draw,385,name,font(size),(239,228,200,255))
 center_text(draw,413,RARITIES[rarity][0],font(25),rgb(RARITIES[rarity][1])+(255,))
 draw.text((34,32),'T'+str(item['tier']),font=font(15),fill=(228,210,165,255))
 return frame.convert('RGB'),{'sourceAlphaBounds':list(box),'cardScale':scale,'placementPx':list(placement),'cardIconSize':list(thumbnail.size)}
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--render',action='store_true');parser.add_argument('--keys',default='');parser.add_argument('--preview',action='store_true');args=parser.parse_args()
 QA.mkdir(parents=True,exist_ok=True)
 if args.preview:
  dest=QA/'cards-preview';dest.mkdir(exist_ok=True)
  for rarity in RARITIES:rarity_frame(rarity).save(dest/('frame-'+rarity+'.png'))
  refs=[('belt','月桂編織腰帶','gear_belt_laurel.webp'),('ring','月桂紋章戒','gear_ring_laurel.webp')]
  sheet=Image.new('RGB',(1440,960))
  for kind,name,file in refs:
   for index,rarity in enumerate(RARITIES):
    card,_=compose_card(ROOT/'worker/public/art/v2'/file,{'name':name,'tier':1},rarity)
    card.save(dest/('QA-REFERENCE-'+kind+'-'+rarity+'.jpg'),quality=94,subsampling=0)
    if kind=='ring':sheet.paste(card,((index%3)*480,(index//3)*480))
  sheet.save(dest/'QA-REFERENCE-ring-six-rarities.jpg',quality=94,subsampling=0)
 manifest=json.loads((QA/'new-assets-plan.json').read_text(encoding='utf-8'))
 wanted=set(args.keys.split(',')) if args.keys else None
 entries=[e for e in manifest['entries'] if wanted is None or e['key'] in wanted]
 assert entries and (wanted is None or wanted=={e['key'] for e in entries}),'Unknown or empty card keys'
 missing=[e['icon'] for e in entries if not (ROOT/e['icon']).is_file()]
 result={'status':'blocked-missing-native-icons' if missing else 'ready-to-render' if not args.render else 'rendered','expectedIcons':len(entries),'expectedCards':len(entries)*6,'missingIcons':missing,'actualCardCount':0,'frameRenderer':'programmatic Greek mosaic and UI rarity colors; no historical JPG pixels','derivedCardSize':[480,480],'sourceNativeIconsChanged':False,'cardScalingOnly':True,'rendererSHA256':sha(__file__),'fontSHA256':sha(FONT),'entries':[]}
 if args.render and not missing:
  for item in entries:
   source=ROOT/item['icon'];before=sha(source);outputs={}
   for rarity in RARITIES:
    target=ROOT/item['cardPattern'].replace('{rarity}',rarity)
    expected=ROOT/'worker/public/art/cards/thief-gear-20261015'
    assert target.resolve().parent==expected.resolve(),'Output outside thief card directory'
    target.parent.mkdir(parents=True,exist_ok=True)
    image,placement=compose_card(source,item,rarity);image.save(target,quality=94,subsampling=0)
    outputs[rarity]={'file':str(target.relative_to(ROOT)).replace('\\','/'),'SHA256':sha(target),**placement};result['actualCardCount']+=1
   assert sha(source)==before,'Rendering modified a native icon'
   result['entries'].append({'key':item['key'],'sourceSHA256':before,'outputs':outputs})
 (QA/'cards-status.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'status':result['status'],'missingIcons':len(missing),'actualCards':result['actualCardCount']}))
 if args.render and missing:raise SystemExit(2)
if __name__=='__main__':main()

