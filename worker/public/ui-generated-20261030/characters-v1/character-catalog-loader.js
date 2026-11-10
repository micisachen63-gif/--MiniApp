/* Preview metadata only. Image decoding and game simulation remain elsewhere. */
(function () {
  'use strict';
  const cache = new Map(), limit = 4;
  const root = '/ui-generated-20261030/characters-v1/';
  async function loadActor(reference, {signal} = {}) {
    if (!reference?.actorUrl) return reference;
    if (signal?.aborted) throw new DOMException('角色讀取已取消', 'AbortError');
    const url = new URL(reference.actorUrl, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith(root)) throw Error('人物資料網址不在本機預覽目錄');
    const key = url.href;
    if (cache.has(key)) {
      const actor = cache.get(key); cache.delete(key); cache.set(key, actor); return actor;
    }
    const response = await fetch(key, {signal});
    if (!response.ok) throw Error('人物資料讀取失敗（HTTP ' + response.status + '）');
    const actor = await response.json();
    if (signal?.aborted) throw new DOMException('角色讀取已取消', 'AbortError');
    if (actor.id !== reference.id || !actor.clips) throw Error('人物資料與清單不一致');
    cache.set(key, actor);
    while (cache.size > limit) cache.delete(cache.keys().next().value);
    return actor;
  }
  window.CharacterCatalogLoader = Object.freeze({loadActor, cacheLimit: limit});
})();
