// frontend/src/lib/auth.ts
// 認証関連の API クライアント。すべて Cookie 認証 (credentials: include) で動作する。

interface ApiOk<T> {
  ok: true;
  data: T;
}
interface ApiErr {
  ok: false;
  error: string;
}
type Api<T> = ApiOk<T> | ApiErr;

export interface AuthState {
  authenticated: boolean;
  initialized: boolean;
}

async function postJson<T>(url: string, body: unknown): Promise<Api<T>> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Api<T>;
}

async function getJson<T>(url: string): Promise<Api<T>> {
  const res = await fetch(url, { credentials: 'include' });
  return (await res.json()) as Api<T>;
}

function unwrap<T>(res: Api<T>): T {
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export async function getAuthState(): Promise<AuthState> {
  const data = await getJson<AuthState>('/api/auth/me');
  return unwrap(data);
}

export async function setupPassword(password: string): Promise<void> {
  const data = await postJson<{ initialized: boolean }>('/api/auth/setup', { password });
  unwrap(data);
}

export async function login(password: string): Promise<void> {
  const data = await postJson<{ ok: boolean }>('/api/auth/login', { password });
  unwrap(data);
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
}

export async function changePassword(current: string, next: string): Promise<void> {
  const data = await postJson<{ ok: boolean }>('/api/auth/change', { current, next });
  unwrap(data);
}

export interface ApiTokenView {
  id: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export async function listTokens(): Promise<ApiTokenView[]> {
  const data = await getJson<{ tokens: ApiTokenView[] }>('/api/auth/tokens');
  return unwrap(data).tokens;
}

export async function createToken(name: string): Promise<{
  id: number;
  name: string;
  token: string;
}> {
  const data = await postJson<{ id: number; name: string; token: string }>(
    '/api/auth/tokens',
    { name },
  );
  return unwrap(data);
}

export async function deleteToken(id: number): Promise<void> {
  const res = await fetch(`/api/auth/tokens/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const json = (await res.json()) as Api<{ deleted: boolean }>;
  unwrap(json);
}
