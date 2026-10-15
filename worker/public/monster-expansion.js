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
  // Legacy callbacks remain inert for cached battle code; collection only applies abilities.
  const selectedTheme=()=>0,themeColor=()=>null,chooseTheme=()=>false;
  window.RpgMonsterExpansion = {revision:window.RpgMonsterExpansionArtRevision || 'pending',catalog,ready,spec,sequence,frame,position,canvasSpec,themeColor,selectedTheme,chooseTheme};
})();
