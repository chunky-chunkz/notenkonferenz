/**
 * PKOrg Integration Client
 *
 * Encapsulates all interaction with the external PKOrg system:
 * - Login (with optional 2FA)
 * - Session keepalive/ping
 * - Role listing (HTML scraping)
 * - Role switching
 * - Excel report downloads
 * - Portfolio ZIP downloads
 *
 * ⚠️  This module processes user credentials server-side.
 *     Ensure your organization's security policy permits this.
 */

import * as cheerio from 'cheerio';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

const BASE_URL = env.PKORG_BASE_URL;

type CookieJar = Record<string, string>;

function cookieHeader(cookies: CookieJar): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function parseCookies(setCookieHeaders: string[]): CookieJar {
  const jar: CookieJar = {};
  for (const header of setCookieHeaders) {
    const [pair] = header.split(';');
    const [name, value] = pair.split('=');
    if (name && value) {
      jar[name.trim()] = value.trim();
    }
  }
  return jar;
}

/**
 * Follow redirects manually so cookies are forwarded on each hop
 * (like Python requests.Session does).
 * Returns the final response, the final URL (after all redirects), and the merged cookies.
 */
async function fetchWithCookies(
  url: string,
  cookies: CookieJar,
  init: RequestInit = {},
  maxRedirects = 10,
): Promise<{ res: Response; cookies: CookieJar; finalUrl: string }> {
  let currentUrl = url;
  const jar = { ...cookies };

  for (let i = 0; i < maxRedirects; i++) {
    const res = await fetch(currentUrl, {
      ...init,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-CH,de;q=0.9,en;q=0.8',
        ...(init.headers as Record<string, string> ?? {}),
        Cookie: cookieHeader(jar),
      },
      redirect: 'manual',
    });

    // Merge any new cookies from this response
    const newCookies = parseCookies(res.headers.getSetCookie?.() ?? []);
    Object.assign(jar, newCookies);

    // Follow redirects (3xx)
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) break;
      currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href;
      // Switch to GET after redirect (standard browser behaviour)
      init = { method: 'GET', headers: {} };
      continue;
    }

    return { res, cookies: jar, finalUrl: currentUrl };
  }

  throw new Error('Too many redirects');
}

/**
 * Login to PKOrg with email/password + 2FA code.
 *
 * Mirrors Django's logic 1:1:
 *   session = requests.Session()
 *   login_response = session.post(login_url, json=payload)   # follows redirects
 *   if login_response.status_code == 200:
 *     twofa_response = session.post(BASE_URL, data={pin,verifyPin}, headers)
 *     if "dashboard" in twofa_response.url or "home" in twofa_response.url: → success
 *   return session.cookies.get_dict()
 */
export async function pkorgLogin(
  email: string,
  password: string,
  twoFactorCode: string,
): Promise<CookieJar> {
  logger.info('PKOrg login attempt', { email });

  const jar: CookieJar = {};

  // Step 1: POST /login?api=json  (follow redirects like requests.Session does)
  const { res: loginRes, cookies: loginCookies } = await fetchWithCookies(
    `${BASE_URL}/login?api=json`,
    jar,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password }),
    },
  );
  Object.assign(jar, loginCookies);

  // Django checks: if login_response.status_code == 200  (after following redirects)
  if (!loginRes.ok) {
    throw new Error(`PKOrg login failed: ${loginRes.status}`);
  }

  // Step 2: 2FA – delay like Django's _pkorg_delay()
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const { res: twoFaRes, cookies: twoFaCookies, finalUrl: twoFaUrl } = await fetchWithCookies(
    BASE_URL,
    jar,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: BASE_URL,
      },
      body: new URLSearchParams({ pin: twoFactorCode, verifyPin: '1' }),
    },
  );
  Object.assign(jar, twoFaCookies);

  // Django checks: if "dashboard" in twofa_response.url or "home" in twofa_response.url
  if (!twoFaUrl.includes('dashboard') && !twoFaUrl.includes('home')) {
    throw new Error(`2FA verification failed – landed on: ${twoFaUrl}`);
  }

  logger.info('PKOrg login successful', { email, finalUrl: twoFaUrl });
  return jar;
}

