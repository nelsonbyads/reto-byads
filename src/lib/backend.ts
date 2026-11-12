/**
 * DadoFit API client (replaces @supabase/supabase-js).
 *
 * The pages keep the same call shapes they used before — `rpc()`, a small
 * `from()` query builder and `storage.from()` — but everything goes to the
 * self-hosted API under /api, where RLS still decides what each user can see.
 *
 * Session model (SPEC D1/D2): the access token lives only in memory; the
 * refresh token is an httpOnly cookie the browser sends to /api/auth. Mutating
 * auth calls carry the CSRF double-submit token.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { RpcArgs, RpcName, TableName } from '../types/database';

export interface BackendError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

export interface BackendResult<T = any> {
  data: T;
  error: BackendError | null;
  count?: number | null;
}

export interface BackendUser {
  id: string;
  email: string;
  user_metadata: Record<string, any>;
  app_metadata: Record<string, any>;
  profile: {
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
    signup_intent: string | null;
  };
}

interface Session {
  access_token: string;
  expires_in: number;
  user: BackendUser;
}

type AuthListener = (user: BackendUser | null) => void;

const API_BASE = '/api';
const CSRF_COOKIE = 'dadofit_csrf';

let accessToken: string | null = null;
let currentUser: BackendUser | null = null;
let refreshTimer: number | undefined;
let refreshInFlight: Promise<boolean> | null = null;
const listeners = new Set<AuthListener>();

function readCookie(name: string): string {
  const match = document.cookie.split('; ').find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

function toError(status: number, body: any): BackendError {
  if (body && typeof body === 'object' && typeof body.message === 'string') {
    return { message: body.message, code: body.code, details: body.details ?? null, hint: body.hint ?? null };
  }
  if (status === 0) return { message: 'No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.', code: 'network_error' };
  return { message: 'Error inesperado del servidor.', code: `http_${status}` };
}

function setSession(session: Session | null) {
  accessToken = session?.access_token ?? null;
  const previous = currentUser;
  currentUser = session?.user ?? null;
  window.clearTimeout(refreshTimer);
  if (session) {
    // Refresh one minute before the access token expires.
    const delay = Math.max((session.expires_in - 60) * 1000, 10_000);
    refreshTimer = window.setTimeout(() => { void refreshSession(); }, delay);
  }
  if (previous?.id !== currentUser?.id || !session) listeners.forEach((listener) => listener(currentUser));
}

async function rawRequest(path: string, init: RequestInit & { json?: unknown } = {}): Promise<{ status: number; body: any }> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  const csrf = readCookie(CSRF_COOKIE);
  if (csrf) headers.set('x-csrf-token', csrf);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      credentials: 'same-origin',
    });
    const text = await response.text();
    let body: any = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: response.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    const { status, body } = await rawRequest('/auth/refresh', { method: 'POST' });
    if (status === 200 && body?.session) {
      setSession(body.session);
      return true;
    }
    if (status !== 0) setSession(null);
    return false;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** Authenticated request with one transparent retry after refreshing the session. */
async function request(path: string, init: RequestInit & { json?: unknown } = {}): Promise<{ status: number; body: any }> {
  const first = await rawRequest(path, init);
  if (first.status === 401 && accessToken && first.body?.code === 'invalid_token') {
    if (await refreshSession()) return rawRequest(path, init);
  }
  if (first.status === 403 && first.body?.code === 'user_banned') setSession(null);
  return first;
}

async function call<T = any>(path: string, json: unknown): Promise<BackendResult<T>> {
  const { status, body } = await request(path, { method: 'POST', json });
  if (status >= 200 && status < 300) return { data: (body?.data ?? null) as T, error: null, count: body?.count ?? null };
  return { data: null as T, error: toError(status, body), count: null };
}

// ---------------------------------------------------------------------------
// Query builder (subset of the PostgREST API the pages use)
// ---------------------------------------------------------------------------

type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'in' | 'is';

interface QueryState {
  table: string;
  action: 'select' | 'insert' | 'update' | 'delete';
  columns?: string;
  values?: unknown;
  filters: Array<{ column: string; op: FilterOp; value: unknown; negate?: boolean }>;
  order: Array<{ column: string; ascending: boolean; nullsFirst?: boolean }>;
  limit?: number;
  offset?: number;
  count?: 'exact';
  head?: boolean;
  single?: 'single' | 'maybe';
  returning?: string;
}

class QueryBuilder<T = any[]> implements PromiseLike<BackendResult<T>> {
  private state: QueryState;

  constructor(table: string) {
    this.state = { table, action: 'select', filters: [], order: [] };
  }

  select(columns = '*', options: { count?: 'exact'; head?: boolean } = {}) {
    if (this.state.action === 'select') {
      this.state.columns = columns;
      if (options.count) this.state.count = options.count;
      if (options.head) this.state.head = true;
    } else {
      this.state.returning = columns;
    }
    return this;
  }

  insert(values: Record<string, unknown> | Array<Record<string, unknown>>) {
    this.state.action = 'insert';
    this.state.values = values;
    return this;
  }

  update(values: Record<string, unknown>) {
    this.state.action = 'update';
    this.state.values = values;
    return this;
  }

  delete() {
    this.state.action = 'delete';
    return this;
  }

  private filter(column: string, op: FilterOp, value: unknown, negate = false) {
    this.state.filters.push({ column, op, value, negate });
    return this;
  }

