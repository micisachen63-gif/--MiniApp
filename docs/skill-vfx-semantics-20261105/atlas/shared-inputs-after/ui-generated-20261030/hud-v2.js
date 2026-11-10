/* Local visual prototype only. The 12 / 8 potion counts are demo fixtures,
   never a player inventory. Load after preview.js has inserted its orbs. */
(function () {
  'use strict';
  if (document.getElementById('hud-v2-actions')) return;
  var ui = window.UI;
  var mid = document.getElementById('mid');
  var originalSkills = document.getElementById('skills');
  if (!ui || !mid || !originalSkills) return;

  var sheet = document.createElement('link');
  sheet.id = 'hud-v2-style';
  sheet.rel = 'stylesheet';
  sheet.href = '/ui-generated-20261030/hud-v2.css';
  document.head.appendChild(sheet);
  document.documentElement.classList.add('hud-v2-active');
  document.querySelectorAll('.candidate-frame').forEach(function (frame) {
    frame.src = '/ui-generated-20261030/hud-v2/orb-bezel.webp';
  });

  var row = document.createElement('div');
  row.id = 'hud-v2-actions';
  row.className = 'hud-v2-actions';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', '戰鬥快捷列；藥水數量為本機示意');
  var live = document.createElement('span');
  live.className = 'hud-v2-sr';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  mid.append(row, live);

  var actions = [
    { name: '生命藥水', short: '生命', key: 'Q', index: 5, count: 12, col: 0, row: 0 },
    { name: '魔力藥水', short: '魔力', key: 'E', index: null, count: 8, col: 1, row: 0, left: 0, cd: 12 },
    { name: '旋風斬', short: '旋風斬', key: '1', index: 1, col: 2, row: 0 },
    { name: '衝鋒', short: '衝鋒', key: '2', index: 2, col: 0, row: 1 },
    { name: '地裂', short: '地裂', key: '3', index: 4, col: 1, row: 1 }
  ];
  function visible() {
    return !document.hidden && !document.documentElement.classList.contains('candidate-hidden');
  }
  function source(action) { return action.index === null ? action : ui.skills[action.index]; }
  function display(action) {
    var skill = source(action);
    var left = Math.max(0, skill ? skill.left : 0);
    var fraction = left && skill.cd ? Math.min(1, left / skill.cd) : 0;
    var label = left >= 1 ? String(Math.ceil(left)) : left > 0 ? left.toFixed(1) : '';
    var disabled = left > 0 || action.count === 0;
    action.button.classList.toggle('is-cooling', left > 0);
    action.button.classList.toggle('is-empty', action.count === 0);
    action.button.setAttribute('aria-disabled', String(disabled));
    action.shade.style.setProperty('--remaining', (fraction * 100).toFixed(2) + '%');
    if (action.cooldown.textContent !== label) action.cooldown.textContent = label;
    var countText = action.count === undefined ? '' : String(action.count);
    if (action.countEl.textContent !== countText) action.countEl.textContent = countText;
    var spoken = action.name + (action.count === undefined ? '' : '，本機示意數量 ' + action.count) + (label ? '，冷卻 ' + label + ' 秒' : action.count === 0 ? '，已用盡' : '，可使用');
    if (action.button.getAttribute('aria-label') !== spoken) action.button.setAttribute('aria-label', spoken);
  }
  function sync() { if (visible()) actions.forEach(display); }

  var blue = actions[1], blueFrame = 0, blueLast = 0;
  function tickBlue(now) {
    blueFrame = 0;
    if (!visible()) return;
    blue.left = Math.max(0, blue.left - (now - blueLast) / 1000);
    blueLast = now;
    display(blue);
    if (blue.left > 0) blueFrame = requestAnimationFrame(tickBlue);
  }
  function resumeBlue() {
    if (blueFrame || blue.left <= 0 || !visible()) return;
    blueLast = performance.now();
    blueFrame = requestAnimationFrame(tickBlue);
  }
  function activate(action) {
    var skill = source(action);
    if (!visible() || !skill || skill.left > 0 || action.count === 0) return;
    if (action.index === null) {
      action.count -= 1;
      action.left = action.cd;
      live.textContent = '魔力藥水本機示意：剩餘 ' + action.count + '，冷卻 12 秒。';
      if (ui.toast) ui.toast('魔力藥水・本機示意', '展示按鈕與冷卻；未連接背包或伺服器', 'potion');
      resumeBlue();
    } else if (typeof ui.cast === 'function') {
      var before = skill.left;
      ui.cast(action.index);
      if (action.count !== undefined && before <= 0 && skill.left > 0) {
        action.count -= 1;
        live.textContent = '生命藥水本機示意：剩餘 ' + action.count + '。';
      }
    }
    display(action);
  }
  actions.forEach(function (action) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'hud-v2-slot';
    button.dataset.action = action.index === null ? 'mana' : String(action.index);
    button.setAttribute('aria-keyshortcuts', action.key);
    button.title = action.name + ' · ' + action.key + (action.count === undefined ? '' : '（數量為本機示意）');
    button.innerHTML = '<i class="hud-v2-icon" aria-hidden="true"></i><i class="hud-v2-shade" aria-hidden="true"></i><span class="hud-v2-key" aria-hidden="true"></span><span class="hud-v2-name" aria-hidden="true"></span><span class="hud-v2-count" aria-hidden="true"></span><span class="hud-v2-cooldown" aria-hidden="true"></span>';
    button.querySelector('.hud-v2-icon').style.backgroundPosition = [0, 50, 100][action.col] + '% ' + (action.row ? 100 : 0) + '%';
    button.querySelector('.hud-v2-key').textContent = action.key;
    button.querySelector('.hud-v2-name').textContent = action.short;
    action.button = button;
    action.shade = button.querySelector('.hud-v2-shade');
    action.countEl = button.querySelector('.hud-v2-count');
    action.cooldown = button.querySelector('.hud-v2-cooldown');
    button.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    button.addEventListener('click', function (event) { event.stopPropagation(); activate(action); });
    row.appendChild(button);
    display(action);
  });

  // The prototype already updates these text nodes. Subscribe to that existing
  // clock rather than adding another perpetual loop for the combat skills.
  var cooldowns = new MutationObserver(sync);
  actions.forEach(function (action) {
    if (action.index !== null && ui.skills[action.index]) {
      cooldowns.observe(ui.skills[action.index].t, { childList: true, characterData: true, subtree: true });
    }
  });
  function visibilityChanged() {
    if (!visible() && blueFrame) { cancelAnimationFrame(blueFrame); blueFrame = 0; }
    sync();
    resumeBlue();
  }
  document.addEventListener('visibilitychange', visibilityChanged);
  new MutationObserver(visibilityChanged).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('keydown', function (event) {
    var target = event.target;
    if (!visible() || ui.open || event.repeat || event.ctrlKey || event.altKey || event.metaKey || (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))) return;
    var key = event.key.toUpperCase();
    var action = actions.find(function (item) { return item.key === key; });
    if (action) { event.preventDefault(); event.stopPropagation(); activate(action); }
  });
})();
