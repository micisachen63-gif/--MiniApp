import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('disposing a forge restores scrolling and Telegram swipes before the overlay closes', () => {
  const source=readFileSync(new URL('../public/forge-ritual.js',import.meta.url),'utf8');
  const body={style:{cssText:'original body'}}, html={style:{cssText:'original html'}};
  let swipe=true, restoredY, disconnected=false;
  const window={scrollY:42,scrollTo:(_,y)=>{restoredY=y;},Telegram:{WebApp:{
    isVerticalSwipesEnabled:true,disableVerticalSwipes(){swipe=false;},enableVerticalSwipes(){swipe=true;}
  }}};
  const context={window,clearInterval,document:{body,documentElement:html},MutationObserver:class{
    observe(){} disconnect(){disconnected=true;}
  }};
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'lockPage({hidden:false});})();'),context);
  assert.equal(swipe,false);
  body.style.cssText='locked';html.style.cssText='locked';
  window.RpgForgeRitual.dispose();
  assert.equal(body.style.cssText,'original body');
  assert.equal(html.style.cssText,'original html');
  assert.equal(restoredY,42);
  assert.equal(swipe,true);
  assert.equal(disconnected,true);
});
