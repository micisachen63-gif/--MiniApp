-- Additive permanent visual unlocks. Equipped ID lives in character.special_json;
-- server validates ownership and updates it under the existing character rev lock.
CREATE TABLE rpg_star_ring_cosmetics (
 char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 cosmetic_id TEXT NOT NULL CHECK(cosmetic_id IN ('star_ring_aura_dawn','star_ring_aura_moon','star_ring_aura_eclipse')),
 unlocked_at INTEGER NOT NULL,
 PRIMARY KEY(char_id,cosmetic_id)
);
CREATE TABLE rpg_star_ring_cosmetic_operations (
 char_id TEXT NOT NULL REFERENCES rpg_characters(tg_id),
 request_id TEXT NOT NULL, cosmetic_id TEXT, created_at INTEGER NOT NULL,
 PRIMARY KEY(char_id,request_id)
);
