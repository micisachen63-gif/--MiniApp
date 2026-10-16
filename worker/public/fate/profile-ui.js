import {PLACES} from './places.js';
// The entry page owns its birthday input. These optional details stay in the
// caller's in-memory state and are never written to browser storage here.
export function renderStartBirthFields(p,{value={},onChange=()=>{}}={}){
 const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
 const box=el('section','fate-start-birth');box.setAttribute('aria-label','選填出生資料');
 const field=(parent,label,type,current)=>{const wrap=el('label','fate-field',label),input=el('input','fate-date');input.type=type;input.value=current??'';input.setAttribute('aria-label',label);wrap.append(input);parent.append(wrap);return input;};
 const select=(parent,label,items,current)=>{const wrap=el('label','fate-field',label),input=el('select','fate-date');input.setAttribute('aria-label',label);for(const[key,text]of items){const option=el('option','',text);option.value=key;input.append(option);}input.value=current??'';wrap.append(input);parent.append(wrap);return input;};
 const time=field(box,'出生時間 · 選填','time',value.time);time.step='60';
 const place=select(box,'出生地 · 選填',[['','暫不提供'],...PLACES.map(a=>[a[0],a[1]]),['custom','其他地點 · 自行填寫']],value.placeId);
 const custom=el('div','fate-custom-place');custom.hidden=place.value!=='custom';
 const placeLabel=field(custom,'地點名稱','text',value.placeLabel),zone=field(custom,'IANA 時區（例如 America/New_York）','text',value.zone),lat=field(custom,'緯度（-65 至 65）','number',value.lat),lon=field(custom,'經度（-180 至 180）','number',value.lon);
 placeLabel.maxLength=60;zone.maxLength=80;zone.spellcheck=false;lat.min='-65';lat.max='65';lon.min='-180';lon.max='180';lat.step=lon.step='any';
 const fold=select(custom,'夏令時間遇到重複鐘點',[['earlier','較早一次（預設）'],['later','較晚一次']],value.fold||'earlier');
 custom.append(el('p','fate-note','若不確定當地時區或夏令時間，可先不填出生時間；不會以猜測代替你的資料。'));box.append(custom);
 const more=el('details','fate-journal');more.append(el('summary','','補充資料 · 選填'));more.open=!!value.sex;
 const sex=select(more,'排盤用性別（與角色性別無關）',[['','暫不提供'],['m','男'],['f','女']],value.sex);box.append(more);
 const consent=el('label','fate-check'),check=el('input');check.type='checkbox';check.checked=value.consent===true;consent.append(check,el('span','','同意保存出生資料，供每日旅箋使用；之後可隨時刪除。'));box.append(consent);
 const note=el('p','fate-note','時間、地點與排盤用性別可選填。資料不足時提供「生活靈感」；未勾選同意，就不保存出生檔案。生日與其他出生資料不會放進分享圖卡。');box.append(note);p.append(box);
 const numberOrNull=input=>input.value.trim()===''?null:Number(input.value);
 const read=()=>({time:time.value||null,placeId:place.value||null,sex:sex.value||null,fold:fold.value||'earlier',...(place.value==='custom'?{placeLabel:placeLabel.value.trim(),zone:zone.value.trim(),lat:numberOrNull(lat),lon:numberOrNull(lon)}:{})});
 const changed=()=>{custom.hidden=place.value!=='custom';onChange({...read(),consent:check.checked,placeLabel:placeLabel.value,zone:zone.value,lat:lat.value,lon:lon.value});};
 for(const input of [time,place,placeLabel,zone,lat,lon,fold,sex,check]){input.addEventListener('input',changed);input.addEventListener('change',changed);}
 return {read,consented:()=>check.checked};
}
export function renderProfile(p,{profile={},onSave,onDelete}){
 const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
 const box=el('details','fate-journal fate-profile'),birth=profile.birth||{};box.append(el('summary','',profile.saved?'出生檔案 · 查看、更新或刪除':'每日提醒的出生檔案（自願保存）'));
 box.append(el('p','fate-note','出生檔案獨立於遊戲角色。只有勾選同意後才會保存，供每日提醒使用；可隨時刪除。生日、時間、地點與性別不會出現在分享圖卡。缺少任一項時清楚標示為生活靈感。'));
 const form=el('form');const field=(label,type,value='')=>{const l=el('label','fate-field',label),i=el('input','fate-date');i.type=type;i.value=value;l.append(i);form.append(l);return i};
 const date=field('出生年月日','date',birth.date),time=field('出生時間（當地鐘錶時間，可留白）','time',birth.time);date.min='1900-01-01';date.max=new Date().toLocaleDateString('sv-SE');
 const select=(label,items,value)=>{const l=el('label','fate-field',label),s=el('select','fate-date');s.setAttribute('aria-label',label);for(const [key,title]of items){const o=el('option','',title);o.value=key;s.append(o)}s.value=value||'';l.append(s);form.append(l);return s};
 const place=select('出生地（可留白）',[['','不知道／暫不提供'],...PLACES.map(a=>[a[0],a[1]]),['custom','其他地點 · 自行填寫']],birth.place?.id),custom=el('div','fate-custom-place');
 const customField=(label,type,value)=>{const l=el('label','fate-field',label),i=el('input','fate-date');i.type=type;i.value=value??'';l.append(i);custom.append(l);return i};
 const placeLabel=customField('地點名稱','text',birth.place?.label),zone=customField('IANA 時區（例如 America/New_York）','text',birth.place?.zone),lat=customField('緯度（目前支援 -65 至 65）','number',birth.place?.lat),lon=customField('經度（-180 至 180）','number',birth.place?.lon);lat.min=-65;lat.max=65;lon.min=-180;lon.max=180;lat.step=lon.step='any';placeLabel.maxLength=60;zone.maxLength=80;custom.hidden=place.value!=='custom';place.onchange=()=>custom.hidden=place.value!=='custom';form.append(custom);
 const sex=select('排盤用性別（選填，與角色性別無關）',[['','暫不提供'],['m','男'],['f','女']],birth.sex),fold=select('夏令時間重複鐘點的對應',[['earlier','較早一次（預設）'],['later','較晚一次']],birth.fold||'earlier');
 form.append(el('p','fate-note','若當地時鐘因夏令時間倒轉，同一鐘點可能發生兩次；不確定可先留白出生時間。不存在的當地時間將要求更正。'));
 const consent=el('label','fate-check'),check=el('input');check.type='checkbox';consent.append(check,el('span','','我同意保存這份出生資料，供每日提醒使用，並知道可以隨時刪除。'));form.append(consent);
 const status=el('p','fate-status');status.setAttribute('role','status');const save=el('button','fate-primary','同意並保存出生檔案');save.type='submit';form.append(save,status);let saveId=null,deleteId=null;
 form.addEventListener('input',()=>{saveId=null;});
 form.onsubmit=async e=>{e.preventDefault();if(!check.checked){status.textContent='請先勾選同意，或直接不保存。';return;}if(!date.value){status.textContent='請填寫有效的出生日期。';return;}if(place.value==='custom'&&(!zone.value.trim()||!lat.value||!lon.value||!placeLabel.value.trim())){status.textContent='自訂地點請補上名稱、IANA 時區與經緯度。';return;}saveId||=crypto.randomUUID();save.disabled=true;status.textContent='正在保存…';try{await onSave({requestId:saveId,consent:true,birth:{date:date.value,time:time.value||null,placeId:place.value||null,sex:sex.value||null,fold:fold.value,...(place.value==='custom'?{lat:Number(lat.value),lon:Number(lon.value),zone:zone.value.trim(),placeLabel:placeLabel.value.trim()}:{})}});status.textContent='出生檔案已保存。';saveId=null;}catch(error){status.textContent=error.message+' 可按保存重試。';}finally{save.disabled=false}};
 box.append(form);if(profile.saved){const del=el('button','fate-subtle','刪除已保存的出生資料');del.type='button';del.onclick=async()=>{deleteId||=crypto.randomUUID();del.disabled=true;try{await onDelete({requestId:deleteId});form.reset();box.open=false;status.textContent='出生資料已刪除。';del.remove();}catch(error){status.textContent=error.message+' 可重試刪除。';}finally{del.disabled=false}};box.append(del);}p.append(box);
}
