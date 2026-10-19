-- Only replace the two blanket party locks. Preserve escrow/delete protections,
-- all player data, and immutable expedition snapshots. No table rebuild.
DROP TRIGGER guardian_sigil_party_update;
CREATE TRIGGER guardian_sigil_party_update BEFORE UPDATE ON rpg_guardian_sigils
WHEN EXISTS(
 SELECT 1 FROM rpg_characters c
 WHERE c.tg_id IN (OLD.char_id,NEW.char_id) AND c.party_id IS NOT NULL
 AND (OLD.active=1 OR NEW.active=1 OR NOT EXISTS(
  SELECT 1 FROM rpg_star_ring_members m JOIN rpg_star_ring_runs r ON r.id=m.run_id
  WHERE m.char_id=c.tg_id AND m.left_at IS NULL AND r.status='running' AND r.id=c.party_id
 ))
)
BEGIN SELECT RAISE(ABORT,'guardian_party_locked'); END;

DROP TRIGGER guardian_sigil_party_delete;
CREATE TRIGGER guardian_sigil_party_delete BEFORE DELETE ON rpg_guardian_sigils
WHEN EXISTS(
 SELECT 1 FROM rpg_characters c WHERE c.tg_id=OLD.char_id AND c.party_id IS NOT NULL
 AND (OLD.active=1 OR NOT EXISTS(
  SELECT 1 FROM rpg_star_ring_members m JOIN rpg_star_ring_runs r ON r.id=m.run_id
  WHERE m.char_id=c.tg_id AND m.left_at IS NULL AND r.status='running' AND r.id=c.party_id
 ))
)
BEGIN SELECT RAISE(ABORT,'guardian_party_locked'); END;
