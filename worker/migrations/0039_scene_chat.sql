-- Additive scene chat only. No existing character, equipment or reward rows change.
CREATE TABLE rpg_scene_chat_messages (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 account_id TEXT NOT NULL, char_id TEXT NOT NULL,
 channel TEXT NOT NULL CHECK(channel IN ('world','party')), room_id TEXT NOT NULL,
 sender_name TEXT NOT NULL, sender_level INTEGER NOT NULL,
 base_class TEXT NOT NULL, body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 400),
 request_id TEXT NOT NULL, signature TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(account_id,request_id)
);
CREATE INDEX rpg_scene_chat_room ON rpg_scene_chat_messages(room_id,seq);
CREATE INDEX rpg_scene_chat_time ON rpg_scene_chat_messages(created_at);
CREATE TABLE rpg_scene_chat_rate (account_id TEXT PRIMARY KEY, last_sent_at INTEGER NOT NULL);
CREATE TABLE rpg_scene_chat_guard (ok INTEGER NOT NULL CHECK(ok=1));
