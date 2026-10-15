// Naming only: combat numbers and advancement availability remain in existing rules.
export const MAGE_FOURTH = Object.freeze(Object.fromEntries([
 ['A111','太陽神炎使','日冕焚界','日冕共鳴'],['A112','熾天聖魔導','熾天裁決','熾羽結界'],
 ['A121','滅星魔皇','星核崩滅','星核共鳴'],['A122','隕日裁決者','隕日終審','隕日結界'],
 ['A211','永恆霜皇','永霜王域','霜皇共鳴'],['A212','絕對零度之主','零界封絕','零界結界'],
 ['A221','極光聖賢','極光聖降','極光共鳴'],['A222','蒼穹冰神','蒼穹冰葬','蒼冰結界'],
 ['B111','時光主宰','時序崩解','時輪共鳴'],['B112','命運編織者','命運斷章','命運結界'],
 ['B121','虛空法神','虛空湮滅','虛空共鳴'],['B122','次元界行者','次元裂隙','次元結界'],
 ['B211','萬靈聖召者','萬靈降臨','萬靈共鳴'],['B212','星界君王','星界御令','星界結界'],
 ['B221','深淵魔契王','深淵魔召','魔契共鳴'],['B222','幽冥萬象師','冥界開門','幽冥結界']
].map(([path,name,skillName,passiveName])=>[path,Object.freeze({name,skillName,passiveName})])));
export const renamedPassive = (text,name) => name+'：'+String(text).replace(/^[^：]*：/,'');
