/** Grade range boundaries for IPA categories */
export const GRADE_RANGES = {
  ungenuegend: { gte: 0, lte: 3.9 },
  knapp: { gte: 4.0, lte: 4.3 },
  gut: { gte: 4.4, lte: 5.7 },
  sehrgut: { gte: 5.8, lte: 6.0 },
} as const;

/** Default pagination page size */
export const DEFAULT_PAGE_SIZE = 25;

/** Session cookie name */
export const SESSION_COOKIE_NAME = 'mcs_session';

/** PKOrg base URL (2025 season) */
export const PKORG_BASE_URL = 'https://2026.pkorg.ch';
