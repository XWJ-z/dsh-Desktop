'use strict';
// 三源验证 version.json（raw / api.github / jsDelivr）—— 发布流程步骤 8
const sources = [
  { name: 'raw.githubusercontent', url: 'https://raw.githubusercontent.com/XWJ-z/dsh-Desktop/main/version.json' },
  { name: 'GitHub API', url: 'https://api.github.com/repos/XWJ-z/dsh-Desktop/contents/version.json?ref=main', headers: { 'User-Agent': 'DSH-Desktop', Accept: 'application/vnd.github.raw+json' } },
  { name: 'jsDelivr', url: 'https://cdn.jsdelivr.net/gh/XWJ-z/dsh-Desktop@main/version.json' },
];
(async () => {
  let allOk = true;
  for (const s of sources) {
    try {
      const res = await fetch(s.url, { headers: s.headers || {}, signal: AbortSignal.timeout(20000) });
      const text = await res.text();
      const j = JSON.parse(text);
      console.log(`[${s.name}] status=${res.status} version=${j.version} hash=${String(j.hash).slice(0, 16)}...`);
      if (j.version !== '1.1.2' || String(j.hash).toLowerCase() !== '10b853e81150fb4035e375d5efc1838a06e66aaad80ba4988f365ccf4a5f1b76') allOk = false;
    } catch (err) {
      console.log(`[${s.name}] FAIL ${err.message}`);
      allOk = false;
    }
  }
  console.log(allOk ? 'ALL SOURCES OK' : 'HAS MISMATCH');
  process.exit(allOk ? 0 : 1);
})();
