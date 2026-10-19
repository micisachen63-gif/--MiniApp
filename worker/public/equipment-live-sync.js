// Track full inventory snapshots separately from balance-only revision updates.
(()=>{'use strict';
 function create(){const actors=new Map();
  const state=id=>{id=String(id||'');if(!actors.has(id))actors.set(id,{signature:null,token:0,pending:false,minimum:0});return actors.get(id);};
  function observe(jobs,balance,actor){if(!actor)return;const s=state(actor),own=(jobs||[]).filter(n=>['auto_enhance_end','auto_reroll_end'].includes(n.kind)&&String(n.job?.characterId)===String(actor));
   const signature=JSON.stringify(own.map(n=>[n.refId,n.job.itemId,n.job.status,n.job.reason,n.job.attempts,n.job.level,n.job.updatedAt]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
   if(s.signature!==signature){if(s.signature!==null||own.length){s.token++;s.pending=true;}s.signature=signature;}
   if(s.pending&&String(balance?.characterId)===String(actor)&&Number.isFinite(Number(balance.revision)))s.minimum=Math.max(s.minimum,Number(balance.revision));
  }
  function begin(actor){return {actor:String(actor||''),token:state(actor).token};}
  function accept(snapshot,ticket){if(snapshot?.compact||!Array.isArray(snapshot?.equipment)||!snapshot.character)return false;const id=String(snapshot.character.tgId),s=state(id);
   if(ticket?.actor===id&&ticket.token===s.token&&Number(snapshot.character.revision)>=s.minimum)s.pending=false;
   return !s.pending;
  }
  return {observe,begin,accept,pending:actor=>!!actor&&state(actor).pending};
 }
 window.RpgEquipmentLiveSync={create};
})();
