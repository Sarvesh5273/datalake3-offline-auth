import NetInfo, {NetInfoState} from '@react-native-community/netinfo';
import SQLite, {ResultSet, SQLiteDatabase} from 'react-native-sqlite-storage';

SQLite.enablePromise(true);

export type VerificationLog = {
  id: string;
  workerId: string;
  timestamp: number;
  syncStatus: 'pending';
};

export type SyncEngineConfig = {
  endpoint: string;
  databaseName?: string;
  onError?: (error: Error) => void;
};

const TABLE_NAME = 'verification_logs';
const DEFAULT_DB_NAME = 'datalake.db';

export default class SyncEngine {
  private readonly endpoint: string;
  private readonly dbPromise: Promise<SQLiteDatabase>;
  private readonly onError: (error: Error) => void;
  private unsubscribe?: () => void;
  private syncInFlight = false;

  constructor(config: SyncEngineConfig) {
    this.endpoint = config.endpoint;
    this.onError = config.onError ?? (error => console.error('SyncEngine:', error));
    this.dbPromise = this.openDatabase(config.databaseName ?? DEFAULT_DB_NAME);
  }

  start(): void {
    if (this.unsubscribe) {
      return;
    }
    this.unsubscribe = NetInfo.addEventListener(state => {
      if (this.isOnline(state)) {
        this.syncPending().catch(this.onError);
      }
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  async logVerification(workerId: string, timestamp = Date.now()): Promise<string> {
    const id = generateId();
    const db = await this.dbPromise;
    await db.executeSql(
      `INSERT INTO ${TABLE_NAME} (id, workerId, timestamp, syncStatus) VALUES (?, ?, ?, ?)`,
      [id, workerId, timestamp, 'pending'],
    );
    return id;
  }

  async syncPending(): Promise<void> {
    if (this.syncInFlight) {
      return;
    }
    this.syncInFlight = true;
    try {
      const db = await this.dbPromise;
      const [result] = await db.executeSql(
        `SELECT id, workerId, timestamp, syncStatus FROM ${TABLE_NAME} WHERE syncStatus = ?`,
        ['pending'],
      );
      const logs = rowsToLogs(result);
      if (logs.length === 0) {
        return;
      }

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({logs}),
      });

      if (response.status !== 200) {
        throw new Error(`Sync failed with status ${response.status}`);
      }

      const ids = logs.map(log => log.id);
      await deleteLogs(db, ids);
    } finally {
      this.syncInFlight = false;
    }
  }

  private async openDatabase(name: string): Promise<SQLiteDatabase> {
    const db = await SQLite.openDatabase({name, location: 'default'});
    await db.executeSql(
      `CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id TEXT PRIMARY KEY,
        workerId TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        syncStatus TEXT NOT NULL
      )`,
    );
    return db;
  }

  private isOnline(state: NetInfoState): boolean {
    return Boolean(state.isConnected && state.isInternetReachable !== false);
  }
}

function rowsToLogs(result: ResultSet): VerificationLog[] {
  const logs: VerificationLog[] = [];
  for (let i = 0; i < result.rows.length; i += 1) {
    logs.push(result.rows.item(i) as VerificationLog);
  }
  return logs;
}

async function deleteLogs(db: SQLiteDatabase, ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const placeholders = ids.map(() => '?').join(', ');
  await db.executeSql(`DELETE FROM ${TABLE_NAME} WHERE id IN (${placeholders})`, ids);
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
