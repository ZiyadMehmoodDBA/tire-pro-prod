import { cacheSettingsMap } from '../lib/appSettings';
import { getAccessToken, getRefreshToken, setAccessToken, clearTokens } from '../lib/auth';
import type { Sale, Purchase, Customer, Supplier, TireSku, Payment, User, Branch, Organization } from '../types/models';

// Registered by App.tsx so the client can trigger logout without a circular dep
let _onLogout: (() => void) | null = null;
export function registerLogoutCallback(fn: () => void) { _onLogout = fn; }

// Deduplicates concurrent refresh calls so only one hits the server
let _refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) throw new Error('No refresh token');

    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) throw new Error('Refresh failed');
    const { accessToken } = await res.json();
    setAccessToken(accessToken);
    return accessToken;
  })().finally(() => { _refreshPromise = null; });

  return _refreshPromise;
}

function orgHeaders(): Record<string, string> {
  return {
    'X-Org-ID':    localStorage.getItem('orgId')    || '1',
    'X-Branch-ID': localStorage.getItem('branchId') || '1',
  };
}

async function request<T>(path: string, options?: RequestInit, isRetry = false): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...orgHeaders(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`/api${path}`, { headers, ...options });

  if (res.status === 401 && !isRetry) {
    const body = await res.json().catch(() => ({}));
    if (body.code === 'TOKEN_EXPIRED') {
      try {
        await refreshAccessToken();
        return request<T>(path, options, true);
      } catch {
        clearTokens();
        _onLogout?.();
        throw new Error('Session expired. Please sign in again.');
      }
    }
    clearTokens();
    _onLogout?.();
    throw new Error('Authentication required');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export const api = {
  auth: {
    login: (data: { email: string; password: string; rememberMe?: boolean }) =>
      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(r => r.ok ? r.json() : r.json().then((e: any) => Promise.reject(new Error(e.error)))),

    forgotPassword: (email: string) =>
      fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }).then(r => r.ok ? r.json() : r.json().then((e: any) => Promise.reject(new Error(e.error)))),

    resetPassword: (resetToken: string, newPassword: string) =>
      fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetToken, newPassword }),
      }).then(r => r.ok ? r.json() : r.json().then((e: any) => Promise.reject(new Error(e.error)))),

    google: (credential: string) =>
      fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      }).then(r => r.ok ? r.json() : r.json().then((e: any) => Promise.reject(new Error(e.error)))),

    demo: () =>
      fetch('/api/auth/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }).then(r => r.ok ? r.json() : r.json().then((e: any) => Promise.reject(new Error(e.error)))),

    register: (data: any) =>
      fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(r => r.ok ? r.json() : r.json().then((e: any) => Promise.reject(new Error(e.error)))),

    refresh: () => {
      const refreshToken = getRefreshToken();
      return fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).then(r => r.ok ? r.json() : Promise.reject(new Error('Refresh failed')));
    },

    logout: () => {
      const refreshToken = getRefreshToken();
      return fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => {});
    },
  },
  organizations: {
    list:   ()                      => request<Organization[]>('/organizations'),
    get:    (id: number)            => request<any>(`/organizations/${id}`),
    create: (data: any)             => request<any>('/organizations', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/organizations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  branches: {
    list:   ()                      => request<Branch[]>('/branches'),
    get:    (id: number)            => request<any>(`/branches/${id}`),
    create: (data: any)             => request<any>('/branches', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/branches/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number)            => request<any>(`/branches/${id}`, { method: 'DELETE' }),
  },
  customers: {
    list:   ()                      => request<Customer[]>('/customers'),
    get:    (id: number)            => request<Customer>(`/customers/${id}`),
    create: (data: any)             => request<Customer>('/customers', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<Customer>(`/customers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number)            => request<any>(`/customers/${id}`, { method: 'DELETE' }),
    bulk:   (data: any)             => request<any>('/customers/bulk', { method: 'POST', body: JSON.stringify(data) }),
  },
  suppliers: {
    list:   ()                      => request<Supplier[]>('/suppliers'),
    get:    (id: number)            => request<Supplier>(`/suppliers/${id}`),
    create: (data: any)             => request<Supplier>('/suppliers', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<Supplier>(`/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number)            => request<any>(`/suppliers/${id}`, { method: 'DELETE' }),
    bulk:   (data: any)             => request<any>('/suppliers/bulk', { method: 'POST', body: JSON.stringify(data) }),
  },
  inventory: {
    list:   ()                      => request<TireSku[]>('/inventory'),
    get:    (id: number)            => request<TireSku>(`/inventory/${id}`),
    create: (data: any)             => request<TireSku>('/inventory', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<TireSku>(`/inventory/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number)            => request<any>(`/inventory/${id}`, { method: 'DELETE' }),
    bulk:           (data: any)             => request<any>('/inventory/bulk', { method: 'POST', body: JSON.stringify(data) }),
    catalogBrands:  ()                      => request<string[]>('/inventory/catalog-brands'),
    importFromCatalog: (brands?: string[])  => request<{ inserted: number }>('/inventory/import-catalog', {
      method: 'POST',
      body: JSON.stringify({ brands }),
    }),
  },
  sales: {
    list:         ()             => request<Sale[]>('/sales'),
    listFiltered: (params?: { from?: string; to?: string }) => {
      const qs = new URLSearchParams();
      if (params?.from) qs.set('from', params.from);
      if (params?.to)   qs.set('to',   params.to);
      const suffix = qs.toString() ? `?${qs}` : '';
      return request<Sale[]>(`/sales${suffix}`);
    },
    get:          (id: number)   => request<Sale>(`/sales/${id}`),
    create:       (data: any)    => request<Sale>('/sales', { method: 'POST', body: JSON.stringify(data) }),
    updateStatus: (id: number, status: string) =>
      request<any>(`/sales/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    void:         (id: number)   => request<any>(`/sales/${id}/void`, { method: 'POST' }),
    delete:       (id: number)   => request<any>(`/sales/${id}`, { method: 'DELETE' }),
    bulk:         (data: any)    => request<any>('/sales/bulk', { method: 'POST', body: JSON.stringify(data) }),
    byTireType:   ()             => request<{ tire_type: string; item_count: number; revenue: number }[]>('/sales/by-tire-type'),
    dashboardStats: ()           => request<any>('/sales/stats/dashboard'),
  },
  purchases: {
    list:         ()             => request<Purchase[]>('/purchases'),
    get:          (id: number)   => request<Purchase>(`/purchases/${id}`),
    create:       (data: any)    => request<Purchase>('/purchases', { method: 'POST', body: JSON.stringify(data) }),
    updateStatus: (id: number, status: string) =>
      request<any>(`/purchases/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    delete:       (id: number)   => request<any>(`/purchases/${id}`, { method: 'DELETE' }),
    bulk:         (data: any)    => request<any>('/purchases/bulk', { method: 'POST', body: JSON.stringify(data) }),
  },
  settings: {
    get: async (): Promise<Record<string, string>> => {
      const data = await request<Record<string, string>>('/settings');
      cacheSettingsMap(data);
      return data;
    },
    update: async (data: Record<string, string>): Promise<Record<string, string>> => {
      const result = await request<Record<string, string>>('/settings', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      cacheSettingsMap(result);
      return result;
    },
    systemInfo: () => request<{
      server: {
        uptime_seconds: number;
        node_version:   string;
        platform:       string;
        memory_used_mb: number;
        memory_heap_mb: number;
        timestamp:      string;
      };
      database: {
        data_mb:  number;
        log_mb:   number;
        total_mb: number;
        counts: {
          tire_skus:        number;
          total_sales:      number;
          total_purchases:  number;
          customers:        number;
          users_count:      number;
          catalog_entries:  number;
        };
      };
      sessions: {
        active_count: number;
        users: { name: string; email: string; role: string; last_active: string }[];
      };
    }>('/settings/system-info'),
  },
  products: {
    list:   ()                      => request<any[]>('/products'),
    create: (data: any)             => request<any>('/products', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number)            => request<any>(`/products/${id}`, { method: 'DELETE' }),
  },
  lookups: {
    tireTypes:      ()                      => request<any[]>('/lookups/tire-types'),
    addTireType:    (name: string)          => request<any>('/lookups/tire-types', { method: 'POST', body: JSON.stringify({ name }) }),
    updateTireType: (id: number, data: any) => request<any>(`/lookups/tire-types/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteTireType: (id: number)            => request<any>(`/lookups/tire-types/${id}`, { method: 'DELETE' }),
    tireSuggestions: () => request<{
      brands:       string[];
      models:       { brand: string; model: string }[];
      sizes:        { brand: string; model: string; size: string }[];
      patterns:     string[];
      load_indexes: string[];
    }>('/lookups/tire-suggestions'),
  },
  payments: {
    recordSalePayment:      (data: any)          => request<any>('/payments/sale', { method: 'POST', body: JSON.stringify(data) }),
    getSalePayments:        (saleId: number)      => request<Payment[]>(`/payments/sale/${saleId}`),
    deleteSalePayment:      (id: number)          => request<any>(`/payments/sale/${id}`, { method: 'DELETE' }),
    recordPurchasePayment:  (data: any)          => request<any>('/payments/purchase', { method: 'POST', body: JSON.stringify(data) }),
    getPurchasePayments:    (purchaseId: number)  => request<Payment[]>(`/payments/purchase/${purchaseId}`),
    deletePurchasePayment:  (id: number)          => request<any>(`/payments/purchase/${id}`, { method: 'DELETE' }),
  },
  users: {
    list:      ()                       => request<User[]>('/users'),
    create:    (data: any)              => request<any>('/users', { method: 'POST', body: JSON.stringify(data) }),
    update:    (id: number, data: any)  => request<any>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    setStatus: (id: number, active: boolean) =>
      request<any>(`/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ is_active: active }) }),
    resetPassword: (id: number, password: string) =>
      request<any>(`/users/${id}/password`, { method: 'PATCH', body: JSON.stringify({ password }) }),
  },
  profile: {
    get: () => request<any>('/profile'),
    update: (data: {
      name: string; first_name?: string; last_name?: string; phone?: string;
      address?: string; job_title?: string; department?: string; date_of_birth?: string;
      emergency_contact_name?: string; emergency_contact_phone?: string; emergency_contact_relation?: string;
    }) => request<any>('/profile', { method: 'PUT', body: JSON.stringify(data) }),
    changePassword: (data: { currentPassword: string; newPassword: string }) =>
      request<{ success: boolean; refreshToken: string }>('/profile/change-password', {
        method: 'POST', body: JSON.stringify(data),
      }),
  },
  catalog: {
    stats:         () => request<{ total_entries: number; total_brands: number; total_models: number; gtr_entries: number }>('/catalog/stats'),
    scraperConfig: () => request<{
      enabled: boolean; schedule: string; isRunning: boolean; isScheduled: boolean;
      scheduleOptions: { value: string; label: string }[];
    }>('/catalog/scraper/config'),
    saveScraperConfig: (data: { enabled: boolean; schedule: string }) =>
      request<{ success: boolean; enabled: boolean; schedule: string; isRunning: boolean; isScheduled: boolean }>(
        '/catalog/scraper/config', { method: 'POST', body: JSON.stringify(data) },
      ),
    runScraper:    () => request<{ success: boolean; message: string }>('/catalog/scraper/run', { method: 'POST' }),
    scraperStatus: () => request<{
      isRunning: boolean; isScheduled: boolean;
      recentLogs: {
        id: number; source: string; status: string;
        started_at: string; finished_at: string | null;
        items_found: number; items_added: number; items_updated: number;
        error_msg: string | null; triggered_by: string;
      }[];
      gtrCounts: { total: number; brands: number; models: number };
    }>('/catalog/scraper/status'),
    entries: (params?: { q?: string; brand?: string; model?: string; size?: string; page?: number; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.q)     qs.set('q',     params.q);
      if (params?.brand) qs.set('brand', params.brand);
      if (params?.model) qs.set('model', params.model);
      if (params?.size)  qs.set('size',  params.size);
      if (params?.page)  qs.set('page',  String(params.page));
      if (params?.limit) qs.set('limit', String(params.limit));
      return request<{ entries: any[]; total: number; page: number; pageSize: number }>(
        `/catalog/entries${qs.toString() ? '?' + qs : ''}`,
      );
    },
    deleteEntry: (id: number) => request<{ success: boolean }>(`/catalog/entries/${id}`, { method: 'DELETE' }),
  },
  fitments: {
    categories: () => request<string[]>('/fitments/categories'),
    makes:  (category?: string) => {
      const qs = category ? `?category=${encodeURIComponent(category)}` : '';
      return request<string[]>(`/fitments/makes${qs}`);
    },
    models: (make: string, category?: string) => {
      const qs = new URLSearchParams({ make });
      if (category) qs.set('category', category);
      return request<string[]>(`/fitments/models?${qs}`);
    },
    search: (params: { make?: string; model?: string; category?: string }) => {
      const qs = new URLSearchParams();
      if (params.make)     qs.set('make',     params.make);
      if (params.model)    qs.set('model',    params.model);
      if (params.category) qs.set('category', params.category);
      return request<{
        fitments: {
          id: number;
          category: string;
          make: string;
          model: string;
          year_from: number | null;
          year_to: number | null;
          tire_size: string;
          gtr_pattern: string | null;
          position: 'Front' | 'Rear' | null;
        }[];
        catalogMatches: Record<string, {
          id: number; brand: string; tire_model: string; size: string;
          pattern: string | null; load_index: string | null;
          speed_index: string | null; tire_type: string | null;
        }[]>;
      }>(`/fitments/search?${qs}`);
    },
  },
  audit: {
    list: (params?: { entity?: string; action?: string; from?: string; to?: string; page?: number; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.entity) qs.set('entity', params.entity);
      if (params?.action) qs.set('action', params.action);
      if (params?.from)   qs.set('from',   params.from);
      if (params?.to)     qs.set('to',     params.to);
      if (params?.page)   qs.set('page',   String(params.page));
      if (params?.limit)  qs.set('limit',  String(params.limit));
      const suffix = qs.toString() ? `?${qs}` : '';
      return request<{ logs: any[]; total: number; page: number; limit: number }>(`/audit${suffix}`);
    },
  },
  ledger: {
    summary:           ()           => request<any>('/ledger/summary'),
    customers:         ()           => request<any[]>('/ledger/customers'),
    suppliers:         ()           => request<any[]>('/ledger/suppliers'),
    customerStatement: (id: number) => request<any>(`/ledger/customer/${id}/statement`),
    supplierStatement: (id: number) => request<any>(`/ledger/supplier/${id}/statement`),
    unpaidInvoices:    (id: number) => request<any[]>(`/ledger/customer/${id}/unpaid-invoices`),
    unpaidPOs:         (id: number) => request<any[]>(`/ledger/supplier/${id}/unpaid-pos`),
  },
};
