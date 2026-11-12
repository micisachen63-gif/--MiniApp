import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
test('hall uses public class metadata to expose thief filtering while preserving rank pagination',()=>{
 const context={window:{}};vm.runInNewContext(fs.readFileSync(new URL('../public/hero-hall-ui.js',import.meta.url),'utf8'),context);
 const heroes=Array.from({length:25},(_,i)=>({id:String(i),name:'盜賊'+i,baseClass:'thief',className:'盜賊',level:120-i,power:500-i}));
 const helpers={esc:String,fmt:String,portrait:h=>'exact-thief-'+h.id+'.png'};
 assert(!context.window.RpgHeroHallUI.render({heroes},{filter:'all'},helpers).includes('data-hall-class="thief"'));
 const first=context.window.RpgHeroHallUI.render({heroes},{filter:'thief',page:1},{...helpers,includeThief:true});
 assert(first.includes('data-hall-class="thief"'));assert.equal((first.match(/data-hall-hero=/g)||[]).length,20);assert(first.includes('exact-thief-0.png'));assert(first.includes('1 / 2 頁'));
 assert(first.includes('hall-podium'));assert(first.includes('medal-1.svg'));assert(first.includes('frame-gold.svg'));
 assert(first.includes('hall-list'));assert(first.includes('第 4 名'));assert(first.includes('exact-thief-3.png'));
 assert(!/冠軍|亞軍|季軍/.test(first),'rank text pills must not cover portraits');
 const second=context.window.RpgHeroHallUI.render({heroes},{filter:'thief',page:2},{...helpers,includeThief:true});
 assert.equal((second.match(/data-hall-hero=/g)||[]).length,5);assert(second.includes('exact-thief-20.png'));assert(second.includes('第 21 名'));
 assert(!second.includes('hall-podium'),'later pages are list-only');
});
