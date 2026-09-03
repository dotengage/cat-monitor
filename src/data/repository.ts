/**
 * Persistence boundary.
 *
 * The UI never touches storage directly. Everything goes through this
 * interface, so a future cloud-sync implementation is a new class here rather
 * than a rewrite of the app.
 */
import { STATE_VERSION } from '../config/catConfig';
import { nowISO } from '../domain/ids';
import type { AppState } from '../domain/types';
import { kv } from './db';
import { createInitialState } from './defaultState';
import { migrate } from './migrate';

const STATE_KEY = 'state';
const BACKUP_INDEX_KEY = 'backups';
const MAX_BACKUPS = 7;

export interface BackupMeta {
  id: string;
  createdAt: string;
  label: string;
  sizeBytes: number;
}

export interface StateRepository {
  load(): Promise<AppState>;
  save(state: AppState): Promise<void>;
  clear(): Promise<void>;
  export(): Promise<string>;
  import(json: string): Promise<AppState>;
  listBackups(): Promise<BackupMeta[]>;
  createBackup(state: AppState, label?: string): Promise<BackupMeta>;
  restoreBackup(id: string): Promise<AppState | null>;
}

export class LocalStateRepository implements StateRepository {
  async load(): Promise<AppState> {
    const raw = await kv.get<AppState>(STATE_KEY);
    if (!raw) return createInitialState();
    return migrate(raw);
  }

  async save(state: AppState): Promise<void> {
    await kv.set(STATE_KEY, { ...state, version: STATE_VERSION });
  }

  async clear(): Promise<void> {
    await kv.delete(STATE_KEY);
  }

  async export(): Promise<string> {
    const state = await this.load();
    return JSON.stringify({ app: 'cat-monitor', exportedAt: nowISO(), state }, null, 2);
  }

  async import(json: string): Promise<AppState> {
    const parsed = JSON.parse(json) as { state?: AppState } & Partial<AppState>;
    const candidate = (parsed.state ?? parsed) as AppState;
    if (!candidate || typeof candidate !== 'object' || !('profile' in candidate) || !('tasks' in candidate)) {
      throw new Error('This file does not look like a CAT Monitor backup.');
    }
    const state = migrate(candidate);
    // Never overwrite silently: snapshot what is there before replacing it.
    const existing = await kv.get<AppState>(STATE_KEY);
    if (existing) await this.createBackup(existing, 'Before import');
    await this.save(state);
    return state;
  }

  async listBackups(): Promise<BackupMeta[]> {
    return (await kv.get<BackupMeta[]>(BACKUP_INDEX_KEY)) ?? [];
  }

  async createBackup(state: AppState, label = 'Automatic'): Promise<BackupMeta> {
    const payload = JSON.stringify(state);
    const meta: BackupMeta = {
      id: `backup-${Date.now()}`,
      createdAt: nowISO(),
      label,
      sizeBytes: payload.length,
    };
    await kv.set(meta.id, state);
    const index = [meta, ...(await this.listBackups())].slice(0, MAX_BACKUPS);
    const dropped = (await this.listBackups()).filter((b) => !index.some((i) => i.id === b.id));
    for (const d of dropped) await kv.delete(d.id);
    await kv.set(BACKUP_INDEX_KEY, index);
    return meta;
  }

  async restoreBackup(id: string): Promise<AppState | null> {
    const state = await kv.get<AppState>(id);
    if (!state) return null;
    const migrated = migrate(state);
    await this.save(migrated);
    return migrated;
  }
}

export const repository: StateRepository = new LocalStateRepository();
