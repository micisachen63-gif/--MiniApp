"""Build VFX-only fallback metadata and diagnostic overlays from immutable source artwork."""
import argparse, hashlib, json, math
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from PIL import Image, ImageDraw, ImageFont

parser=argparse.ArgumentParser()
parser.add_argument('--finalize',action='store_true')
args=parser.parse_args()
base=Path('worker/art-production/skill-vfx-actor-20261104')
inventory=json.loads((base/'source-inventory.json').read_text(encoding='utf-8'))
source_root=Path(inventory['sourceRoot'])
now=datetime.now(timezone.utc).isoformat()
sha=lambda data:hashlib.sha256(data).hexdigest()
directions=['up','down','right','left']
# Coordinates are in the release frame crop, before any clip/frame mirror.
selected={
 'sword':{
  'up':(2,[386,236],'Visible blade close to its tip at the source contact marker.'),
  'down':(2,[8,260],'Visible forward blade close to its tip at the source contact marker.'),
  'right':(3,[434,406],'First forward blade extension after the raised-sword windup; point is just inside the blade tip.'),
  'left':(3,[434,406],'Mirrored source of right; first forward blade extension after the raised-sword windup.')
 },
 'archer':{
  'up':(2,[123,115],'Bow grip / arrow departure line at the existing release marker.'),
  'down':(2,[154,190],'Front-facing bow grip / arrow departure line at the existing release marker.'),
  'right':(5,[464,380],'First clearly separated arrow in flight; origin remains at the bow grip rather than on the travelling arrow.'),
  'left':(5,[464,380],'Mirrored source of right; first clearly separated arrow in flight with origin at the bow grip.')
 },
 'mage':{
  'up':(2,[89,93],'Center of the visible raised casting palm, matching the palm-origin semantics of the native side clips.'),
  'down':(2,[250,131],'Center of the visible forward casting palm, matching the palm-origin semantics of the native side clips.')
 },
 'thief':{
  'up':(2,[268,24],'Inside the leading raised dagger tip at the existing contact marker.'),
  'down':(2,[132,215],'Midpoint between the two forward dagger tips at the existing contact marker.')
 }
}
sources={}
profiles=[]
coverage=[]
render_records=[]

def source_image(url):
    parsed=urlsplit(url)
    assert not parsed.netloc and parsed.path.startswith('/ui-generated-20261030/characters-v1/assets/')
    asset=inventory['assets'][parsed.path]
    path=Path(asset['path'])
    raw=path.read_bytes()
    assert sha(raw)==asset['sha256'], 'Source asset changed: '+str(path)
    img=Image.open(path).convert('RGBA')
    source={'url':url,'sha256':asset['sha256'],'width':img.width,'height':img.height}
    sources[parsed.path]={'path':str(path),**source,'bytes':len(raw)}
    return img,source

