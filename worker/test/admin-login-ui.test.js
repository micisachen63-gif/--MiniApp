import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto, createHash } from 'node:crypto';
import { adminLoginCommand, adminLoginLink, decodeAdminChallenge } from '../public/admin/pairing.js';

const source = readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8')
  .replace(/^import .*?;\r?\n/, '').split("$('#navigation').addEventListener")[0];

function setup({ clipboard = async () => {}, telegram = '', search = '' } = {}) {
  const nodes = new Map(), timers = new Map(), calls = [];
  let clock = 1_000_000, nextTimer = 0;
  class Element {
    constructor(id) { this.id = id; this.events = new Map(); this.hidden = false; this.disabled = false; this.value = ''; this.open = false; this.checked = false; this.textContent = ''; this.classList = { toggle() {} }; }
    set innerHTML(value) {
      this.html = value;
      for (const match of value.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
        const node = new Element(match[1]); node.disabled = /\sdisabled(?:\s|>)/.test(match[0]); node.hidden = /\shidden(?:\s|>)/.test(match[0]);
        nodes.set(match[1], node);
      }
      const command = value.match(/<textarea[^>]*id="login-command"[^>]*>([^<]*)<\/textarea>/);
      if (command) { nodes.get('login-command').value = command[1]; nodes.get('login-command').readOnly = true; }
    }
    get innerHTML() { return this.html || ''; }
    addEventListener(name, callback) { this.events.set(name, callback); }
    fire(name) { return this.events.get(name)?.({ currentTarget: this, target: this }); }
    focus() { this.focused = true; this.fire('focus'); }
    select() { this.selected = true; }
  }
  for (const id of ['auth-content', 'login-action', 'auth-message']) nodes.set(id, new Element(id));
  const document = { hidden: false, querySelector: selector => nodes.get(selector.slice(1)), querySelectorAll: () => [] };
  const context = vm.createContext({
    console, document, window: { Telegram: { WebApp: { initData: telegram } } }, location: { search },
    crypto: webcrypto, TextEncoder, Uint8Array, AbortController, URLSearchParams, adminLoginCommand, adminLoginLink,
    navigator: { clipboard: { writeText: clipboard } },
    localStorage: { setItem() { throw Error('Verifier must stay in memory'); } },
    sessionStorage: { setItem() { throw Error('Verifier must stay in memory'); } },
    Date: class extends Date { static now() { return clock; } },
    setTimeout: (callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, ms }); return id; },
    clearTimeout: id => timers.delete(id)
  });
  context.__calls = calls;
  vm.runInContext(source + `\napi = async (endpoint, body, options) => { __calls.push({endpoint, body, options}); return {pending:true}; };`, context);
  return {
    context, nodes, calls, timers,
    render: () => vm.runInContext('renderLogin()', context),
    state: () => vm.runInContext('S', context),
    evaluate: code => vm.runInContext(code, context),
    advance: ms => { clock += ms; }
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
async function waitUntil(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'async login rendering did not complete');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}

test('browser login uses compact BOT start and matching manual command while keeping verifier private', async () => {
  const s = setup(); await s.render();
  const html = s.nodes.get('login-action').innerHTML;
  const href = html.match(/id="browser-login"[^>]*href="([^"]+)"/)[1];
  const token = new URL(href).searchParams.get('start');
  assert.match(token, /^admin_[A-Za-z0-9_-]{43}$/);
  assert.ok(token.length <= 64);
  assert.equal(s.nodes.get('login-command').value, '/start ' + token);
  assert.doesNotMatch(html, /startapp=/);
  assert.equal(s.calls.length, 0, 'render does not send a BOT message or redeem before intent');
  s.nodes.get('browser-login').fire('click'); await flush();
  const poll = s.state().poll;
  assert.equal(decodeAdminChallenge(token.slice(6)), createHash('sha256').update(poll.verifier).digest('hex'));
  assert.equal(poll.challenge, decodeAdminChallenge(token.slice(6)));
  assert.equal(html.includes(poll.verifier), false);
  assert.equal(s.calls[0].endpoint, 'login/redeem');
  assert.equal(s.calls[0].body.verifier, poll.verifier);
  assert.match(html, /開始／Start/); assert.match(html, /批准登入/);
});

test('manual fallback alone starts redemption and repeated link or copy clicks preserve verifier and deadline', async () => {
  const copied = [], s = setup({ clipboard: async value => copied.push(value) }); await s.render();
  const details = s.nodes.get('login-fallback'); details.open = true; details.fire('toggle'); await flush();
  const first = s.state().poll, deadline = first.deadline;
  s.advance(120000);
  s.nodes.get('browser-login').fire('click');
  await s.nodes.get('copy-login-command').fire('click');
  assert.equal(s.state().poll, first);
  assert.equal(s.state().poll.deadline, deadline);
  assert.equal(copied[0], s.nodes.get('login-command').value);
  assert.equal(s.nodes.get('browser-code').hidden, false);
  assert.match(s.nodes.get('copy-login-status').textContent, /已複製/);
});

test('denied clipboard leaves a selectable readonly command and starts the same login attempt', async () => {
  const s = setup({ clipboard: async () => { throw Error('NotAllowedError'); } }); await s.render();
  await s.nodes.get('copy-login-command').fire('click'); await flush();
  const field = s.nodes.get('login-command');
  assert.ok(s.state().poll); assert.equal(field.readOnly, true); assert.equal(field.selected, true);
  assert.match(field.value, /^\/start admin_[A-Za-z0-9_-]{43}$/);
  assert.match(s.nodes.get('copy-login-status').textContent, /自行複製/);
});

test('expired attempt replaces its challenge and ignores a late copy completion from the previous attempt', async () => {
  let copied;
  const s = setup({ clipboard: () => new Promise(resolve => { copied = resolve; }) }); await s.render();
  const operation = s.nodes.get('copy-login-command').fire('click'); await flush();
  const old = s.state().poll;
  const oldCommandField = s.nodes.get('login-command');
  s.advance(300001); await s.evaluate('pollBrowserLogin()'); await flush();
  assert.equal(s.state().poll, null);
  // WebCrypto can finish after an event-loop turn under the full suite's load.
  // Wait for the replacement DOM rather than firing the removed link's handler.
  await waitUntil(() => s.nodes.get('login-command') !== oldCommandField && s.nodes.get('browser-login').events.has('click'));
  s.nodes.get('browser-login').fire('click'); await flush();
  assert.notEqual(s.state().poll.challenge, old.challenge);
  copied(); await operation;
  assert.equal(s.nodes.get('copy-login-status').textContent, '', 'late callback never repaints a new session');
});

test('explicit signed Telegram approval still requires the checkbox and sends the original full challenge', async () => {
  const challenge = 'ab'.repeat(32), s = setup({ telegram: 'signed-init-data', search: '?approve=' + challenge });
  await s.render();
  assert.equal(s.nodes.get('approve-login').disabled, true);
  assert.match(s.nodes.get('auth-content').innerHTML, /id="approve-login" disabled/);
  s.nodes.get('approve-check').checked = true; s.nodes.get('approve-check').fire('change');
  assert.equal(s.nodes.get('approve-login').disabled, false);
  await s.nodes.get('approve-login').fire('click');
  assert.equal(s.calls[0].endpoint, 'login/approve');
  assert.equal(s.calls[0].body.challenge, challenge);
  assert.equal(s.calls[0].options.telegram, true);
  assert.match(s.nodes.get('auth-content').innerHTML, /已批准這次登入/);
});
