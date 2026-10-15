import {COLLECTION_BLESSINGS} from '../game/collection-blessings.js';
import {GameError} from '../game/classes.js';import {computeStats} from '../game/stats.js';
export function activateCollection(work,ctx,b){
 const request=String(b.requestId||'');if(!/^(?:app:)?[\w-]{8,80}$/.test(request))throw new GameError('request','缺少有效操作編號');
 if(b.expectedCharId!=null&&String(b.expectedCharId)!==String(work.char.tg_id))throw new GameError('character_changed','角色已切換，請重新選擇收藏祝福',409);
 const mapId=b.mapId;if(!Number.isInteger(mapId)||mapId<0||mapId>12)throw new GameError('collection','請選擇有效的收藏祝福');
 if(work.char.party_id)throw new GameError('party','請先完成組隊冒險再更換收藏祝福');
 const blessing=COLLECTION_BLESSINGS.find(x=>x.mapId===mapId)||null;
 if(blessing&&(work.inv[blessing.item]||0)<1)throw new GameError('not_owned','先完成這張地圖的收藏，才能啟用祝福');
 const before=work.char.collection_active_map||0;work.char.collection_active_map=mapId;
 const s=computeStats(work.char,work.equipment);work.char.hp=Math.min(work.char.hp,s.maxHp);work.char.mp=Math.min(work.char.mp,s.maxMp);
 return {ledger:[{event_id:`collection-activate:${work.char.tg_id}:${request}`,tg_id:String(work.char.tg_id),type:'收藏祝福切換',note:`${before}→${mapId} · ${blessing?.name||'暫不啟用'}`}],result:{activeMapId:mapId,blessing}};
}
