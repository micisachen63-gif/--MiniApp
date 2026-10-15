import {Resvg} from './deps/resvg.mjs';
import {initWasm,configureAssets,resetSprites,encodeBattleAnimation,buildBattleScene,battleKey,wasmMemoryBytes} from './battle-core.mjs';
import {battleHeroAsset,battleTheme} from './assets.mjs';
import {configureCardAssets,renderPartyCardSvg,partyCaption} from './party-card.mjs';
export {buildBattleScene,battleKey,partyCaption,battleHeroAsset,battleTheme};
let wasmInitialization;
const asBytes=b=>b instanceof Uint8Array?b:new Uint8Array(b);
/**
 * No Telegram, D1, filesystem, timers or native binaries. Loaders are host-injected.
 * Pass imported WebAssembly.Module, loadFont(), loadPartyAsset(relativeFile), loadBossAsset(map).
 * Results are Uint8Array (GIF / PNG), accepted by Workers Blob/FormData.
 * Animation output retains all original 720x405 frames, effect styles and true server snapshots.
 */
export function createRpgMediaRenderer({wasmModule,loadFont,loadPartyAsset,loadBossAsset}){
 if(!wasmModule||typeof loadFont!=='function'||typeof loadPartyAsset!=='function')throw Error('Renderer requires WASM and approved asset/font loaders');
 let font;
 async function initialize(){await(wasmInitialization??=initWasm(wasmModule));return font??=asBytes(await loadFont());}
 async function loadNames(names){return new Map(await Promise.all([...names].map(async file=>[file,asBytes(await loadPartyAsset(file))])));}
 async function renderBattleAnimation(kind,p){
  const fontBytes=await initialize(),scene=buildBattleScene(kind,p);
  const names=new Set([scene.background||`map${String(scene.map).padStart(2,'0')}.png`,...scene.actors.map(a=>battleHeroAsset(a).file),...(scene.boss?[scene.boss.file]:[])]);
  const assets=await loadNames(names);
  // No await after configure: a simultaneous call cannot replace this scene mid-render.
  configureAssets(assets,fontBytes);
  try{return encodeBattleAnimation(kind,p);}finally{resetSprites();configureAssets(new Map(),new Uint8Array());}
 }
 async function renderPartyCard(p){
  const fontBytes=await initialize(),theme=battleTheme(p);
  const names=new Set([theme.background,...p.members.map(m=>battleHeroAsset(m).file),...(p.status!=='lobby'?[theme.boss]:[])]);
  const assets=await loadNames(names);configureCardAssets(assets);
  let instance,image;
  try{instance=new Resvg(renderPartyCardSvg(p),{font:{fontBuffers:[fontBytes],defaultFontFamily:'Noto Sans TC'}});image=instance.render();return Uint8Array.from(image.asPng());}
  finally{image?.free();instance?.free();configureCardAssets(new Map());}
 }
 async function bossCardBytes(boss){const map=Number(boss.mapId);if(!Number.isInteger(map)||map<1||map>12)return null;if(typeof loadBossAsset!=='function')throw Error('Boss asset loader missing');return asBytes(await loadBossAsset(map));}
 return {initialize,renderBattleAnimation,renderPartyCard,bossCardBytes,wasmMemoryBytes};
}
