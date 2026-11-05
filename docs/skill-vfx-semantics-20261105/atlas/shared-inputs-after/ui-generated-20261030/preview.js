// Preview-only visual overlay in a same-origin iframe. No source assets or
// game files are modified; percentages are manual test data, not game values.
const frame=document.getElementById('demo'),controls=document.getElementById('controls');
let enhanced=true,installed=false;
document.getElementById('show').addEventListener('click',()=>{controls.hidden=!controls.hidden;});
function update() {
  for(const kind of ['hp','mp']) {
    const value=Number(document.getElementById(kind).value);
    document.getElementById(`${kind}Value`).textContent=`${value}%`;
    const fill=frame.contentDocument?.querySelector(`.candidate-${kind} .candidate-fill`);
    if(fill) { fill.style.height=`${value}%`; fill.style.visibility=value===0?'hidden':'visible'; }
    frame.contentDocument?.querySelector(`.candidate-${kind}`)?.classList.toggle('candidate-low',kind==='hp' && value>0 && value<=20);
    const number=frame.contentDocument?.querySelector(`.candidate-${kind} .candidate-number`);
    if(number) number.textContent=`${value}%`;
  }
}
for(const kind of ['hp','mp'])document.getElementById(kind).addEventListener('input',update);
document.getElementById('compare').addEventListener('click',event=>{
  enhanced=!enhanced;
  frame.contentDocument?.documentElement.classList.toggle('candidate-hidden',!enhanced);
  event.currentTarget.textContent=enhanced?'顯示 GROK 原版':'顯示素材候選';
});
frame.addEventListener('load',()=>{
  const doc=frame.contentDocument;if(!doc || installed)return;
  const style=doc.createElement('style');
  const orbUrl=new URL('/ui-generated-20261030/orb-frame-dark-v1.png',location.origin).href;
  const sheetUrl=new URL('/ui-generated-20261030/function-icons-sheet-dark-v1.png',location.origin).href;
  style.textContent=`.candidate-orb{position:absolute;inset:0;z-index:2;pointer-events:none}.candidate-inner{position:absolute;left:13.5%;top:11.8%;width:73%;height:73%;overflow:hidden;border-radius:50%;background:radial-gradient(circle at 35% 28%,#433026,#120a16 72%);box-shadow:inset 0 0 8px #000}.candidate-fill{position:absolute;bottom:0;left:0;width:100%;background:radial-gradient(circle at 38% 28%,#ff8972,#c51714 52%,#470505 90%);transition:height .28s ease}.candidate-fill::before{content:'';position:absolute;top:-2px;left:-12%;width:124%;height:6px;border-radius:45% 55% 48% 52%;background:#ffdfc677;box-shadow:0 1px 4px #ff9788;animation:candidate-wave 2.7s ease-in-out infinite alternate}.candidate-fill::after{content:'';position:absolute;inset:0;background:radial-gradient(circle at 26% 65%,#ffffff83 0 1px,transparent 2px),radial-gradient(circle at 67% 84%,#ffffff99 0 1px,transparent 2px),radial-gradient(circle at 54% 45%,#ffffff66 0 1px,transparent 2px);animation:candidate-bubbles 2.6s linear infinite}.candidate-mp .candidate-fill{background:radial-gradient(circle at 38% 28%,#bcf7ff,#1574d9 52%,#051f68 90%)}.candidate-mp .candidate-fill::before{background:#dcfaff88;box-shadow:0 1px 4px #91dbff}.candidate-inner::after{content:'';position:absolute;inset:0;border-radius:50%;background:radial-gradient(ellipse at 28% 20%,#ffffff7a,transparent 34%);box-shadow:inset 0 0 9px #0009}.candidate-low .candidate-inner{animation:candidate-low 1.5s ease-in-out infinite}.candidate-frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.candidate-number{position:absolute;top:39%;left:0;right:0;text-align:center;color:white;font:700 13px serif;text-shadow:0 1px 3px black}.candidate-active .orb canvas,.candidate-active .orb .ov{visibility:hidden}.candidate-hidden .orb canvas,.candidate-hidden .orb .ov{visibility:visible}.candidate-hidden .candidate-orb{display:none}.candidate-menu-icon{width:22px;height:22px;display:block;background-image:url('${sheetUrl}');background-size:300% 200%;flex:none}.candidate-active .fb canvas{display:none}.candidate-hidden .fb canvas{display:block}.candidate-hidden .candidate-menu-icon{display:none}@keyframes candidate-wave{from{transform:translateX(-3%) rotate(-1deg)}to{transform:translateX(3%) rotate(1deg)}}@keyframes candidate-bubbles{from{transform:translateY(5%);opacity:.35}50%{opacity:.8}to{transform:translateY(-20%);opacity:.12}}@keyframes candidate-low{50%{filter:brightness(1.22)}}@media(prefers-reduced-motion:reduce){.candidate-fill{transition:none}.candidate-fill::before,.candidate-fill::after,.candidate-low .candidate-inner{animation:none}}`;
  style.textContent += `.candidate-inner{left:22.5%;top:23.3%;width:55%;height:55.7%;background:radial-gradient(circle at 36% 26%,#222129,#07070a 75%);box-shadow:inset 0 0 12px #000}.candidate-fill{background:radial-gradient(ellipse at 48% 14%,#ed6e5b 0%,#ac2022 28%,#760811 65%,#2a0207 100%);box-shadow:inset 0 -5px 12px #240000}.candidate-fill::before{background:#ef958477;box-shadow:0 1px 4px #b52930}.candidate-mp .candidate-fill{background:radial-gradient(ellipse at 46% 16%,#a9f0ed 0%,#31888e 26%,#104452 62%,#04131e 100%);box-shadow:inset 0 -5px 12px #00111c}.candidate-mp .candidate-fill::before{background:#8fd6d4aa;box-shadow:0 1px 5px #357e8f}.candidate-number{top:45%;font-size:12px;text-shadow:0 1px 3px #000,0 0 4px #000}`;
  style.textContent += `html.candidate-active:not(.candidate-hidden) #bottom .orb{width:clamp(78px,25vw,102px)}@media (orientation:landscape) and (max-height:500px){html.candidate-active:not(.candidate-hidden) #bottom .orb{width:96px}}.candidate-mp .candidate-fill{background:radial-gradient(ellipse at 44% 16%,#6c9dde 0%,#285ca8 27%,#12377c 60%,#041335 100%);box-shadow:inset 0 -5px 12px #020920}.candidate-mp .candidate-fill::before{background:#9cbbefaa;box-shadow:0 1px 5px #4879c8}.candidate-number{font-family:Georgia,serif;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.02em;color:#fff4de;font-size:13px;text-shadow:0 1px 2px #000,0 0 4px #000,0 0 6px #000}`;
  doc.head.appendChild(style);doc.documentElement.classList.add('candidate-active');
  const darkScript=doc.createElement('script');darkScript.src='/ui-generated-20261030/dark-ui.js';doc.head.appendChild(darkScript);
  for(const [selector,kind] of [['.orb.red','hp'],['.orb.blue','mp']]) {
    const orb=doc.querySelector(selector);if(!orb)continue;
    const el=doc.createElement('div');el.className=`candidate-orb candidate-${kind}`;
    const inner=doc.createElement('div');inner.className='candidate-inner';const fill=doc.createElement('div');fill.className='candidate-fill';inner.appendChild(fill);
    const img=doc.createElement('img');img.className='candidate-frame';img.src=orbUrl;img.alt='';const number=doc.createElement('span');number.className='candidate-number';el.append(inner,img,number);orb.prepend(el);
  }
  doc.querySelectorAll('#fn .fb').forEach((button,index)=>{if(index>5)return;const icon=doc.createElement('i');icon.className='candidate-menu-icon';icon.style.backgroundPosition=`${[0,50,100][index%3]}% ${index<3?0:100}%`;button.prepend(icon);});
  installed=true;update();
  const hudScript=doc.createElement('script');hudScript.src='/ui-generated-20261030/hud-v2.js';doc.head.appendChild(hudScript);
});