/**
 * Ping PKOrg dashboard to keep session alive.
 */
export async function pkorgPing(cookies: CookieJar): Promise<boolean> {
  try {
    const { res } = await fetchWithCookies(`${BASE_URL}/dashboard`, cookies);
    return res.status === 200;
  } catch (err) {
    logger.warn('PKOrg ping failed', { error: (err as Error).message });
    return false;
  }
}

/**
 * Get available roles from PKOrg dashboard HTML (scraping).
 *
 * PKOrg uses AngularJS switchAffiliation() — all <a> elements have href="#".
 * The actual role data is embedded as:
 *   var affiliations = [{
 *     "nrolle2mandantid": 8963,
 *     "label_client": "Inf Api CH",   ← e.g. "Inf Api CH", "Inf Platt CH"
 *     "label_role": "CEX",            ← CEX | VEX | EXP | BB | HEK
 *     ...
 *   }, ...]
 *
 * The switch URL is /mandant/switch/{nrolle2mandantid}.
 */
export async function pkorgGetRoles(cookies: CookieJar): Promise<{ text: string; url: string }[]> {
  const { res } = await fetchWithCookies(`${BASE_URL}/`, cookies);

  if (!res.ok) {
    throw new Error(`Failed to fetch PKOrg roles: ${res.status}`);
  }

  const html = await res.text();
  logger.debug('pkorgGetRoles: HTML length', { length: html.length, preview: html.substring(0, 300) });

  // Primary: parse the embedded `var affiliations = [...]` JSON
  const affMatch = html.match(/var\s+affiliations\s*=\s*(\[[\s\S]*?\]);/);
  logger.debug('pkorgGetRoles: affiliations match', { found: !!affMatch });
  if (affMatch) {
    try {
      const affiliations: Array<{
        nrolle2mandantid: number;
        label_client: string;
        label_role: string;
      }> = JSON.parse(affMatch[1]);

      logger.debug('pkorgGetRoles: parsed affiliations', { count: affiliations.length, sample: affiliations[0] });

      return affiliations
        .filter((a) => a.nrolle2mandantid && a.label_client && a.label_role)
        .map((a) => ({
          text: `${a.label_client} (${a.label_role})`,
          url:  `/mandant/switch/${a.nrolle2mandantid}`,
        }));
    } catch (err) {
      logger.warn('Failed to parse affiliations JSON from PKOrg HTML', { error: (err as Error).message });
    }
  }

  // Fallback: scrape the mobile switcher links (may have href="#" on newer PKOrg versions)
  const $ = cheerio.load(html);
  const roles: { text: string; url: string }[] = [];
  $('#client-switcher-mobile a.mandantSwitch').each((_i, el) => {
    const text = $(el).text().trim();
    const url = $(el).attr('href') ?? '';
    if (text && url && url !== '#') {
      roles.push({ text, url });
    }
  });

  logger.debug('pkorgGetRoles: fallback scraper found', { count: roles.length });

  // Last resort: try alternate variable names or JSON blocks
  if (roles.length === 0) {
    // Try "affiliations" without "var" keyword (minified JS)
    const jsonMatch = html.match(/affiliations\s*[=:]\s*(\[[\s\S]*?\])[,;]/);
    if (jsonMatch) {
      try {
        const affiliations: Array<{ nrolle2mandantid?: number; label_client?: string; label_role?: string }> = JSON.parse(jsonMatch[1]);
        logger.debug('pkorgGetRoles: found via alternate pattern', { count: affiliations.length });
        return affiliations
          .filter((a) => a.nrolle2mandantid && a.label_client && a.label_role)
          .map((a) => ({
            text: `${a.label_client} (${a.label_role})`,
            url:  `/mandant/switch/${a.nrolle2mandantid}`,
          }));
      } catch { /* ignore */ }
    }

    // Log a section of the HTML around "affiliations" for manual inspection
    const idx = html.indexOf('affiliations');
    if (idx !== -1) {
      logger.warn('pkorgGetRoles: "affiliations" found in HTML but could not parse', {
        context: html.substring(Math.max(0, idx - 50), idx + 300),
      });
    } else {
      logger.warn('pkorgGetRoles: "affiliations" NOT found in HTML at all — session may be invalid or HTML structure changed');
    }
  }

  return roles;
}

