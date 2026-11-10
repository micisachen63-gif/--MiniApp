// Display-only identity mapping. Original item images keep their published URLs.
const NEW = '/art/materials-20261110/';
const exact = Object.freeze({
  star_ring_core:'/art/star-ring-rank-rewards-20261019/star-ring-core.webp',
  star_ring_token:'/art/star-ring-20261018/star_ring_token.webp',
  fate_cycle_gift:'/art/ui/command-collect-20261012.webp',
  guardian_summon_stone:'/art/guardian-sigil-20261013/guardian-summon-stone.webp',
  guardian_free_normal:'/art/guardian-sigil-20261013/summon-feather.webp',
  gacha_weapon:'/art/ui/gacha-weapon-20261015.webp',
  gacha_armor:'/art/ui/gacha-armor-blue-20261015.webp',
  gold:'/art/ui/hud-coin-v2.webp', ward:'/art/v2/item_guardian.webp',
});
export function itemIconSrc(id) {
  if (typeof id !== 'string') return null;
  if (Object.hasOwn(exact,id)) return exact[id];
  if (/^(?:atlas_(?:shard|iron|ember|venom|core)|recovery_dust|relic_fragment|trial_[34])$/.test(id)) return NEW+id+'.png';
  if (/^(red|blue)_[1-4]$/.test(id)) return '/art/potions-20261019/'+id+'.webp';
  if (/^guaranteed_scroll_[wa]$/.test(id)) return '/art/items-scrolls-pink-20261018/'+id+'.webp';
  if (['scroll_w','scroll_a','scroll_r','blessed_scroll_w','blessed_scroll_a','unbind'].includes(id)) return '/art/items-scrolls-cutout-20261011/'+id+'.webp';
  if (['boss_essence','tower_fragment'].includes(id)) return '/art/ui/item-'+id+'-20261012.webp';
  if (['guardian_voucher','research_fragment'].includes(id)) return '/art/ui/item-'+id+'-20261015.webp';
  if (/^reselect_[123]$/.test(id)) return '/art/v2/item_fate_book.webp';
  if (/^mat_[1-4]$/.test(id)) return '/art/v2/item_mat'+id.slice(-1)+'.webp';
  if (/^hunt_(?:[1-9]|1[0-2])_(?:[123]|sigil|core)$/.test(id)) return '/art/collection-materials-20261014/'+id+'.webp';
  if (/^collection_(?:[1-9]|1[0-2])$/.test(id)) return '/art/collections-20261013/'+id+'.webp';
  if (/^book_[a-z0-9_]+$/.test(id)) return '/expedition/assets/skills-painted-20261011/'+id.slice(5)+'.webp';
  return null;
}
