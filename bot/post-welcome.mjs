import fs from 'node:fs';import {createGameTelegramApi} from './telegram-media.mjs';
const c=JSON.parse(fs.readFileSync('telegram.local.json')),api=createGameTelegramApi(c.botToken);
const asset='https://elf-rpg-api.micisachen.workers.dev/telegram-media/welcome.jpg';
const head=await fetch(asset,{method:'HEAD'});if(!head.ok)throw Error('welcome asset not deployed');
const file='state/cutover-announcements.json';let rec={};try{rec=JSON.parse(fs.readFileSync(file));}catch{}
if(!rec.newGroup){const m=await api.sendPhoto({chatId:c.chatId,photoUrl:asset,caption:'🌌 星穹之門已開啟\n歡迎來到《星穹旅誌》冒險者之庭。\n\n✨ 在 BOT 私訊按 START，再開啟旅誌。\n原角色、裝備、技能與金幣會隨同一個 Telegram 帳號接續。\n\n⚔️ 組隊打寶・轉職試煉・星穹爬塔\n🐉 首領每小時整點降臨，01:00～07:59 休息。\n\n與星同行，將遠方寫成故事。',replyMarkup:{inline_keyboard:[[{text:'🎮 開啟旅誌',url:'https://t.me/StarJournalRpgBot?start=rpg'}]]}});rec.newGroup=m.message_id;fs.writeFileSync(file,JSON.stringify(rec));console.log('Welcome sent: '+m.message_id);}
await api.call('pinChatMessage',{chat_id:c.chatId,message_id:rec.newGroup,disable_notification:true});console.log('Welcome pinned');
