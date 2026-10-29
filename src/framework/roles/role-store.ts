import { Database } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BOT_CONFIG, type BotConfig } from '../config.ts';
import { Injectable } from '../core/di.ts';
import { normalizeUserJid } from '../core/jid.ts';

interface ModeratorRow {
  readonly jid: string;
}

@Injectable([BOT_CONFIG])
export class RoleStore {
  private databasePromise: Promise<Database> | undefined;

  constructor(private readonly config: BotConfig) {}

  async isModerator(jid: string): Promise<boolean> {
    const normalizedJid = normalizeUserJid(jid);
    if (!normalizedJid) return false;

    const database = await this.database();
    return (
      database
        .query<ModeratorRow, [string]>(
          'SELECT jid FROM bot_moderators WHERE jid = ?',
        )
        .get(normalizedJid) !== null
    );
  }

  async addModerator(jid: string): Promise<boolean> {
    const normalizedJid = requiredUserJid(jid);
    const database = await this.database();
    const result = database.run(
      'INSERT OR IGNORE INTO bot_moderators (jid, added_at_ms) VALUES (?, ?)',
      [normalizedJid, Date.now()],
    );
    return result.changes > 0;
  }

  async removeModerator(jid: string): Promise<boolean> {
    const normalizedJid = requiredUserJid(jid);
    const database = await this.database();
    const result = database.run('DELETE FROM bot_moderators WHERE jid = ?', [
      normalizedJid,
    ]);
    return result.changes > 0;
  }

  async listModerators(): Promise<readonly string[]> {
    const database = await this.database();
    return database
      .query<ModeratorRow, []>(
        'SELECT jid FROM bot_moderators ORDER BY jid ASC',
      )
      .all()
      .map((row) => row.jid);
  }

  private database(): Promise<Database> {
    this.databasePromise ??= this.openDatabase();
    return this.databasePromise;
  }

  private async openDatabase(): Promise<Database> {
    await mkdir(dirname(this.config.roleDbPath), { recursive: true });
    const database = new Database(this.config.roleDbPath);
    database.run(`
            CREATE TABLE IF NOT EXISTS bot_moderators (
                jid TEXT PRIMARY KEY,
                added_at_ms INTEGER NOT NULL
            )
        `);
    return database;
  }
}

function requiredUserJid(jid: string): string {
  const normalizedJid = normalizeUserJid(jid);
  if (!normalizedJid) {
    throw new Error('A WhatsApp phone number or user JID is required.');
  }
  return normalizedJid;
}
