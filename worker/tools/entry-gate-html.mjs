// The packaged scene entry with the restored classic entry layer in front of it.
// The iframe gets its scene URL only after the splash and 選擇角色 steps; if the
// entry script cannot load, the inline fallback still opens the scene.
export const ENTRY_GATE_TAG = '<script src="/entry-gate.js?v=20261110-entry1" onerror="var f=document.getElementById(\'demo\');if(f&&!f.getAttribute(\'src\'))f.src=f.dataset.sceneSrc"></script>';
export function withEntryGate(html) {
  const text = String(html);
  if (text.includes('/entry-gate.js')) return text;
  const frame = /<iframe id="demo"([^>]*?) src="(\/[^"]+)"([^>]*)><\/iframe>/;
  if (!frame.test(text)) throw Error('Scene entry iframe not found');
  return text.replace(frame, (_, before, src, after) => '<iframe id="demo"' + before + ' data-scene-src="' + src + '"' + after + '></iframe>' + ENTRY_GATE_TAG);
}
