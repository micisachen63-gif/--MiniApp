const roles={guard:'守護',breach:'破陣',aid:'支援',control:'壓制'};
export function partyCaption(p){
 const c=p.cooperation;
 const tactics=c?`✦ ${c.name}｜破解 ${c.cleared}/${c.total}\n${c.failed?'機制失守，請調整配隊。':c.complete?'護甲已解除，全力進攻！':c.next?`第 ${c.next.round} 回合：${c.next.roles.map(r=>roles[r]).join('／')}`:`${c.roles.map(r=>`${c.progress[r]?'✅':'○'}${roles[r]}`).join(' ')}｜尚餘 ${c.roundsLeft} 回合`}\n`:
  p.briefing?`✦ 分工${p.briefing.ready?'齊備':'待補'}｜${p.briefing.phases.map(v=>v.roles.map(r=>roles[r]).join('／')).join(' → ')}\n`:'';
 return `${p.kind==='tower'?'♜':'⚔️'} ${p.name}｜第 ${Math.max(1,Number(p.cardRun)||1)} 場\n${p.kind==='tower'?`第 ${p.floor} 層｜`:''}第 ${p.round} 回合｜${{lobby:'招募中',combat:'冒險中',won:'通關成功',lost:'挑戰失敗',ended:'已結束'}[p.status]}\n${p.members.map(m=>`${m.ready?'✅':'○'} ${m.name} Lv.${m.level}${m.hp!=null?`｜HP ${m.hp}/${m.maxHp}`:''}${p.briefing?`｜${(m.roles||[]).map(r=>roles[r]).join('／')}`:''}${m.submitted?'｜已選戰術':''}`).join('\n')}\n${p.enemy&&p.status==='combat'?`首領 HP ${Math.max(0,p.enemy.hp)}/${p.enemy.maxHp}\n`:''}${tactics}${p.log.slice(0,3).join('\n')}\n${p.status==='combat'?`每回合 ${p.roundSeconds||5} 秒；未選招自動協調，技能可覆蓋本回合。`:p.status==='lobby'?'三個不同 Telegram 帳號，全員準備且分工齊備後出發。':p.status==='won'?'戰利品自動存入背包；未使用的技能寶物可交易。':''}`.slice(0,1024);
}
