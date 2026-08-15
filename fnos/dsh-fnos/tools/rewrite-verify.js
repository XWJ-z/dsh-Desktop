// rewrite-verify.js — 验证网关模式重写与信任改写（v3）
'use strict';
const http = require('node:http');

const BASE = 'http://127.0.0.1:5001';
let failures = 0;

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(BASE + path, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        ct: res.headers['content-type'] || '',
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    }).on('error', reject);
  });
}

function check(name, ok, detail) {
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' :: ' + detail : ''}`);
  if (!ok) failures++;
}

(async () => {
  // 1) 页面 HTML
  let r = await get('/app/dsh/');
  check('page 200', r.status === 200, `ct=${r.ct}`);
  check('assets 前缀化', r.body.includes('src="/app/dsh/assets/'));
  check('manifest 前缀化', r.body.includes('href="/app/dsh/manifest.webmanifest"'));

  // 2) __DSH_BOOT__ /plugins 前缀化 + 遍历所有 bundle
  const bootMatch = /window\.__DSH_BOOT__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/.exec(r.body);
  check('boot 注入存在', !!bootMatch);
  let apiBundleChecked = 0;
  if (bootMatch) {
    const boot = bootMatch[1];
    check('boot /plugins 前缀化', boot.includes('"/app/dsh/plugins/'));
    const urls = [...boot.matchAll(/"url":"([^"]+client\.js[^"]*)"/g)].map((m) => m[1]);
    check('boot 有 bundle 列表', urls.length > 0, `count=${urls.length}`);
    for (const u of urls) {
      r = await get(u);
      if (r.status !== 200) { check(`bundle ${u.slice(0, 50)} 200`, false); continue; }
      // 重写后：API URL 应带前缀；检查结果而非原始（原始 /api 已被替换）
      const hasPrefixed = r.body.includes('"/app/dsh/api/')
        || r.body.includes('`/app/dsh/api/')
        || r.body.includes('API_PATH = "/app/dsh/api"');
      const hasResidual = r.body.includes('"/api/') || r.body.includes('`/api/');
      if (hasPrefixed || hasResidual) {
        apiBundleChecked++;
        check(`bundle ${u.match(/plugins\/([^/]+)\/[^/]+$/)?.[1] ?? u.slice(0, 30)} /api 前缀化`,
          hasPrefixed && !hasResidual, `prefixed=${hasPrefixed} residual=${hasResidual}`);
      }
      // 比较逻辑不被误伤：channel !== "/api" 保留
      if (r.body.includes('!== "/api"')) {
        check('比较逻辑保留', !r.body.includes('!== "/app/dsh/api"'), '');
      }
    }
  }
  check('至少一个 bundle 含 /api 且已前缀化', apiBundleChecked >= 1, `checked=${apiBundleChecked}`);

  // 3) 信任改写：Host=NAS域名 + Origin=NAS域名 → 非 403
  r = await get('/app/dsh/api/sessions', {
    Host: 'x-nas3.local:80',
    Origin: 'http://x-nas3.local',
    'Sec-Fetch-Site': 'same-origin',
  });
  check('api trust 非403', r.status !== 403, `status=${r.status}`);

  process.exit(failures === 0 ? 0 : 1);
})();
