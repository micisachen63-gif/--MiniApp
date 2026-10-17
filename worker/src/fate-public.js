import {decodeResult,shareText,ART,publicUrl} from '../public/fate/model.js';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Public, cosmetic narrative only: no auth, no D1, no player lookup or mutation.
export function fatePublic(request){
 const url=new URL(request.url),m=/^\/fate\/r\/([^/]+)$/.exec(url.pathname);
 if(!m)return null;
 const r=decodeResult(m[1]);
 const headers={'content-type':'text/html; charset=utf-8','cache-control':r?'public, max-age=3600':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; img-src 'self' data: blob:; media-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"};
 if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{...headers,allow:'GET, HEAD'}});
 if(!r)return new Response(request.method==='HEAD'?null:'<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>星圖走散了｜星穹旅誌</title><link rel="stylesheet" href="/fate/style.css"></head><body><main class="fate-loading"><small>星穹旅誌 · 命運旅章</small><h1>這頁星圖走散了。</h1><p>連結可能不完整。重新啟程，讓下一段故事找到你。</p><a class="fate-primary" href="/fate/">展開新的旅章</a></main></body></html>',{status:404,headers});
 const canonical=publicUrl(r.code),title=`${r.ending.title}｜星穹旅誌・命運旅章`,desc=shareText(r),art='https://star-journal-rpg-bot.micisachen.workers.dev/fate-card/'+r.code+'/post.jpg?v=20261016-countries9';
 const html=`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canonical)}"><meta property="og:image" content="${art}"><meta property="og:image:width" content="1080"><meta property="og:image:height" content="1350"><meta name="twitter:card" content="summary_large_image"><link rel="canonical" href="${esc(canonical)}"><link rel="stylesheet" href="/fate/style.css?v=20261017-fatedm1"><link rel="stylesheet" href="/fate/daily.css?v=20261017-fatedm1"></head><body><main id="fate"><div class="fate-loading"><small>星穹旅誌 · 命運旅章</small><h1>${esc(r.ending.title)}</h1><p>${esc(r.ending.quote)}</p><p>${esc(r.ending.body)}</p><a href="/fate/">走出自己的旅章</a></div></main><script type="module" src="/fate/app.js?v=20261017-fatedm1"></script></body></html>`;
 return new Response(request.method==='HEAD'?null:html,{headers});
}
