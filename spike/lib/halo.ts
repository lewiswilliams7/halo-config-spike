import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HaloIO, Row, TemplateStore } from './runtime.js';

/** Folder that holds spike/, so paths work wherever you run the scripts from. */
export const SPIKE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_LABEL = 'my-own-trial';

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    console.error(`\nMissing ${key} in .env. Copy .env.example to .env and fill it in.\n`);
    process.exit(1);
  }
  return value;
}

const trimSlash = (url: string) => url.replace(/\/+$/, '');

export const env = {
  apiUrl: trimSlash(requiredEnv('HALO_API_URL')),
  authUrl: trimSlash(requiredEnv('HALO_AUTH_URL')),
  tenant: process.env.HALO_TENANT?.trim() ?? '',
  clientId: requiredEnv('HALO_CLIENT_ID'),
  clientSecret: requiredEnv('HALO_CLIENT_SECRET'),
  scope: process.env.HALO_SCOPE?.trim() || 'all',
  allowWrites: process.env.HALO_ALLOW_WRITES === 'true',
  instanceLabel: process.env.HALO_INSTANCE_LABEL?.trim() ?? '',
};

/** Which Halo this is. Templates are stored per instance so one customer's never touch another's. */
export const INSTANCE_KEY = new URL(env.apiUrl).hostname;

/** Relative path (under spike/) of a template for THIS instance. */
export function templateRel(file: string): string {
  return `fixtures/templates/${INSTANCE_KEY}/${file}`;
}

// ---------- auth ----------

let cached: { token: string; expiresAt: number; raw: Record<string, unknown> } | null = null;

export async function getToken(): Promise<{ token: string; raw: Record<string, unknown> }> {
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached;

  const query = env.tenant ? `?tenant=${encodeURIComponent(env.tenant)}` : '';
  const res = await fetch(`${env.authUrl}/token${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.clientId,
      client_secret: env.clientSecret,
      scope: env.scope,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Auth failed (${res.status}). Check HALO_AUTH_URL, client ID and secret.\n${text}`);
  }

  const raw = JSON.parse(text) as Record<string, unknown>;
  const expiresIn = typeof raw.expires_in === 'number' ? raw.expires_in : 3600;
  cached = { token: String(raw.access_token), expiresAt: Date.now() + expiresIn * 1000, raw };
  return cached;
}

// ---------- requests ----------

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, params?: Record<string, string>): Promise<T> {
  const { token } = await getToken();
  const url = new URL(`${env.apiUrl}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${url.pathname} failed (${res.status})\n${text.slice(0, 2000)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

/** Reads retry on 429/502/503/504 with back-off (rule R1); writes never retry. */
export async function haloGet<T = unknown>(path: string, params?: Record<string, string>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await request<T>('GET', path, undefined, params);
    } catch (e) {
      const status = Number(String((e as Error).message).match(/failed \((\d+)\)/)?.[1]);
      if (![429, 502, 503, 504].includes(status) || attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

/** Every write goes through here. Refuses unless both safety switches in .env are set. */
export function haloPost<T = unknown>(path: string, body: unknown, params?: Record<string, string>): Promise<T> {
  assertWritesAllowed();
  return request<T>('POST', path, body, params);
}

export function assertWritesAllowed(): void {
  if (!env.allowWrites || env.instanceLabel !== REQUIRED_LABEL) {
    throw new Error(
      `Writes are switched off. Only on your OWN trial instance, set in .env:\n` +
        `  HALO_ALLOW_WRITES=true\n  HALO_INSTANCE_LABEL=${REQUIRED_LABEL}`,
    );
  }
}

// ---------- helpers ----------

/** Halo list endpoints return either an array or an object wrapping one. Find the array. */
export function extractList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    for (const value of Object.values(data)) {
      if (Array.isArray(value)) return value as Record<string, unknown>[];
    }
  }
  return [];
}

/** POST responses can be the object or an array of objects. Return the first. */
export function firstRecord(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return (data[0] as Record<string, unknown>) ?? null;
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  return null;
}

export function spikePath(...parts: string[]): string {
  return join(SPIKE_DIR, ...parts);
}

export function saveJson(relPath: string, data: unknown): string {
  const full = spikePath(relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify(data, null, 2));
  return full;
}

export function loadJson<T = unknown>(relPath: string): T {
  const full = existsSync(relPath) ? relPath : spikePath(relPath);
  if (!existsSync(full)) throw new Error(`File not found: ${relPath}`);
  return JSON.parse(readFileSync(full, 'utf8')) as T;
}

export function fileExists(relPath: string): boolean {
  return existsSync(spikePath(relPath));
}

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// ---------- the spike's build runtime (lib/runtime.ts) ----------

/** The .env instance, for builds. Writes still go through haloPost and its safety switches. */
export const envHalo: HaloIO = { get: haloGet, post: haloPost };

/** Templates cached as files per instance (fixtures/templates/<host>/). */
export const fileTemplates: TemplateStore = {
  has: (f) => fileExists(templateRel(f)),
  get: (f) => (fileExists(templateRel(f)) ? loadJson<Row>(templateRel(f)) : undefined),
  set: (f, r) => void saveJson(templateRel(f), r),
};