for actor in inventory['actors']:
    raw=(source_root/'character-preview-actors'/(actor['id']+'.json')).read_bytes()
    assert sha(raw)==actor['metadataSha256'],'Source metadata changed: '+actor['id']
    for direction in directions:
        clip=actor['attack'][direction]
        count=len(clip['frames'])
        durations=[f['durationMs'] for f in clip['frames']]
        assert all(isinstance(x,(int,float)) and math.isfinite(x) and x>0 for x in durations)
        native_index=clip.get('releaseFrame',clip.get('hitFrame'))
        native_anchor=clip.get('releaseAnchorPx')
        fills={'marker':native_index is None,'anchor':native_anchor is None}
        authored=selected.get(actor['id'],{}).get(direction)
        assert authored is not None or not any(fills.values())
        index=native_index if not fills['marker'] else authored[0]
        point=native_anchor if not fills['anchor'] else authored[1]
        assert isinstance(index,int) and not isinstance(index,bool) and 0<=index<count
        frame=clip['frames'][index]
        assert len(point)==2 and all(math.isfinite(x) for x in point)
        assert 0<=point[0]<=frame['rect'][2] and 0<=point[1]<=frame['rect'][3]
        assert frame['bodyHeight']>0
        img,source=source_image(frame['url'])
        sx,sy,sw,sh=frame['rect']
        assert min(sx,sy)>=0 and sw>0 and sh>0 and sx+sw<=img.width and sy+sh<=img.height
        marker_key='releaseFrame' if 'releaseFrame' in clip else 'hitFrame' if 'hitFrame' in clip else None
        entry={
            'actorId':actor['id'],'actorKey':actor.get('key'),'direction':direction,'action':'attack',
            'status':'visually-reviewed' if args.finalize else 'anchor-overlay-review-pending',
            'sourceMetadataUrl':actor['metadataUrl'],'sourceMetadataSha256':actor['metadataSha256'],
            'source':source,'frameCount':count,'frameDurationsMs':durations,
            'uniformFps':1000/durations[0] if len(set(durations))==1 else None,
            'clipMirrorX':bool(clip.get('mirrorX')),
            'releaseFrame':index,'releaseAtMs':sum(durations[:index]),'releaseAnchorPx':point,
            'frame':{'rect':frame['rect'],'anchor':frame['anchor'],'bodyHeight':frame['bodyHeight'],'mirrorX':bool(frame.get('mirrorX'))},
            'fills':fills,'authority':'vfx-visual-review',
            'markerAuthority':'vfx-visual-review' if fills['marker'] else 'source:'+marker_key,
            'anchorAuthority':'vfx-visual-review' if fills['anchor'] else 'source:releaseAnchorPx',
            'reviewNote':authored[2] if authored else 'Native source marker and anchor; no fallback needed.',
            'sourceApproval':{'approved':actor.get('approved'),'readiness':actor.get('readiness')}
        }
        if any(fills.values()):profiles.append(entry)
        coverage.append({
            'actorId':actor['id'],'direction':direction,'releaseFrame':index,'releaseAtMs':entry['releaseAtMs'],
            'releaseAnchorPx':point,'fills':fills,'markerAuthority':entry['markerAuthority'],'anchorAuthority':entry['anchorAuthority'],
            'sourceMetadataSha256':entry['sourceMetadataSha256'],'sourceUrl':source['url'],'sourceSha256':source['sha256'],
            'frame':entry['frame'],'clipMirrorX':entry['clipMirrorX'],'pending':False
        })
        render_records.append((entry,clip,img))
