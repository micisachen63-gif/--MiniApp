import {generatedZodiac} from './model.js';
export const seedZodiac=generatedZodiac;
// Indices follow the existing birthday/code convention: Capricorn is 0, Aries is 3.
export const ZODIAC_CRESTS=Object.freeze([
 {name:'摩羯',id:'capricorn',latin:'CAPRICORN',line:'把時間走成山脈，把約定留在星間。'},
 {name:'水瓶',id:'aquarius',latin:'AQUARIUS',line:'把一點不同的光，帶到尚無名字的地方。'},
 {name:'雙魚',id:'pisces',latin:'PISCES',line:'潮汐帶著夢，也帶著願意理解的心。'},
 {name:'牡羊',id:'aries',latin:'ARIES',line:'在第一道晨光裡，勇敢替旅途啟程。'},
 {name:'金牛',id:'taurus',latin:'TAURUS',line:'讓微小的日常，長成值得守候的風景。'},
 {name:'雙子',id:'gemini',latin:'GEMINI',line:'一半追問世界，一半收集沿途的聲音。'},
 {name:'巨蟹',id:'cancer',latin:'CANCER',line:'為遲歸的靈魂，留一盞溫柔的燈。'},
 {name:'獅子',id:'leo',latin:'LEO',line:'讓心中的火，照見別人也照見自己。'},
 {name:'處女',id:'virgo',latin:'VIRGO',line:'把散落的細節，一一縫回生活的星圖。'},
 {name:'天秤',id:'libra',latin:'LIBRA',line:'在不同的聲音之間，找到可以同行的路。'},
 {name:'天蠍',id:'scorpio',latin:'SCORPIO',line:'穿過深夜的寂靜，仍願意珍惜一點真心。'},
 {name:'射手',id:'sagittarius',latin:'SAGITTARIUS',line:'把目光送往遠方，把故事帶回人間。'},
]);
const valid=value=>Number.isInteger(value)&&value>=0&&value<12;
export function identitySign(life){
 if(!life||typeof life!=='object')return null;
 const source=valid(life.identityZodiac)?'identity':valid(life.zodiac)?'shared':typeof life.seed==='string'&&/^[a-f0-9]{8}$/.test(life.seed)?'generated':null;
 if(!source)return null;const index=source==='identity'?life.identityZodiac:source==='shared'?life.zodiac:seedZodiac(life.seed);
 return {index,...ZODIAC_CRESTS[index],source};
}
export function zodiacHeroSource({stage,currentLife,cloud,result,entries=[]}){
 if(stage==='intro'||stage==='archive')return null;
 if(stage==='result'&&result){const record=entries.find(e=>e.code===result.code&&e.draft)||(cloud?.last?.code===result.code?cloud.last:null);return record?.draft||result;}
 return currentLife||cloud?.active?.draft||result||null;
}
