import { Database } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BOT_CONFIG, type BotConfig } from '../config.ts';
import { Injectable } from '../core/di.ts';

export const MAX_FILTER_REQUIREMENTS = 10;

export interface GroupFilterRequirement {
  readonly id: number;
  readonly requirement: string;
}

export interface GroupFilterWarning {
  readonly count: number;
}

class DuplicateFilterRequirementError extends Error {
  constructor() {
    super('This filter requirement is already configured.');
  }
}

class FilterRequirementLimitError extends Error {
  constructor() {
    super(
      `A group can have at most ${MAX_FILTER_REQUIREMENTS} filter requirements.`,
    );
  }
}

@Injectable([BOT_CONFIG])
export class GroupModerationStore {
  private databasePromise: Promise<Database> | undefined;

  constructor(private readonly config: BotConfig) {}

  async isBadWordFilterEnabled(groupJid: string): Promise<boolean> {
    const database = await this.database();
    const row = database
      .query<{ readonly enabled: number }, [string]>(
        'SELECT enabled FROM group_bad_word_filters WHERE group_jid = ?',
      )
      .get(groupJid);
    return row?.enabled === 1;
  }

  async setBadWordFilterEnabled(
    groupJid: string,
    enabled: boolean,
  ): Promise<void> {
    const database = await this.database();
    database.run(
      `
                INSERT INTO group_bad_word_filters (group_jid, enabled, updated_at_ms)
                VALUES (?, ?, ?)
                ON CONFLICT(group_jid) DO UPDATE SET
                    enabled = excluded.enabled,
                    updated_at_ms = excluded.updated_at_ms
            `,
      [groupJid, enabled ? 1 : 0, Date.now()],
    );
  }

  async listFilterRequirements(
    groupJid: string,
  ): Promise<readonly GroupFilterRequirement[]> {
    const database = await this.database();
    return database
      .query<GroupFilterRequirement, [string]>(
        `
                    SELECT id, requirement
                    FROM group_filter_requirements
                    WHERE group_jid = ?
                    ORDER BY id
                `,
      )
      .all(groupJid);
  }

  async addFilterRequirement(
    groupJid: string,
    requirement: string,
  ): Promise<GroupFilterRequirement> {
    const database = await this.database();
    return database
      .transaction(
        (
          transactionGroupJid: string,
          transactionRequirement: string,
        ): GroupFilterRequirement => {
          const requirements = database
            .query<GroupFilterRequirement, [string]>(
              `
                                SELECT id, requirement
                                FROM group_filter_requirements
                                WHERE group_jid = ?
                                ORDER BY id
                            `,
            )
            .all(transactionGroupJid);
          if (
            requirements.some(
              (existing) =>
                existing.requirement.toLowerCase() ===
                transactionRequirement.toLowerCase(),
            )
          ) {
            throw new DuplicateFilterRequirementError();
          }
          if (requirements.length >= MAX_FILTER_REQUIREMENTS) {
            throw new FilterRequirementLimitError();
          }

          database.run(
            `
                            INSERT INTO group_filter_requirements (group_jid, requirement, created_at_ms)
                            VALUES (?, ?, ?)
                        `,
            [transactionGroupJid, transactionRequirement, Date.now()],
          );
          const row = database
            .query<GroupFilterRequirement, [string, string]>(
              `
                                SELECT id, requirement
                                FROM group_filter_requirements
                                WHERE group_jid = ? AND requirement = ?
                            `,
            )
            .get(transactionGroupJid, transactionRequirement);
          if (!row) {
            throw new Error('Could not store the filter requirement.');
          }
          return row;
        },
      )
      .immediate(groupJid, requirement);
  }

  async removeFilterRequirement(
    groupJid: string,
    requirementId: number,
  ): Promise<boolean> {
    const database = await this.database();
    const result = database.run(
      `
                DELETE FROM group_filter_requirements
                WHERE group_jid = ? AND id = ?
            `,
      [groupJid, requirementId],
    );
    return result.changes > 0;
  }

