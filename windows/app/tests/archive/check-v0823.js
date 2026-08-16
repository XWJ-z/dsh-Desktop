'use strict';
// v0.8.23 代码级验证：①宠物/工具箱页面内自愈（MutationObserver，可见性校验）
// ②弹窗外观统一（progress.html 接入 shared.css 深色主题 + 窗口背景色）
const fs = require('fs');
const path = require('path');
const pet = fs.readFileSync('modules/pet.js', 'utf8');
const mw = fs.readFileSync('modules/windows/main-window.js', 'utf8');
const misc = fs.readFileSync('modules/windows/misc-windows.js', 'utf8');
const prog = fs.readFileSync('renderer/progress.html', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const vjson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'version.json'), 'utf8'));
const checks = [
  // T1: 页面内自愈
  ['self-heal flag', pet.includes('window.__dshPetSelfHeal')],
  ['ensurePet defined in page', pet.includes('window.__dshEnsurePet = function ensurePet()')],
  ['visible check on existing', pet.includes("const vis = r.width > 0 && r.height > 0")],
  ['remove invisible residual', pet.includes('exist.remove();       // 残留不可见节点：移除重建')],
  ['MutationObserver installed', pet.includes('new MutationObserver(onDomChange)')],
  ['observer watches document', pet.includes("observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] })")],
  ['debounce 500ms', pet.includes('now - lastCheck < 500')],
  ['idempotent re-inject', pet.includes('if (window.__dshPetSelfHeal) {')],
  ['reset clears self-heal state', pet.includes('window.__dshPetSelfHeal = false;')],
  // T1: watchdog 可见性检查
  ['guard checks visibility', mw.includes('r.right > -10 && r.bottom > -10')],
  ['guard re-inject on invisible', mw.includes('缺失或不可见，重新注入')],
  // T2: 弹窗外观统一
  ['progress uses shared.css', prog.includes('shared.css')],
  ['progress dark theme tokens', prog.includes('var(--text-secondary)') && prog.includes('var(--brand)')],
  ['backup window bg unified', misc.includes("backgroundColor: '#0f1115'")],
  // 版本
  ['package version 0.8.23', pkg.version === '0.8.23'],
  ['version.json 0.8.23', vjson.version === '0.8.23'],
];
let ok = true;
for (const [n, pass] of checks) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
