from pathlib import Path
import json, hashlib
from PIL import Image, ImageDraw, ImageFont

OUT=Path(__file__).resolve().parent
INVENTORY=json.loads((OUT/'source-inventory.json').read_text('utf-8'))
GROK=Path(INVENTORY['sourceRoot']).parents[1]
W,H,BODY,FX,FY=480,512,300,240,470
FONT=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',18)
SMALL=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',14)
BG=(16,25,36,255)
images={}
receipt={'schemaVersion':1,'purpose':'Read-only technical review of current source attack frames; no character asset pixels are altered.','normalization':{'canvas':[W,H],'foot':[FX,FY],'body':BODY},'outputs':[]}

def asset(url):
    if url not in images:
        entry=INVENTORY['assets'][url]
        data=Path(entry['path']).read_bytes()
        if hashlib.sha256(data).hexdigest()!=entry['sha256']:
            raise RuntimeError('Source changed during review: '+url)
        images[url]=Image.open(Path(entry['path'])).convert('RGBA')
    return images[url]

def normalized(clip,index):
    fr=clip['frames'][index]
    x,y,w,h=fr['rect']
    crop=asset(fr['url']).crop((x,y,x+w,y+h))
    polygon=fr.get('sourceClipPolygon')
    if polygon:
        mask=Image.new('L',crop.size,0)
        ImageDraw.Draw(mask).polygon([tuple(p) for p in polygon],fill=255)
        crop.putalpha(Image.composite(crop.getchannel('A'),Image.new('L',crop.size,0),mask))
    factor=BODY/fr['bodyHeight']
    newsize=(max(1,round(w*factor)),max(1,round(h*factor)))
    crop=crop.resize(newsize,Image.Resampling.LANCZOS)
    local=Image.new('RGBA',(W,H),(0,0,0,0))
    left=round(FX-fr['anchor'][0]*factor)
    top=round(FY-fr['anchor'][1]*factor)
    local.alpha_composite(crop,(left,top))
    mirror=bool(clip.get('mirrorX'))!=bool(fr.get('mirrorX'))
    if mirror:local=local.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    return local

def tile(actor,direction,index,caption=None):
    clip=actor['attack'][direction]
    out=Image.new('RGBA',(W,H+58),BG)
    out.alpha_composite(normalized(clip,index),(0,58))
    draw=ImageDraw.Draw(out)
    draw.text((14,10),f'{actor["id"]} / {direction} / frame {index}',font=FONT,fill='#E4DDCD')
    ms=sum(fr['durationMs'] for fr in clip['frames'][:index])
    draw.text((14,34),caption or f'starts {ms} ms | source {clip["frames"][index].get("label","")}',font=SMALL,fill='#8EA6B9')
    draw.line((FX-8,FY+58,FX+8,FY+58),fill='#648894',width=1)
    draw.line((FX,FY+50,FX,FY+66),fill='#648894',width=1)
    return out

def save(img,name):
    target=OUT/name
    img.convert('RGB').save(target,quality=94,subsampling=0)
    receipt['outputs'].append({'file':name,'size':list(img.size),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})

for aid in ['sword','archer']:
    actor=next(a for a in INVENTORY['actors'] if a['id']==aid)
    clip=actor['attack']['right']
    rows=(len(clip['frames'])+3)//4
    out=Image.new('RGBA',(W*4,(H+58)*rows),BG)
    for index in range(len(clip['frames'])):
        out.alpha_composite(tile(actor,'right',index),(W*(index%4),(H+58)*(index//4)))
    save(out,aid+'-right-sequence.jpg')

for actor in INVENTORY['actors']:
    out=Image.new('RGBA',(W*2,(H+58)*2),BG)
    for i,direction in enumerate(['up','down','right','left']):
        clip=actor['attack'][direction]
        index=clip.get('releaseFrame',clip.get('hitFrame'))
        if index is None:
            t=Image.new('RGBA',(W,H+58),BG)
            ImageDraw.Draw(t).text((14,20),actor['id']+' / '+direction+' / marker pending',font=FONT,fill='#F0D29B')
        else:t=tile(actor,direction,index,'existing source marker; anchor '+str(clip.get('releaseAnchorPx')))
        out.alpha_composite(t,(W*(i%2),(H+58)*(i//2)))
    save(out,actor['id']+'-source-markers.jpg')
(OUT/'frame-review-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n','utf-8')
print(json.dumps({'ok':True,'outputs':receipt['outputs']}))
