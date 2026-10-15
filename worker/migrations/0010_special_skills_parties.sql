ALTER TABLE rpg_characters ADD COLUMN special_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE rpg_characters ADD COLUMN party_id TEXT;
CREATE TABLE rpg_parties (
 id TEXT PRIMARY KEY, leader_id TEXT NOT NULL, kind TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'lobby', rev INTEGER NOT NULL DEFAULT 0,
 state_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, chat_id TEXT, message_id INTEGER
);
CREATE INDEX rpg_parties_open ON rpg_parties(status,expires_at);
CREATE TABLE rpg_party_members (
 party_id TEXT NOT NULL REFERENCES rpg_parties(id), char_id TEXT NOT NULL,
 account_id TEXT NOT NULL, ready INTEGER NOT NULL DEFAULT 0,
 joined_at INTEGER NOT NULL, PRIMARY KEY(party_id,char_id), UNIQUE(party_id,account_id)
);
CREATE TABLE rpg_party_presence (
 account_id TEXT PRIMARY KEY, party_id TEXT NOT NULL, char_id TEXT NOT NULL UNIQUE
);
CREATE TABLE rpg_party_rewards (
 party_id TEXT NOT NULL, char_id TEXT NOT NULL, reward_json TEXT NOT NULL,
 created_at INTEGER NOT NULL, PRIMARY KEY(party_id,char_id)
);
CREATE TABLE rpg_party_operations (
 party_id TEXT NOT NULL, char_id TEXT NOT NULL, request_id TEXT NOT NULL,
 result_json TEXT NOT NULL, PRIMARY KEY(party_id,char_id,request_id)
);
CREATE TABLE rpg_book_trade_operations (
 char_id TEXT NOT NULL, request_id TEXT NOT NULL, trade_id TEXT NOT NULL,
 PRIMARY KEY(char_id,request_id)
);
