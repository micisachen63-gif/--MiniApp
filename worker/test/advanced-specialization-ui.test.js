import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {metaView} from '../src/app.js';
import {nodeFor} from '../src/game/stats.js';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=app.indexOf('  function advancedPreviewNodes('),end=app.indexOf('  function elfPathPreview(',start);
test('growth-tree overrides historical preview numbers with the same live nodes used in combat',()=>{
 const meta=metaView(),ctx=vm.createContext({S:{meta}});vm.runInContext(app.slice(start,end)+';this.nodes=advancedPreviewNodes;',ctx);
 for(const cls of ['sword','archer','mage'])for(const [path,row]of Object.entries(meta.advancedSpecializations[cls])){
  const result=ctx.nodes({tier:path.length,entries:[{path,name:'old-name',skill:{cost:9999,mult:9999},theme:'authored-art'}]},cls)[0];
  assert.equal(result.name,nodeFor(cls,path).name);assert.equal(result.skill.cost,nodeFor(cls,path).skill.cost);assert.equal(result.skill.mult,nodeFor(cls,path).skill.mult);assert.equal(result.theme,'authored-art');assert.ok(result.passive.text.includes(row.role));
 }
 ctx.S.meta={};const fallback=ctx.nodes({tier:3,entries:[{path:'A11',skill:{mult:9999}}]},'mage')[0];assert.equal(fallback.skill,null);assert.match(fallback.passive.text,/更新遊戲/);
});