  async clearFilterRequirements(groupJid: string): Promise<number> {
    const database = await this.database();
    const result = database.run(
      'DELETE FROM group_filter_requirements WHERE group_jid = ?',
      [groupJid],
    );
    return result.changes;
  }

  async getWarningLimit(groupJid: string): Promise<number | undefined> {
    const database = await this.database();
    const row = database
      .query<{ readonly warning_limit: number }, [string]>(
        `
                    SELECT warning_limit
                    FROM group_filter_warning_limits
                    WHERE group_jid = ?
                `,
      )
      .get(groupJid);
    return row?.warning_limit;
  }

  async setWarningLimit(
    groupJid: string,
    warningLimit: number | undefined,
  ): Promise<void> {
    const database = await this.database();
    if (warningLimit === undefined) {
      database.run(
        'DELETE FROM group_filter_warning_limits WHERE group_jid = ?',
        [groupJid],
      );
      return;
    }
    database.run(
      `
                INSERT INTO group_filter_warning_limits (group_jid, warning_limit, updated_at_ms)
                VALUES (?, ?, ?)
                ON CONFLICT(group_jid) DO UPDATE SET
                    warning_limit = excluded.warning_limit,
                    updated_at_ms = excluded.updated_at_ms
            `,
      [groupJid, warningLimit, Date.now()],
    );
  }

  async incrementWarning(
    groupJid: string,
    participantJid: string,
  ): Promise<GroupFilterWarning> {
    const database = await this.database();
    database.run(
      `
                INSERT INTO group_filter_warnings (group_jid, participant_jid, warning_count, updated_at_ms)
                VALUES (?, ?, 1, ?)
                ON CONFLICT(group_jid, participant_jid) DO UPDATE SET
                    warning_count = warning_count + 1,
                    updated_at_ms = excluded.updated_at_ms
            `,
      [groupJid, participantJid, Date.now()],
    );
    const row = database
      .query<GroupFilterWarning, [string, string]>(
        `
                    SELECT warning_count AS count
                    FROM group_filter_warnings
                    WHERE group_jid = ? AND participant_jid = ?
                `,
      )
      .get(groupJid, participantJid);
    if (!row) throw new Error('Could not record the filter warning.');
    return row;
  }

  async clearWarnings(groupJid: string, participantJid: string): Promise<void> {
    const database = await this.database();
    database.run(
      `
                DELETE FROM group_filter_warnings
                WHERE group_jid = ? AND participant_jid = ?
            `,
      [groupJid, participantJid],
    );
  }

  private async database(): Promise<Database> {
    this.databasePromise ??= this.openDatabase();
    return this.databasePromise;
  }

  private async openDatabase(): Promise<Database> {
    await mkdir(dirname(this.config.moderationDbPath), { recursive: true });
    const database = new Database(this.config.moderationDbPath);
    database.run(`
            CREATE TABLE IF NOT EXISTS group_bad_word_filters (
                group_jid TEXT PRIMARY KEY NOT NULL,
                enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
                updated_at_ms INTEGER NOT NULL
            )
        `);
    database.run(`
            CREATE TABLE IF NOT EXISTS group_filter_requirements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_jid TEXT NOT NULL,
                requirement TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                UNIQUE (group_jid, requirement)
            )
        `);
    database.run(`
            CREATE TABLE IF NOT EXISTS group_filter_warning_limits (
                group_jid TEXT PRIMARY KEY NOT NULL,
                warning_limit INTEGER NOT NULL CHECK (warning_limit > 0),
                updated_at_ms INTEGER NOT NULL
            )
        `);
    database.run(`
            CREATE TABLE IF NOT EXISTS group_filter_warnings (
                group_jid TEXT NOT NULL,
                participant_jid TEXT NOT NULL,
                warning_count INTEGER NOT NULL CHECK (warning_count > 0),
                updated_at_ms INTEGER NOT NULL,
                PRIMARY KEY (group_jid, participant_jid)
            )
        `);
    return database;
  }
}
