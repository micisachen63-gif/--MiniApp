export function battleKey(kind,p){return kind==='pk'?`pk:${p.id}:${p.decidedAt||p.status}`:`party:${p.id}:${p.battleTurn?.id||'entry'}:${p.status}`;}
