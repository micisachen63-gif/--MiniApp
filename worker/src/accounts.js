import { GameError } from './game/classes.js';
import * as P from './services/player.js';
import { guardStmt, classifyDbError } from './db.js';

export const MAX_CHARACTERS_PER_ACCOUNT = 4;

export async function activeCharacterId(db, accountTgId) {
  const account = String(accountTgId);
  const row = await db.prepare(`SELECT a.active_char_id, c.account_tg_id
    FROM rpg_accounts a LEFT JOIN rpg_characters c ON c.tg_id = a.active_char_id
    WHERE a.account_tg_id = ?`).bind(account).first();
  if (row?.active_char_id && row.account_tg_id === account) return row.active_char_id;
  const legacy = await db.prepare('SELECT tg_id FROM rpg_characters WHERE tg_id = ? AND account_tg_id = ?').bind(account, account).first();
  return legacy?.tg_id || account;
}

export async function listAccountCharacters(db, accountTgId) {
  const account = String(accountTgId);
  const [rows, active] = await Promise.all([
    db.prepare(`SELECT tg_id, char_slot, name, gender, base_class, class_path, level, map_id, idle_state, gold
      FROM rpg_characters WHERE account_tg_id = ? ORDER BY char_slot`).bind(account).all(),
    db.prepare('SELECT active_char_id FROM rpg_accounts WHERE account_tg_id = ?').bind(account).first(),
  ]);
  const activeId = active?.active_char_id || account;
  return (rows.results || []).map((c) => ({
    charId: c.tg_id, slot: c.char_slot, name: c.name, gender: c.gender, baseClass: c.base_class,
    classPath: c.class_path, level: c.level, mapId: c.map_id, idleState: c.idle_state,
    gold: c.gold, active: c.tg_id === activeId,
  }));
}

export async function selectAccountCharacter(env, accountTgId, charId, now) {
  const db = env.DB; const account = String(accountTgId); const selected = String(charId || '');
  const owned = await db.prepare('SELECT tg_id FROM rpg_characters WHERE tg_id = ? AND account_tg_id = ?').bind(selected, account).first();
  if (!owned) throw new GameError('character_not_owned', '找不到這個角色，請重新選擇', 404);
  const previous = await activeCharacterId(db, account);
  if (previous !== selected) {
    const party=await db.prepare('SELECT party_id FROM rpg_characters WHERE tg_id=?').bind(previous).first();
    if(party?.party_id&&!String(party.party_id).startsWith('ring:'))throw new GameError('party','請先結束組隊戰鬥，再切換角色');
    // Settle the previously selected character through the exact switch time.
    if (await db.prepare('SELECT 1 FROM rpg_characters WHERE tg_id = ? AND account_tg_id = ?').bind(previous, account).first())
      await P.withPlayer(env, previous, now, null, { source: 'character-switch' });
  }
  const stmts = [db.prepare('INSERT OR IGNORE INTO rpg_accounts (account_tg_id,active_char_id,updated_at) VALUES (?,?,?)').bind(account,previous,now)];
  if (previous !== selected) {
    // The party check and active-character change must commit together. Bumping the old character's
    // revision also invalidates a party start that read it before this switch.
    // A long expedition uses an immutable departure snapshot and keeps running
    // while its owner plays another character. Short live parties still lock switching.
    stmts.push(db.prepare("UPDATE rpg_characters SET rev=rev+1,updated_at=? WHERE tg_id=? AND account_tg_id=? AND (party_id IS NULL OR party_id LIKE 'ring:%')").bind(now,previous,account),guardStmt(db));
    // Inactive time is never credited when the selected character is activated.
    stmts.push(db.prepare("UPDATE rpg_characters SET last_settle_at=?,rev=rev+1,updated_at=? WHERE tg_id=? AND account_tg_id=? AND (party_id IS NULL OR party_id LIKE 'ring:%')").bind(now,now,selected,account),guardStmt(db));
  }
  stmts.push(db.prepare('UPDATE rpg_accounts SET active_char_id=?,updated_at=? WHERE account_tg_id=? AND active_char_id=?').bind(selected,now,account,previous),guardStmt(db));
  try { await db.batch(stmts); }
  catch (e) {
    const error=classifyDbError(e);
    if(error?.code==='conflict') {
      const busy=await db.prepare("SELECT 1 FROM rpg_characters WHERE tg_id IN (?,?) AND party_id IS NOT NULL AND party_id NOT LIKE 'ring:%'").bind(previous,selected).first();
      if(busy)throw new GameError('party','隊伍已出發，請先結束組隊戰鬥，再切換角色',409);
      throw new GameError('character_changed','角色已在另一個視窗切換，請重新選角',409);
    }
    throw error||e;
  }
  return selected;
}

export async function resolveActiveCharacterId(db, accountTgId) {
  return activeCharacterId(db, accountTgId);
}
