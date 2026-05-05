import 'dotenv/config';
import * as XLSX from 'xlsx';

const BASE_URL = process.env.PKORG_BASE_URL || 'https://2026.pkorg.ch';
const EMAIL    = process.argv[2];
const PASSWORD = process.argv[3];
const TOTP     = process.argv[4];

if (!EMAIL || !PASSWORD || !TOTP) {
  console.error('Usage: node check-excel.mjs <email> <passwort> <2FA-CODE>');
  process.exit(1);
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'de-CH,de;q=0.9,en;q=0.8',
};

function parseCookies(headers) {
  const jar = {};
  for (const h of (headers.getSetCookie?.() ?? [])) {
    const [pair] = h.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar[pair.slice(0,idx).trim()] = pair.slice(idx+1).trim();
  }
  return jar;
}
function cookieHeader(jar) { return Object.entries(jar).map(([k,v])=>`${k}=${v}`).join('; '); }

async function fetchC(url, jar, init={}, maxR=10) {
  let cur = url;
  for (let i=0;i<maxR;i++) {
    const res = await fetch(cur, { ...init, headers:{...HEADERS,...(init.headers??{}),Cookie:cookieHeader(jar)}, redirect:'manual' });
    Object.assign(jar, parseCookies(res.headers));
    if (res.status>=300&&res.status<400) {
      const loc=res.headers.get('location');
      if(!loc) break;
      cur=loc.startsWith('http')?loc:new URL(loc,cur).href;
      init={method:'GET'};
      continue;
    }
    return {res,finalUrl:cur};
  }
  throw new Error('Too many redirects');
}

// Login
const jar = {};
const {res:lr,cookies:lc} = await fetchC(`${BASE_URL}/login?api=json`, jar,
  {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:EMAIL,password:PASSWORD})});
Object.assign(jar,lc??{});
if(!lr.ok){console.error('Login failed:',lr.status);process.exit(1);}
console.log('Login OK');

await new Promise(r=>setTimeout(r,2000));
const {finalUrl} = await fetchC(BASE_URL, jar,
  {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Referer:BASE_URL},
   body:new URLSearchParams({pin:TOTP,verifyPin:'1'})});
if(!finalUrl.includes('dashboard')&&!finalUrl.includes('home')){console.error('2FA failed');process.exit(1);}
console.log('2FA OK →', finalUrl);

// Download both excels
for (const [name, id] of [['Notenübersicht','847'],['Durchführung','839']]) {
  const url = `${BASE_URL}/verwaltung/301/41?nauswertungid=${id}`;
  const {res} = await fetchC(url, jar, {headers:{Referer:`${BASE_URL}/dashboard`}});
  if (!res.ok) { console.log(`\n❌ ${name}: ${res.status}`); continue; }
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = XLSX.read(buf, {type:'buffer'});
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  console.log(`\n=== ${name} (${rows.length} Zeilen) ===`);
  console.log('Spalten:', Object.keys(rows[0] ?? {}));
  console.log('Erste Zeile:', JSON.stringify(rows[0], null, 2));
}
