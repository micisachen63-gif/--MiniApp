import {identitySign} from './zodiac-sign.js';
export function mountZodiacSky(target,life,{doc=document}={}){
 const sign=identitySign(life),node=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 target.classList.add('fate-sky-zodiac');const crest=node('figure','fate-zodiac-crest'),image=node('img','fate-zodiac-art');image.width=200;image.height=200;image.decoding='async';image.alt='';image.setAttribute('aria-hidden','true');image.src='/fate/zodiac/'+(sign?sign.id:'wheel')+'.svg';
 const caption=node('figcaption','fate-zodiac-caption');
 if(sign){crest.dataset.zodiac=String(sign.index);crest.setAttribute('aria-label',`${sign.name}座 · ${sign.source==='generated'?'此世生成的星座圖騰':'此世守護星座'}`);caption.append(node('small','fate-zodiac-latin',sign.latin),node('strong','fate-zodiac-name',sign.name+'座'),node('span','fate-zodiac-subtitle',sign.source==='generated'?'此世星座圖騰':'此世守護星座'),node('p','fate-zodiac-line',sign.line));}
 else{crest.classList.add('fate-zodiac-awaiting');crest.setAttribute('aria-label','十二星環 · 尚未開啟新的一世');caption.append(node('small','fate-zodiac-latin','THE TWELVE STAR SEALS'),node('strong','fate-zodiac-name','十二星環'),node('p','fate-zodiac-line','下一趟人生，將點亮屬於此世的星光。'));}
 crest.append(image,caption);target.replaceChildren(crest);return sign;
}
