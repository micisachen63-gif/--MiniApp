import {ART,ZODIAC,decodeResult,encodeResult} from './model.js';
import {endingForLife} from './ending-story.js';
import {shareDetails,telegramShareUrl,threadsShareUrl,createCardGuard} from './share-model.js';
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
const button=(text,fn,cls='fate-quiet')=>{const b=el('button',cls,text);b.type='button';b.onclick=fn;return b};
function wrap(c,text,x,y,max,line){let row='';for(const char of text){if(c.measureText(row+char).width>max){c.fillText(row,x,y);row=char;y+=line}else row+=char;}if(row)c.fillText(row,x,y)}
export async function drawShareCard(r,format,{ImageType=Image,document:doc=document}={}){
 const canvas=doc.createElement('canvas'),w=1080,h=format==='story'?1920:1350;canvas.width=w;canvas.height=h;const c=canvas.getContext('2d');if(!c)throw Error('此裝置暫時無法繪製圖卡');
 const image=new ImageType();image.src=r.version>=4?endingForLife(r).illustration:ART+'journey.webp';await image.decode();await doc.fonts.ready;
 c.fillStyle='#0a1425';c.fillRect(0,0,w,h);const ih=h*.65,scale=Math.max(w/image.width,ih/image.height);c.drawImage(image,(w-image.width*scale)/2,0,image.width*scale,image.height*scale);
 const gradient=c.createLinearGradient(0,ih*.32,0,h*.8);gradient.addColorStop(0,'#0a142500');gradient.addColorStop(.5,'#0a1425dc');gradient.addColorStop(1,'#0a1425');c.fillStyle=gradient;c.fillRect(0,0,w,h);
 const shade=c.createLinearGradient(0,0,0,245);shade.addColorStop(0,'#07111ed9');shade.addColorStop(1,'#07111e00');c.fillStyle=shade;c.fillRect(0,0,w,245);
 c.strokeStyle='#c0a167';c.lineWidth=2;c.strokeRect(32,32,w-64,h-64);c.strokeStyle='#b69b5a66';c.strokeRect(44,44,w-88,h-88);
 c.textAlign='center';c.fillStyle='#e4c58a';c.font='26px Georgia,"Microsoft JhengHei",serif';c.fillText('星 穹 旅 誌   ·   命 運 旅 章',540,111);c.font='20px Georgia,serif';c.fillStyle='#d7dce2';c.fillText('THE LAST STAR LANTERN',540,152);
 const y=format==='story'?1000:640;c.fillStyle='#cbd1d7';c.font='26px "Microsoft JhengHei",serif';c.fillText(`${r.zodiac!==null?ZODIAC[r.zodiac]+'座 · ':''}${r.identity[0]}`,540,y);
 c.fillStyle=r.ending.color;c.font='64px Georgia,"Microsoft JhengHei",serif';c.fillText(r.ending.title,540,y+110);c.strokeStyle=r.ending.color;c.beginPath();c.moveTo(440,y+150);c.lineTo(640,y+150);c.stroke();
 c.fillStyle='#f3e5ca';c.font='35px Georgia,"Microsoft JhengHei",serif';wrap(c,r.ending.quote,540,y+220,800,57);c.fillStyle='#aebccf';c.font='26px "Microsoft JhengHei",sans-serif';wrap(c,r.ending.question,540,y+370,820,44);
 c.fillStyle='#dfc994';c.font='25px "Microsoft JhengHei",sans-serif';c.fillText('你的故事，尚未寫定。',540,h-192);c.fillStyle='#aab6c9';c.font='20px "Microsoft JhengHei",sans-serif';c.fillText('不用登入 · 一世流轉 · 遇見不同的自己',540,h-145);
 c.font='15px "Microsoft JhengHei",sans-serif';c.fillText(shareDetails(r.code).url.replace('https://',''),540,h-103,950);c.font='14px Georgia,serif';c.fillText('Game Producer · ミカサ   |   原創遊戲故事，非現實命運預測',540,h-66);
 return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('輸出失敗')),'image/png'));
}
export function mountSharePanel(p,{result,initialShow=true,onPrivacyChange=()=>{},client,draw=drawShareCard,host=window}){
 const guard=createCardGuard(),nav=host.navigator,urls=host.URL;let file=null,previewUrl=null,prepared=null,context=null,disposed=false,sharing=false,producing=false;
 const check=el('label','fate-check'),cb=el('input');cb.type='checkbox';cb.checked=initialShow&&result.zodiac!==null;cb.disabled=result.zodiac===null;check.append(cb,el('span','','分享圖片與連結顯示星座'));p.append(check);
 const label=el('label','fate-field','分享圖尺寸');label.htmlFor='fate-format';const format=el('select','fate-format');format.id='fate-format';for(const [v,t]of [['post','IG／Threads · 1080 × 1350'],['story','限時動態 · 1080 × 1920']]){const o=el('option','',t);o.value=v;format.append(o)}p.append(label,format);
 const preview=el('div');preview.id='fate-preview';const status=el('p','fate-status');status.id='fate-status';status.setAttribute('role','status');const fallback=el('div','fate-share-fallback');p.append(preview,status,fallback);
 const selected=()=>cb.checked||result.zodiac===null?result:decodeResult(encodeResult({...result,zodiac:null}));
 const details=()=>shareDetails(selected().code,format.value);
 const valid=token=>!disposed&&p.isConnected&&guard.current(token);
 const say=s=>{if(!disposed)status.textContent=s};
 const revoke=()=>{if(previewUrl){urls.revokeObjectURL(previewUrl);previewUrl=null}};
 const invalidate=()=>{guard.invalidate();file=null;prepared=null;producing=false;make.disabled=false;revoke();preview.replaceChildren();fallback.replaceChildren();tg.disabled=false;tg.textContent='TG 圖卡';say('請重新製作名帖，套用最新尺寸與星座設定。');};
 cb.onchange=()=>{onPrivacyChange(cb.checked);invalidate()};format.onchange=invalidate;
 const requireFile=()=>{if(file)return true;say('請先製作名帖，確認預覽後再分享或儲存。');return false};
 const fallLink=(title,url)=>{const a=el('a','fate-quiet',title);a.href=url;a.target='_blank';a.rel='noopener noreferrer';fallback.replaceChildren(a);return a};
 async function openDestination(action,url){try{if(client){const v=await client.native(action,{code:selected().code});if(!v.opened&&v.url)fallLink('點這裡開啟',v.url);}else if(!host.open(url,'_blank','noopener,noreferrer'))fallLink('點這裡開啟',url);say(action==='threads-draft'?'已請開啟脆草稿；圖片請從名帖儲存後加入，最後發佈由你決定。':'已請開啟TG分享選擇，尚未代你送出訊息。');}catch(e){say(e.message);fallLink('點這裡開啟',url)}}
 async function prepare(token){if(!context?.native?.prepared||!client)return false;tg.disabled=true;tg.textContent='準備 TG…';try{const v=await client.native('prepare-share',{code:selected().code,format:format.value});if(valid(token)){prepared={...v,code:selected().code,format:format.value};return true;}return false;}catch(e){if(valid(token))say(e.message+' 可先儲存圖片或分享TG連結。');return false;}finally{if(valid(token)){tg.disabled=false;tg.textContent='TG 圖卡'}}}
 const make=button('製作我的旅人名帖',async()=>{if(producing)return;producing=true;make.disabled=true;const token=guard.begin(),r=selected(),size=format.value;say('正在為你描金、裝訂這頁旅章…');try{const blob=await draw(r,size);if(!valid(token))return;revoke();file=new host.File([blob],`星穹旅誌-${r.ending.title}-${size}.png`,{type:'image/png'});previewUrl=urls.createObjectURL(blob);const img=el('img','fate-preview');img.src=previewUrl;img.alt=`${r.ending.title}分享名帖預覽`;preview.replaceChildren(img);say('名帖已完成。先看預覽，再選擇分享或儲存。');await prepare(token);}catch{if(valid(token))say('圖卡暫時無法製作，請重試；仍可複製旅章連結。');}finally{if(valid(token)){producing=false;make.disabled=false}}},'fate-primary');p.append(make);
 const tg=button('TG 圖卡',async()=>{if(!requireFile()||sharing)return;if(!context?.native?.prepared){await openDestination('telegram-link',telegramShareUrl(selected().code));return;}if(!prepared||prepared.expirationDate*1000<=Date.now()+5000){if(await prepare(guard.begin()))say('TG圖卡已更新，請再點一次「TG圖卡」開啟分享。');return;}sharing=true;tg.disabled=true;try{const v=await client.native('share-message',{id:prepared.id});say(v.sent?'TG已回報分享完成。':'已取消TG分享，名帖仍保留。');}catch(e){say(e.message)}finally{sharing=false;if(!disposed)tg.disabled=false}});
 tg.hidden=true;
 const device=button('IG 分享',async()=>{if(!requireFile()||sharing)return;try{if(!nav.canShare?.({files:[file]})){say('此環境未提供圖片分享選單。請儲存名帖、複製文案，再到IG加入圖片。');fallLink('開啟 Instagram','https://www.instagram.com/');return;}sharing=true;device.disabled=true;await nav.share({files:[file],title:'星穹旅誌 · 命運旅章'});say('已交給系統分享選單；是否發文由你確認。');}catch(e){say(e.name==='AbortError'?'已取消分享，名帖仍保留。':'分享選單未能開啟。請儲存名帖，再到IG加入圖片。');}finally{sharing=false;device.disabled=false}});
 const threads=button('脆草稿',()=>openDestination('threads-draft',threadsShareUrl(selected().code)));
 const save=button('儲存圖片',async()=>{if(!requireFile())return;try{if(context?.native?.download&&client){const v=await client.native('download-image',{code:selected().code,format:format.value});say(v.accepted?'TG已接受下載請求，請查看下載項目；這不表示已存進相簿。':'已取消下載，仍可長按上方名帖儲存。');return;}const a=el('a');a.href=previewUrl;a.download=file.name;host.document.body.append(a);a.click();a.remove();say('已提出圖片下載請求。iPhone若未提供下載，可長按上方名帖儲存至照片。');}catch(e){say('下載未能開啟，可長按上方名帖儲存，或用下方原圖下載。');}finally{if(context?.native?.telegram)fallLink('下載原圖',details().imageUrl)}});
 const copy=button('複製文案',async()=>{try{await nav.clipboard.writeText(details().caption);say('文案與正式分享連結已複製，貼到IG或脆的草稿即可。');}catch{const box=el('textarea','fate-date');box.readOnly=true;box.value=details().caption;box.setAttribute('aria-label','手動複製分享文案');fallback.replaceChildren(box);box.select();say('請長按下方文字複製；上方名帖仍可長按儲存。');}});
 const link=button('TG 連結',()=>openDestination('telegram-link',telegramShareUrl(selected().code)));
 const actions=el('div','fate-share-actions');actions.append(tg,device,threads,save,copy,link);p.append(actions,el('p','fate-note','IG：在系統選單選 Instagram；沒有出現時，先儲存名帖再手動加入。脆草稿會帶入文案與連結，圖片須另外加入。選單與草稿都由你最後確認發佈。'));
 if(client)client.connect().then(v=>{if(!disposed){context=v;tg.hidden=!v.native?.prepared;tg.textContent='TG 圖卡';}}).catch(()=>{});
 return {dispose(){disposed=true;guard.invalidate();revoke();file=null;prepared=null},getFile:()=>file};
}