/**
 * Switch to a PKOrg role (best-effort).
 *
 * PKOrg's actual role switch is driven by AngularJS calling an internal API.
 * The URLs in the HTML all have href="#", so a direct GET cannot reliably switch
 * the server-side session. We try a few known URL patterns and log a warning if
 * all fail — the LOCAL session filter (activePkorgFachrichtung) is set regardless.
 *
 * Returns updated cookies on success, or the original jar if the switch fails.
 */
export async function pkorgSwitchRole(
  cookies: CookieJar,
  roleUrl: string,
): Promise<{ cookies: CookieJar; switched: boolean }> {
  if (!roleUrl || roleUrl === '#') {
    logger.warn('pkorgSwitchRole: no real URL provided — local filter updated, PKOrg session unchanged');
    return { cookies, switched: false };
  }

  const fullUrl = roleUrl.startsWith('http')
    ? roleUrl
    : `${BASE_URL}${roleUrl.startsWith('/') ? '' : '/'}${roleUrl}`;

  try {
    const { res, cookies: updatedCookies } = await fetchWithCookies(fullUrl, cookies);
    if (res.ok) {
      return { cookies: updatedCookies, switched: true };
    }
    logger.warn('pkorgSwitchRole: HTTP switch returned non-OK status', { status: res.status, url: fullUrl });
  } catch (err) {
    logger.warn('pkorgSwitchRole: HTTP switch request failed', { error: (err as Error).message, url: fullUrl });
  }

  // Return original cookies — local session filter is still applied
  return { cookies, switched: false };
}

/**
 * Download an Excel file from PKOrg.
 */
export async function pkorgDownloadExcel(
  cookies: CookieJar,
  reportUrl: string,
): Promise<Buffer> {
  const { res } = await fetchWithCookies(reportUrl, cookies, {
    headers: { Referer: `${BASE_URL}/dashboard` },
  });

  if (!res.ok) {
    throw new Error(`Excel download failed: ${res.status}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    // PKOrg returned an HTML page (likely a login redirect or session expiry)
    const html = await res.text();
    const snippet = html.slice(0, 300).replace(/\s+/g, ' ');
    throw new Error(
      `PKOrg session abgelaufen oder ungültig – HTML statt Excel erhalten. Snippet: ${snippet}`,
    );
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Download a portfolio ZIP for a specific kandidat.
 */
export async function pkorgDownloadPortfolioZip(
  cookies: CookieJar,
  nmandantid: string | number,
  kandidatId: number,
): Promise<Buffer> {
  const url = `${BASE_URL}/generate-zip/${nmandantid}/${kandidatId}`;
  const { res } = await fetchWithCookies(url, cookies);

  if (!res.ok) {
    throw new Error(`Portfolio download failed for ${kandidatId}: ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Get nmandantid from PKOrg dashboard API.
 */
export async function pkorgGetMandantId(cookies: CookieJar): Promise<string> {
  const res = await fetch(`${BASE_URL}/dashboard/data?api=json`, {
    headers: { Cookie: cookieHeader(cookies) },
  });

  if (!res.ok) {
    throw new Error(`Failed to get mandant ID: ${res.status}`);
  }

  const data = await res.json() as any;
  return data.my.nmandantid;
}
