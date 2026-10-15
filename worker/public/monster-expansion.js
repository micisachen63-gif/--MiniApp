// Generated art metadata is deliberately separate from server combat state.
(() => {
  'use strict';
  const catalog = window.RpgMonsterExpansionCatalog || [];
  const ready = catalog.filter(m => m.ready === true);
  const byKey = new Map(ready.flatMap(m => [[m.key,m],[m.name,m]]));
  const spec = value => byKey.get(value) || byKey.get(String(value || '').split('/').at(-1).split('?')[0].replace(/\.(webp|png)$/, '').replace(/_attack$/, '')) || null;
  const sequence = (meta, action) => meta?.[action] || meta?.idle || [0];
  const frame = (meta, action, progress, seconds = 0) => {
    const seq = sequence(meta,action);
    return seq[action === 'idle' || action === 'move' ? Math.floor(Math.max(0,seconds)*4)%seq.length : Math.min(seq.length-1,Math.floor(Math.max(0,Math.min(.999,progress))*seq.length))];
  };
  const position = (meta,index) => `${index%meta.cols/(meta.cols-1)*100}% ${Math.floor(index/meta.cols)/(meta.rows-1)*100}%`;
  const canvasSpec = (image,meta) => ({image,...meta,idleStart:0,idleFrames:4,attackStart:8,attackFrames:4,castStart:12,castFrames:2,hurtFrame:14,deathFrame:15});
  const MAP_THEMES = {1:'#4ade80',2:'#facc15',3:'#a855f7',4:'#38bdf8',5:'#fb923c',6:'#ef4444',7:'#818cf8',8:'#f59e0b',9:'#94a3b8',10:'#60a5fa',11:'#f472b6',12:'#c084fc'};
  const themeKey = u => `rpg_monster_theme_${u?.character?.tgId || 'anon'}`;
  const selectedTheme = u => {
    try { const s = typeof localStorage !== 'undefined' ? localStorage : null; return Number(s?.getItem(themeKey(u)) || 0); } catch { return 0; }
  };
  const chooseTheme = (u, mapId) => {
    const id = Number(mapId) || 0;
    const s = typeof localStorage !== 'undefined' ? localStorage : null;
    if (id === 0) {
      try { s?.setItem(themeKey(u), '0'); } catch {}
      return true;
    }
    const unlocked = u?.collection?.unlocked?.some?.(x => x.mapId === id);
    if (!unlocked) return false;
    try { s?.setItem(themeKey(u), String(id)); } catch {}
    return true;
  };
  const themeColor = u => {
    const id = selectedTheme(u);
    return MAP_THEMES[id] || null;
  };
  window.RpgMonsterExpansion = {revision:window.RpgMonsterExpansionArtRevision || 'pending',catalog,ready,spec,sequence,frame,position,canvasSpec,themeColor,selectedTheme,chooseTheme};
})();
