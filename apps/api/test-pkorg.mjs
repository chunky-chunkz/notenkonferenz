/**
 * PKOrg connection test - run with:
 *   node test-pkorg.mjs
 * 
 * Set env vars or edit directly below:
 */
import 'dotenv/config';

const BASE_URL = process.env.PKORG_BASE_URL || 'https://2026.pkorg.ch';
// Usage: node test-pkorg.mjs <email> <password> <2FA-code>
const EMAIL    = process.argv[2];
const PASSWORD = process.argv[3];
const TOTP     = process.argv[4];

// ── helpers ──────────────────────────────────────────────────────────────────
function cookieHeader(jar) {
  return Object.entries(jar).map(([k,v]) => `${k}=${v}`).join('; ');
}
function parseCookies(headers) {
  const jar = {};
  for (const h of (headers.getSetCookie?.() ?? [])) {
    const [pair] = h.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar[pair.slice(0,idx).trim()] = pair.slice(idx+1).trim();
  }
  return jar;
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'de-CH,de;q=0.9,en;q=0.8',
};

async function fetchWithCookies(url, jar, init = {}, maxRedirects = 10) {
  let currentUrl = url;
  for (let i = 0; i < maxRedirects; i++) {
    const res = await fetch(currentUrl, {
      ...init,
      headers: { ...BROWSER_HEADERS, ...(init.headers ?? {}), Cookie: cookieHeader(jar) },
      redirect: 'manual',
    });
    Object.assign(jar, parseCookies(res.headers));
    console.log(`  [${res.status}] ${currentUrl}`);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) break;
      currentUrl = loc.startsWith('http') ? loc : new URL(loc, currentUrl).href;
      init = { method: 'GET' };
      continue;
    }
    return { res, finalUrl: currentUrl };
  }
  throw new Error('Too many redirects');
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!EMAIL || !PASSWORD || !TOTP) {
    console.error('Usage: node test-pkorg.mjs <email> <passwort> <2FA-CODE>');
    console.error('Beispiel: node test-pkorg.mjs mein@email.ch meinpasswort 123456');
    process.exit(1);
  }

  const jar = {};

  // 1. Login — mit redirect-follow wie requests.Session (Django)
  console.log('\n=== Step 1: Login ===');
  const { res: loginRes, cookies: loginCookies } = await fetchWithCookies(
    `${BASE_URL}/login?api=json`, jar,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: EMAIL, password: PASSWORD }) }
  );
  Object.assign(jar, loginCookies);
  console.log(`  Status nach redirect-follow: ${loginRes.status}`);
  console.log(`  Cookies: ${JSON.stringify(Object.keys(jar))}`);
  if (!loginRes.ok) { console.error('  ❌ Login fehlgeschlagen!'); process.exit(1); }

  // 2. 2FA — genau wie Django: session.post(BASE_URL, data={pin,verifyPin})
  console.log('\n=== Step 2: 2FA ===');
  await new Promise(r => setTimeout(r, 2000));
  const { res: twoFaRes, cookies: twoFaCookies, finalUrl: twoFaUrl } = await fetchWithCookies(
    BASE_URL, jar,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: BASE_URL },
      body: new URLSearchParams({ pin: TOTP, verifyPin: '1' }) }
  );
  Object.assign(jar, twoFaCookies);
  console.log(`  Final URL: ${twoFaUrl}`);
  if (!twoFaUrl.includes('dashboard') && !twoFaUrl.includes('home')) {
    console.error(`  ❌ 2FA fehlgeschlagen! (landed: ${twoFaUrl})`); process.exit(1);
  }
  console.log('  ✅ Eingeloggt!');

  // 3. Rollen laden — GET /  (Django: session.get(BASE_URL + '/'))
  console.log('\n=== Step 3: Rollen laden ===');
  const { res: homeRes } = await fetchWithCookies(`${BASE_URL}/`, jar);
  const html = await homeRes.text();
  // CSS selector: #client-switcher-mobile a.mandantSwitch  (wie Django mit BeautifulSoup)
  const roles = [...html.matchAll(/href="(\/mandant\/switch\/[^"]+)"[^>]*>\s*([\s\S]*?)\s*<\/a>/g)]
    .map(m => ({ url: m[1], text: m[2].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim() }));
  
  if (roles.length === 0) {
    console.log('  ⚠️  Keine Rollen. Speichere HTML → debug.html ...');
    import('fs').then(fs => fs.writeFileSync('debug.html', html));
    console.log('     Final URL der Startseite:', homeRes.url ?? twoFaUrl);
  } else {
    roles.forEach((r, i) => console.log(`  [${i}] ${r.text} → ${r.url}`));
  }

  // 4. Erste Rolle wechseln — wie Django: encoded_path, session.get(full_url)
  if (roles.length > 0) {
    const role = roles[0];
    console.log(`\n=== Step 4: Rollenwechsel → ${role.text} ===`);
    const encodedPath = role.url.replace(/^\//, '').split('/').map(encodeURIComponent).join('/');
    const { res: roleRes, cookies: roleCookies } = await fetchWithCookies(`${BASE_URL}/${encodedPath}`, jar);
    Object.assign(jar, roleCookies);
    console.log(`  Status: ${roleRes.status} ${roleRes.ok ? '✅' : '❌'}`);
  }

  // 5. Excel-Download testen
  console.log('\n=== Step 5: Excel-Download (nauswertungid=847) ===');
  const excelUrl = `${BASE_URL}/verwaltung/301/41?nauswertungid=847`;
  const { res: excelRes, finalUrl: excelFinal } = await fetchWithCookies(excelUrl, jar, {
    headers: { Referer: `${BASE_URL}/dashboard` },
  });
  console.log(`  Final URL: ${excelFinal}`);
  console.log(`  Status: ${excelRes.status}`);
  console.log(`  Content-Type: ${excelRes.headers.get('content-type')}`);
  
  if (excelRes.ok) {
    const buf = await excelRes.arrayBuffer();
    console.log(`  ✅ Excel: ${buf.byteLength} Bytes`);
  } else {
    const body = await excelRes.text();
    console.log(`  ❌ Body: ${body.slice(0, 300)}`);
  }
}

main().catch(console.error);