  eq(column: string, value: unknown) { return this.filter(column, 'eq', value); }
  neq(column: string, value: unknown) { return this.filter(column, 'neq', value); }
  gt(column: string, value: unknown) { return this.filter(column, 'gt', value); }
  gte(column: string, value: unknown) { return this.filter(column, 'gte', value); }
  lt(column: string, value: unknown) { return this.filter(column, 'lt', value); }
  lte(column: string, value: unknown) { return this.filter(column, 'lte', value); }
  like(column: string, pattern: string) { return this.filter(column, 'like', pattern); }
  ilike(column: string, pattern: string) { return this.filter(column, 'ilike', pattern); }
  in(column: string, values: readonly unknown[]) { return this.filter(column, 'in', [...values]); }
  is(column: string, value: null | boolean) { return this.filter(column, 'is', value); }
  not(column: string, operator: FilterOp, value: unknown) { return this.filter(column, operator, value, true); }
  match(values: Record<string, unknown>) {
    Object.entries(values).forEach(([column, value]) => this.filter(column, 'eq', value));
    return this;
  }

  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    this.state.order.push({ column, ascending: options.ascending !== false, nullsFirst: options.nullsFirst });
    return this;
  }

  limit(count: number) {
    this.state.limit = count;
    return this;
  }

  range(from: number, to: number) {
    this.state.offset = from;
    this.state.limit = to - from + 1;
    return this;
  }

  single() {
    this.state.single = 'single';
    return this as unknown as QueryBuilder<any>;
  }

  maybeSingle() {
    this.state.single = 'maybe';
    return this as unknown as QueryBuilder<any>;
  }

  then<TResult1 = BackendResult<T>, TResult2 = never>(
    onfulfilled?: ((value: BackendResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return call<T>('/db/query', this.state).then(onfulfilled, onrejected);
  }
}

// ---------------------------------------------------------------------------
// File storage
// ---------------------------------------------------------------------------

function bucketApi(bucket: string) {
  return {
    async upload(path: string, file: File | Blob, options: { contentType?: string; upsert?: boolean } = {}): Promise<BackendResult<{ path: string } | null>> {
      const contentType = options.contentType || (file as File).type || 'application/octet-stream';
      const signed = await call<{ signedUrl: string; path: string }>('/files/upload-url', { bucket, path, content_type: contentType, size: file.size });
      if (signed.error || !signed.data) return { data: null, error: signed.error };
      try {
        const response = await fetch(signed.data.signedUrl, { method: 'PUT', headers: { 'content-type': contentType }, body: file, credentials: 'same-origin' });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          return { data: null, error: toError(response.status, body) };
        }
      } catch {
        return { data: null, error: toError(0, null) };
      }
      return { data: { path }, error: null };
    },
    createSignedUrl(path: string, expiresIn: number) {
      return call<{ signedUrl: string }>('/files/sign', { bucket, path, expires_in: expiresIn });
    },
    remove(paths: string[]) {
      return call<Array<{ name: string }>>('/files/remove', { bucket, paths });
    },
  };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function authCall(path: string, json?: unknown): Promise<{ ok: boolean; body: any; error: BackendError | null }> {
  const { status, body } = await rawRequest(`/auth${path}`, { method: 'POST', json: json ?? {} });
  if (status >= 200 && status < 300) return { ok: true, body, error: null };
  return { ok: false, body, error: toError(status, body) };
}

const auth = {
  /** Restores the session from the refresh cookie (page load). */
  async restore(): Promise<BackendUser | null> {
    if (!readCookie(CSRF_COOKIE)) {
      setSession(null);
      return null;
    }
    await refreshSession();
    return currentUser;
  },
  get user() {
    return currentUser;
  },
  onChange(listener: AuthListener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  async login(email: string, password: string) {
    const result = await authCall('/login', { email, password });
    if (result.ok) setSession(result.body.session);
    return result;
  },
  async register(input: { email: string; password: string; display_name: string; account_type: string }) {
    const result = await authCall('/register', input);
    if (result.ok && result.body.session) setSession(result.body.session);
    return result;
  },
  async logout() {
    await rawRequest('/auth/logout', { method: 'POST' });
    setSession(null);
  },
  forgotPassword(email: string) {
    return authCall('/password/forgot', { email });
  },
  resetPassword(token: string, password: string) {
    return authCall('/password/reset', { token, password });
  },
  async changePassword(currentPassword: string, newPassword: string) {
    const { status, body } = await request('/auth/password/change', { method: 'POST', json: { current_password: currentPassword, new_password: newPassword } });
    return status === 204 ? { ok: true, error: null } : { ok: false, error: toError(status, body) };
  },
  confirmEmail(token: string) {
    return authCall('/email/confirm', { token });
  },
  resendConfirmation(email: string) {
    return authCall('/email/resend', { email });
  },
};

export const backend = {
  /**
   * Calls an allowlisted SQL function. The name and arguments are checked
   * against the generated schema types (src/types/database.ts); the result
   * stays `any` unless the caller asks for `RpcReturns<'name'>`.
   */
  rpc<N extends RpcName, T = any>(name: N, params?: RpcArgs<N>): Promise<BackendResult<T>> {
    return call<T>(`/rpc/${encodeURIComponent(name)}`, params ?? {});
  },
  from<T = any[]>(table: TableName) {
    return new QueryBuilder<T>(table);
  },
  storage: {
    from: bucketApi,
  },
  auth,
};

export type BackendClient = typeof backend;

/** The API is same-origin and always available; kept for the pages' guards. */
export const isBackendConfigured = true;

export function requireBackend(): BackendClient {
  return backend;
}
