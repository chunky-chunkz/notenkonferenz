const API_BASE = '/api';

interface FetchOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

class ApiError extends Error {
  constructor(
    public statusCode: number,
    public error: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { params, ...fetchOptions } = options;

  let url = `${API_BASE}${path}`;
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        searchParams.set(key, String(value));
      }
    });
    const qs = searchParams.toString();
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...fetchOptions.headers,
    },
    ...fetchOptions,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? 'unknown', body.message ?? res.statusText);
  }

  return res.json();
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (data: { email: string; password: string; twoFactorCode?: string }) =>
    request<{ user: any }>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),

  register: (data: { email: string; password: string; passwordRepeat: string }) =>
    request<{ user: any }>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),

  logout: () =>
    request<{ status: string }>('/auth/logout', { method: 'POST' }),

  me: () =>
    request<{ user: any; hasPkorgSession: boolean }>('/auth/me'),
};

// ─── Items ───────────────────────────────────────────────────────────────────

export interface ItemsFilter {
  kandidatId?: string;
  name?: string;
  note?: string;
  hauptexperte?: string;
  vf?: string;
  nebenexperte?: string;
  nkVisiert?: string;
  nkChange?: string;
  page?: number;
  pageSize?: number;
}

export const itemsApi = {
  list: (filters: ItemsFilter = {}) =>
    request<{ items: any[]; total: number; page: number; pageSize: number; totalPages: number }>(
      '/items',
      { params: filters as any },
    ),

  my: () =>
    request<{ items: any[] }>('/items/my'),

  get: (kandidatId: number) =>
    request<{ item: any }>(`/items/${kandidatId}`),

  collect: (typ: string) =>
    request<{ item: any }>('/items/collect', { method: 'POST', body: JSON.stringify({ typ }) }),

  validate: (kandidatId: number) =>
    request<{ item: any }>(`/items/${kandidatId}/validate`, { method: 'POST' }),

  drop: (kandidatId: number) =>
    request<{ status: string }>(`/items/${kandidatId}/drop`, { method: 'POST' }),

  change: (kandidatId: number, formData: FormData) =>
    request<{ item: any }>(`/items/${kandidatId}/change`, {
      method: 'POST',
      headers: {}, // Let browser set Content-Type for FormData
      body: formData as any,
    }),

  saveGrade: (kandidatId: number, note: number) =>
    request<{ status: string; item: any }>(`/items/${kandidatId}/grade`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),

  dashboardStats: () =>
    request<any>('/items/dashboard/stats'),

  missingGrades: (filters: ItemsFilter = {}) =>
    request<{ items: any[]; total: number; page: number; pageSize: number; totalPages: number }>(
      '/items/missing-grades',
      { params: filters as any },
    ),
};

// ─── Admin ───────────────────────────────────────────────────────────────────

export const adminApi = {
  users: () =>
    request<{ users: any[] }>('/admin/users'),

  updateRole: (userId: number, role: string) =>
    request<{ user: any }>(`/admin/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  deleteUser: (userId: number) =>
    request<{ status: string }>(`/admin/users/${userId}`, { method: 'DELETE' }),

  logs: (page = 1, pageSize = 25) =>
    request<{ items: any[]; total: number; page: number; pageSize: number; totalPages: number }>(
      '/admin/logs',
      { params: { page, pageSize } },
    ),

  pkorgRoles: () =>
    request<{ roles: { text: string; url: string }[] }>('/admin/pkorg/roles'),

  importNotenuebersicht: (roleUrl?: string) =>
    request<{ jobId: string; status: string }>('/admin/imports/notenuebersicht', {
      method: 'POST',
      body: JSON.stringify({ roleUrl }),
    }),

  importDurchfuehrung: (roleUrl?: string) =>
    request<{ jobId: string; status: string }>('/admin/imports/durchfuehrung', {
      method: 'POST',
      body: JSON.stringify({ roleUrl }),
    }),

  downloadPortfolios: (roleUrl?: string) =>
    request<{ jobId: string; status: string }>('/admin/portfolios/download', {
      method: 'POST',
      body: JSON.stringify({ roleUrl }),
    }),

  emptyDatabase: () =>
    request<{ status: string }>('/admin/empty-database', { method: 'POST' }),

  keepalive: () =>
    request<{ status: string; lastPing: string }>('/admin/keepalive'),

  lastPing: () =>
    request<{ lastPing: string }>('/admin/last-ping'),
};

// ─── Jobs ────────────────────────────────────────────────────────────────────

export const jobsApi = {
  status: (jobId: string) =>
    request<{ jobId: string; type: string; status: string; progress: number; logs: string[]; error?: string }>(
      `/jobs/${jobId}`,
    ),
};

// ─── Files ───────────────────────────────────────────────────────────────────

export const filesApi = {
  portfolioUrl: (kandidatId: number) => `${API_BASE}/files/portfolio/${kandidatId}`,
  templateUrl: (kandidatId: number) => `${API_BASE}/files/template/${kandidatId}`,
  anpassungUrl: (anpassungId: number) => `${API_BASE}/files/anpassung/${anpassungId}`,

  missingPortfolios: () =>
    request<{ missing: any[]; total: number; missingCount: number }>('/files/missing-portfolios'),

  uploadMissingPortfolios: (formData: FormData) =>
    request<{ status: string; savedFiles: string[]; count: number }>('/files/missing-portfolios', {
      method: 'POST',
      headers: {},
      body: formData as any,
    }),
};

export { ApiError };
