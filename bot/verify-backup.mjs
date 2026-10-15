import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync('backup/cutover-20261012/elf-rpg.sql','utf8'));
for(const t of ['rpg_accounts','rpg_characters','rpg_equipment'])console.log('Backup '+t+': '+db.prepare('SELECT count(*) n FROM '+t).get().n);
db.close();
