// Keep the workshop mounted while party polling updates the surrounding page.
// In particular, replacing an unchanged <select> interrupts its native picker.
const rendered = new WeakMap();
export function renderTowerPage(root, html, characterId) {
 const template = document.createElement('template');
 template.innerHTML = html;
 const previous = root.querySelector(':scope > .tp-panel');
 const next = [...template.content.children].find(el => el.classList.contains('tp-panel'));
 const saved = previous && rendered.get(previous);
 const scope = String(characterId);
 if (!previous || !next || saved?.scope !== scope) {
  root.replaceChildren(template.content);
  const panel = root.querySelector(':scope > .tp-panel');
  if (panel) rendered.set(panel, {scope, html: panel.innerHTML});
  return;
 }
 const nextHtml = next.innerHTML;
 if (saved.html !== nextHtml) {
  const expanded = new Map([...previous.querySelectorAll('[data-tower-section]')].map(el => [el.dataset.towerSection, el.open]));
  for (const el of next.querySelectorAll('[data-tower-section]')) el.open = expanded.get(el.dataset.towerSection) ?? el.open;
  previous.replaceChildren(...next.childNodes);
  rendered.set(previous, {scope, html: nextHtml});
 }
 const before = document.createDocumentFragment(), after = document.createDocumentFragment();
 while (next.previousSibling) before.prepend(next.previousSibling);
 while (next.nextSibling) after.append(next.nextSibling);
 while (previous.previousSibling) previous.previousSibling.remove();
 while (previous.nextSibling) previous.nextSibling.remove();
 root.insertBefore(before, previous);
 root.append(after);
}
