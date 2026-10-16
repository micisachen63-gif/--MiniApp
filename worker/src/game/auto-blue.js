// Stored alongside existing character preferences; no schema migration required.
export function autoBluePct(c) {
  let x; try { x=JSON.parse(c.special_json||'{}'); } catch { x={}; }
  const pct=x?.autoBluePct;
  return Number.isInteger(pct)&&pct>=20&&pct<=80?pct:50;
}
export function blueTarget(c,maxMp,required=0) {
  return Math.min(maxMp,Math.max(maxMp*autoBluePct(c)/100,required));
}
// At the exact percentage, drink once; subsequent bottles only reach the target.
export function needsBlue(c,mp,maxMp,required=0) {
  return !!c.auto_blue&&mp<maxMp&&(mp<=maxMp*autoBluePct(c)/100||mp<Math.min(maxMp,required));
}
