/**
 * What a build runs against: a Halo connection and a template store, per run.
 * The spike CLI passes its .env connection and file templates; the Specflow app passes the connected
 * instance and in-memory templates. Kept in AsyncLocalStorage so two builds in one server never mix.
 * Shared file: keep identical to the app's lib/specflow/build/runtime.ts (only import lines differ).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type Row = Record<string, unknown>;

/** Every Halo call a build makes. There is deliberately no delete. */
export interface HaloIO {
  get<T = unknown>(path: string, params?: Record<string, string>): Promise<T>;
  post<T = unknown>(path: string, body: unknown): Promise<T>;
}

/** Templates are real records from the connected instance, keyed by file name (e.g. template-tickettype.json). */
export interface TemplateStore {
  has(file: string): boolean;
  get(file: string): Row | undefined;
  set(file: string, record: Row): void;
}

export function memoryTemplates(): TemplateStore {
  const m = new Map<string, Row>();
  return { has: (f) => m.has(f), get: (f) => (m.has(f) ? structuredClone(m.get(f)) : undefined), set: (f, r) => void m.set(f, structuredClone(r)) };
}

type Runtime = { halo: HaloIO; templates: TemplateStore; lists: Map<string, Row[]> };
const store = new AsyncLocalStorage<Runtime>();

export function withRuntime<T>(rt: { halo: HaloIO; templates: TemplateStore }, fn: () => Promise<T>): Promise<T> {
  return store.run({ ...rt, lists: new Map() }, fn);
}

export function runtime(): Runtime {
  const rt = store.getStore();
  if (!rt) throw new Error('No build runtime: call inside withRuntime().');
  return rt;
}

/** Halo list endpoints return either an array or an object wrapping one. Find the array. */
export function extractList(data: unknown): Row[] {
  if (Array.isArray(data)) return data as Row[];
  if (data && typeof data === 'object') for (const v of Object.values(data)) if (Array.isArray(v)) return v as Row[];
  return [];
}

/** POST responses can be the object or an array of objects. Return the first. */
export function firstRecord(data: unknown): Row | null {
  if (Array.isArray(data)) return (data[0] as Row) ?? null;
  if (data && typeof data === 'object') return data as Row;
  return null;
}
