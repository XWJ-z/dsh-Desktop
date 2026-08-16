'use strict';
// v0.8.30 打包内容核对：审查修改已进包 + 代码与开发版一致 + 版本号
const fs = require('fs');
const app = 'dist/installer/win-unpacked/resources/app/';
const read = (p) => fs.readFileSync(app + p, 'utf8');
const sec = read('modules/security.js');
const aboutWin = read('modules/windows/about-window.js');
const miscWin = read('modules/windows/misc-windows.js');
const tray = read('modules/tray.js');
const main = read('main.js');
const pet = read('modules/pet.js');
const svg = read('assets/pet-whale.svg');
const changelog = JSON.parse(read('CHANGELOG.json'));
const v = JSON.parse(read('package.json'));
const out = {
  'version 0.8.30': v.version === '0.8.30',
  'R1 security.js in pkg': sec.includes('function secureWebPreferences()'),
  'R1 about uses injected': aboutWin.includes('secureWebPreferences,') && !aboutWin.includes('function secureWebPreferences()'),
  'R1 misc uses injected': miscWin.includes('secureWebPreferences,') && !miscWin.includes('function secureWebPreferences()'),
  'R2 tray no getIsQuitting': !/getIsQuitting,/.test(tray),
  'R3 main indent fixed': /^ {4}resolvedPort = parsePortArg\(\) \?\? await pickPort\(DEFAULT_PORT\);$/m.test(main),
  'R5 pet DOMParser': pet.includes("new DOMParser().parseFromString(svg, 'image/svg+xml')"),
  'pet whale complete path': /653\.7452393,431\.0113831z$/.test(svg.match(/d="(M[^"]+)"/)[1]),
  'CHANGELOG 0.8.30': changelog.versions.some((x) => x.version === '0.8.30'),
  'pet dev==packaged': pet === fs.readFileSync('modules/pet.js', 'utf8'),
};
let ok = true;
for (const [n, pass] of Object.entries(out)) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