assert len(profiles)==12 and sum(p['fills']['marker'] for p in profiles)==4
assert sum(p['fills']['anchor'] for p in profiles)==12 and len(coverage)==16
manifest={
    'schemaVersion':1,'generatedAt':now,'authority':'vfx-visual-review',
    'description':'本線 VFX 視覺審查選定的角色出手時間與發射點補項；並非來源原有 marker 或角色美術核准。',
    'priority':'Valid native releaseFrame/hitFrame and releaseAnchorPx always win; fill only absent fields after metadata and release-image SHA256 plus frame-structure verification.',
    'coordinateSpace':'release frame rect-local source pixels before clipMirrorX XOR frame.mirrorX',
    'sourceReadOnly':True,'sourceArtworkApprovalChanged':False,
    'reviewStage':'complete' if args.finalize else 'anchor-overlay-review-pending',
    'profiles':profiles
}
(base/'actor-profiles.candidate.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',18)
small=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',14)
gold=(255,198,71,255)
cyan=(54,220,242,255)
artifacts=[]
for group,actor_ids in [('sword-archer',['sword','archer']),('mage-thief',['mage','thief'])]:
    sheet=Image.new('RGB',(1920,1140),(16,25,36))
    for e,clip,img in render_records:
        if e['actorId'] not in actor_ids:continue
        col=directions.index(e['direction']);row=actor_ids.index(e['actorId'])
        ox,oy=col*480,row*570
        sx,sy,sw,sh=e['frame']['rect']; f=e['frame']
        crop=img.crop((sx,sy,sx+sw,sy+sh))
        factor=300/f['bodyHeight']
        crop=crop.resize((round(sw*factor),round(sh*factor)),Image.Resampling.LANCZOS)
        canvas=Image.new('RGBA',(480,512))
        canvas.alpha_composite(crop,(round(240-f['anchor'][0]*factor),round(470-f['anchor'][1]*factor)))
        mirror=e['clipMirrorX']!=f['mirrorX']
        if mirror:canvas=canvas.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        sheet.paste(canvas,(ox,oy+58),canvas)
        draw=ImageDraw.Draw(sheet)
        draw.text((ox+12,oy+8),f"{e['actorId']} / {e['direction']} / frame {e['releaseFrame']} / {e['releaseAtMs']} ms",font=font,fill=(232,237,244))
        fill_text='review: '+','.join(k for k,v in e['fills'].items() if v) if any(e['fills'].values()) else 'native marker + anchor'
        draw.text((ox+12,oy+32),fill_text+'  '+str(e['releaseAnchorPx']),font=small,fill=gold if any(e['fills'].values()) else cyan)
        px=240+(e['releaseAnchorPx'][0]-f['anchor'][0])*factor
        py=470+(e['releaseAnchorPx'][1]-f['anchor'][1])*factor
        if mirror:px=480-px
        px+=ox;py+=oy+58
        color=gold if e['fills']['anchor'] else cyan
        draw.ellipse((px-4,py-4,px+4,py+4),outline=color,width=2)
        draw.line((px-10,py,px-5,py),fill=color,width=1)
        draw.line((px+5,py,px+10,py),fill=color,width=1)
        draw.line((px,py-10,px,py-5),fill=color,width=1)
        draw.line((px,py+5,px,py+10),fill=color,width=1)
        footx=480-240 if mirror else 240
        draw.line((ox+footx-8,oy+58+470,ox+footx+8,oy+58+470),fill=(78,118,140),width=1)
        draw.line((ox+footx,oy+58+462,ox+footx,oy+58+478),fill=(78,118,140),width=1)
    destination=base/('release-points-'+group+'.jpg')
    sheet.save(destination,quality=94,subsampling=0)
    artifacts.append({'path':str(destination),'sha256':sha(destination.read_bytes()),'width':sheet.width,'height':sheet.height})
receipt={
    'schemaVersion':1,'generatedAt':now,'reviewStage':manifest['reviewStage'],
    'method':'Read-only source crop normalization BODY=300 into 480x512 tiles at foot [240,470]; technical overlay only. Source art is unchanged.',
    'sourceReadOnly':True,'sourceArtworkApprovalChanged':False,
    'counts':{'directions':16,'fallbackProfiles':12,'newMarkers':4,'newAnchors':12,'nativeCompleteDirections':4,'pending':0},
    'coverage':coverage,'releaseSourceAssets':sources,'artifacts':artifacts,
    'checks':['Metadata SHA256 equals the reviewed inventory.',
        'Original release-image SHA256 equals the reviewed inventory.',
        'Release frame, positive durations, image bounds, crop-local point bounds and nonzero bodyHeight are valid.',
        'ReleaseAtMs is the exact sum of preceding per-frame durations; uniformFps is null for variable timing.',
        'Native marker and anchor priority is preserved; mirrored coordinates are stored unmirrored.',
        'No original character asset, metadata, catalog, or queue was modified by these scripts.']
}
(base/'profile-provenance.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
if args.finalize:
    target=Path('worker/public/skill-vfx-actor-profiles.json')
    target.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'ok':True,'target':str(target),'sha256':sha(target.read_bytes()),'counts':receipt['counts'],'reviewStage':manifest['reviewStage']}))
else:
    print(json.dumps({'ok':True,'candidate':str(base/'actor-profiles.candidate.json'),'counts':receipt['counts'],'reviewStage':manifest['reviewStage'],'artifacts':artifacts}))
