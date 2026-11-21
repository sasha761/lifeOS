import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createDatabase, databaseErrorMessage, readTestDatabaseUrl, schema } from "../../src/index.ts";
import { applyMigrations } from "../../src/migrations.ts";
import type { DatabaseClient } from "../../src/index.ts";
import { createGoalInputSchema } from "@lifeos/contracts";
import { actorFromVerifiedSession, createGoalsService } from "@lifeos/domain";
import { createGoalsUnitOfWork } from "../../src/goals-unit-of-work.ts";

// Every table the application migrations own; cleanup drops only these in schemas created by this run.
const ownedTables = ["starter_pack_receipts", "goal_deletion_receipts", "goal_measurements", "goal_command_receipts", "activity_events", "goals", "session", "account", "verification", "user", "foundation_migration_fixture", "__drizzle_migrations"];
const migrationsFolder = fileURLToPath(new URL("../../drizzle/", import.meta.url));
const run = randomUUID().replaceAll("-", "");
const cleanSchema = `lfs104_migration_${run}`;
const upgradeSchema = `lfs201_upgrade_${run}`;
const preferencesSchema = `lfs202_upgrade_${run}`;
const goalsSchema = `lfs205_upgrade_${run}`;
const auditSchema = `lfs210_upgrade_${run}`;
const measurementsSchema = `lfs206_upgrade_${run}`;
const examplesSchema = `lfs216_upgrade_${run}`;
const isolatedSchemas = [cleanSchema, upgradeSchema, preferencesSchema, goalsSchema, auditSchema, measurementsSchema, examplesSchema];
for (const name of isolatedSchemas) {
  if (!/^lfs(?:104_migration|201_upgrade|202_upgrade|205_upgrade|210_upgrade|206_upgrade|216_upgrade)_[a-f0-9]{32}$/.test(name)) throw new Error("Invalid isolated test schema name.");
}
const quote = (name: string) => `"${name}"`;
/** A goal row as an older history stored it: everything but the origin added by LFS-218. */
const withoutOrigin = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "origin"));
let administration: DatabaseClient | undefined;
const clients = new Map<string, DatabaseClient>();
const createdSchemas: string[] = [];
// Copies of the migration history as it was at the end of Stage 1 and of LFS-201 (journal prefixes).
const historyFolders = new Map<string, string>();
let migrationCount = 0;

async function databaseOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(databaseErrorMessage(error));
  }
}

function isolatedClient(name: string): DatabaseClient {
  const client = clients.get(name);
  if (!client) throw new Error("The isolated database client was not initialized.");
  return client;
}

beforeAll(async () => {
  await databaseOperation(async () => {
    const connectionString = readTestDatabaseUrl(process.env);
    administration = createDatabase({ connectionString });
    for (const name of isolatedSchemas) {
      // No IF NOT EXISTS: a pre-existing namespace is never claimed or cleaned up.
      await administration.pool.query(`CREATE SCHEMA ${quote(name)}`);
      createdSchemas.push(name);
      const isolated = new URL(connectionString);
      isolated.searchParams.set("options", `-csearch_path=${name}`);
      clients.set(name, createDatabase({ connectionString: isolated.toString() }));
    }
  });
  const journal = JSON.parse(await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
  migrationCount = journal.entries.length;
  const tags = journal.entries.map((entry) => entry.tag);
  if (tags[0] !== "0000_smiling_reavers" || tags[1] !== "0001_better_auth" || tags[2] !== "0002_user_preferences") {
    throw new Error("Unexpected migration history.");
  }
  for (const [name, count] of [["stage1", 1], ["lfs201", 2], ["lfs202", 3], ["lfs205", 4], ["lfs210", 5], ["lfs216", 7]] as const) {
    const folder = await mkdtemp(join(tmpdir(), `lfs202-${name}-`));
    historyFolders.set(name, folder);
    const entries = journal.entries.slice(0, count);
    await mkdir(join(folder, "meta"));
    await writeFile(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) await copyFile(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
});

function historyFolder(name: "stage1" | "lfs201" | "lfs202" | "lfs205" | "lfs210" | "lfs216"): string {
  const folder = historyFolders.get(name);
  if (!folder) throw new Error("Migration history was not prepared.");
  return folder;
}

afterAll(async () => {
  for (const folder of historyFolders.values()) await rm(folder, { recursive: true, force: true });
  await databaseOperation(async () => {
    for (const client of clients.values()) await client.close();
    try {
      for (const name of createdSchemas) {
        // Only this run's known tables. RESTRICT preserves unexpected dependencies.
        await administration?.pool.query(`DROP TABLE IF EXISTS ${ownedTables.map((table) => `${quote(name)}.${quote(table)}`).join(", ")}`);
        await administration?.pool.query(`DROP SCHEMA ${quote(name)}`);
      }
    } finally {
      await administration?.close();
    }
  });
});

it("applies migrations in a clean isolated schema and safely re-applies them", async () => {
  const connection = isolatedClient(cleanSchema);
  const identifier = quote(cleanSchema);
  const result = await databaseOperation(async () => {
    const before = await connection.pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = $1", [cleanSchema],
    );
    await applyMigrations(connection.db, { migrationsSchema: cleanSchema });
    await connection.db.insert(schema.foundationMigrationFixture).values({ label: "lfs104-migration-smoke" });
    const first = await connection.pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${identifier}.__drizzle_migrations`);
    await applyMigrations(connection.db, { migrationsSchema: cleanSchema });
    const second = await connection.pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${identifier}.__drizzle_migrations`);
    const tables = await connection.pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name", [cleanSchema],
    );
    const rows = await connection.db.select().from(schema.foundationMigrationFixture);
    return { before: before.rows[0]?.count, first: first.rows[0]?.count, second: second.rows[0]?.count, tables: tables.rows, rows };
  });

  expect(result.before).toBe(0);
  expect(migrationCount).toBeGreaterThanOrEqual(4);
  expect(result.first).toBe(migrationCount);
  expect(result.second).toBe(migrationCount);
  expect(result.tables.map((table) => table.table_name)).toEqual([
    "__drizzle_migrations", "account", "activity_events", "foundation_migration_fixture", "goal_command_receipts", "goal_deletion_receipts", "goal_measurements", "goals", "session", "starter_pack_receipts", "user", "verification",
  ]);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]?.label).toBe("lfs104-migration-smoke");
});

it("creates the Better Auth columns, unique constraints and cascading foreign keys inside the isolated schema", async () => {
  const connection = isolatedClient(cleanSchema);
  const result = await databaseOperation(async () => {
    const columns = await connection.pool.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
      `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = $1 AND table_name IN ('user', 'session', 'account', 'verification') ORDER BY table_name, ordinal_position`, [cleanSchema],
    );
    const foreignKeys = await connection.pool.query<{ source: string; target: string }>(
      `SELECT conrelid::regclass::text AS source, confrelid::regclass::text AS target FROM pg_constraint
       WHERE contype = 'f' AND connamespace = $1::regnamespace AND conrelid IN ('account'::regclass, 'session'::regclass, 'goals'::regclass) ORDER BY 1`, [cleanSchema],
    );
    const userId = `user_${randomUUID()}`;
    const now = new Date();
    await connection.db.insert(schema.user).values({ id: userId, name: "Fixture", email: `${userId}@example.test`, createdAt: now, updatedAt: now });
    await connection.db.insert(schema.session).values({ id: `session_${randomUUID()}`, token: randomUUID(), userId, expiresAt: now, createdAt: now, updatedAt: now });
    const duplicateEmail = await connection.db.insert(schema.user)
      .values({ id: `user_${randomUUID()}`, name: "Duplicate", email: `${userId}@example.test`, createdAt: now, updatedAt: now })
      .then(() => "inserted", (error: unknown) => (error as { cause?: { code?: string } }).cause?.code ?? "failed");
    const orphan = await connection.db.insert(schema.session)
      .values({ id: `session_${randomUUID()}`, token: randomUUID(), userId: "missing-user", expiresAt: now, createdAt: now, updatedAt: now })
      .then(() => "inserted", (error: unknown) => (error as { cause?: { code?: string } }).cause?.code ?? "failed");
    await connection.pool.query(`DELETE FROM "user" WHERE id = $1`, [userId]);
    const sessions = await connection.pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM session WHERE user_id = $1`, [userId]);
    return { columns: columns.rows, foreignKeys: foreignKeys.rows, duplicateEmail, orphan, remainingSessions: sessions.rows[0]?.count };
  });

  const column = (table: string, name: string) => result.columns.find((entry) => entry.table_name === table && entry.column_name === name);
  expect(column("user", "email")).toMatchObject({ data_type: "text", is_nullable: "NO" });
  expect(column("user", "email_verified")).toMatchObject({ data_type: "boolean", is_nullable: "NO" });
  expect(column("session", "expires_at")).toMatchObject({ data_type: "timestamp without time zone", is_nullable: "NO" });
  expect(column("account", "password")).toMatchObject({ data_type: "text", is_nullable: "YES" });
  expect(column("verification", "identifier")).toMatchObject({ data_type: "text", is_nullable: "NO" });
  // Unqualified FK targets resolve to this schema, never to another schema's "user" table.
  expect(result.foreignKeys).toEqual([{ source: "account", target: "\"user\"" }, { source: "goals", target: "\"user\"" }, { source: "session", target: "\"user\"" }]);
  expect(result.duplicateEmail).toBe("23505");
  expect(result.orphan).toBe("23503");
  expect(result.remainingSessions).toBe(0);
});

it("upgrades a Stage 1 database without touching its existing data", async () => {
  const connection = isolatedClient(upgradeSchema);
  const identifier = quote(upgradeSchema);
  const folder = historyFolder("stage1");
  const result = await databaseOperation(async () => {
    await migrate(connection.db, { migrationsFolder: folder, migrationsSchema: upgradeSchema });
    await connection.db.insert(schema.foundationMigrationFixture).values({ label: "stage-1-data" });
    const stageOneTables = await connection.pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name", [upgradeSchema],
    );
    await applyMigrations(connection.db, { migrationsSchema: upgradeSchema });
    const journal = await connection.pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${identifier}.__drizzle_migrations`);
    const rows = await connection.db.select().from(schema.foundationMigrationFixture);
    const users = await connection.pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM "user"`);
    return { stageOneTables: stageOneTables.rows.map((table) => table.table_name), journal: journal.rows[0]?.count, rows, users: users.rows[0]?.count };
  });

  expect(result.stageOneTables).toEqual(["__drizzle_migrations", "foundation_migration_fixture"]);
  expect(result.journal).toBe(migrationCount);
  expect(result.rows.map((row) => row.label)).toEqual(["stage-1-data"]);
  expect(result.users).toBe(0);
});

it("adds user preferences with safe defaults and coarse CHECK constraints (LFS-202)", async () => {
  const connection = isolatedClient(cleanSchema);
  const result = await databaseOperation(async () => {
    const columns = await connection.pool.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'user' AND column_name IN ('timezone', 'locale') ORDER BY column_name`, [cleanSchema],
    );
    const userId = `user_${randomUUID()}`;
    // Inserted the way Better Auth does it: without the preference columns.
    await connection.pool.query(`INSERT INTO "user" (id, name, email, updated_at) VALUES ($1, 'Fixture', $2, now())`, [userId, `${userId}@example.test`]);
    const stored = await connection.pool.query<{ timezone: string; locale: string }>(`SELECT timezone, locale FROM "user" WHERE id = $1`, [userId]);
    const violation = async (statement: string) => connection.pool.query(statement, [userId])
      .then(() => "updated", (error: unknown) => (error as { code?: string }).code ?? "failed");
    const emptyTimezone = await violation(`UPDATE "user" SET timezone = '' WHERE id = $1`);
    const longLocale = await violation(`UPDATE "user" SET locale = repeat('a', 36) WHERE id = $1`);
    const nullLocale = await violation(`UPDATE "user" SET locale = NULL WHERE id = $1`);
    return { columns: columns.rows, stored: stored.rows[0], emptyTimezone, longLocale, nullLocale };
  });

  expect(result.columns).toEqual([
    { column_name: "locale", data_type: "text", is_nullable: "NO", column_default: "'ru'::text" },
    { column_name: "timezone", data_type: "text", is_nullable: "NO", column_default: "'UTC'::text" },
  ]);
  expect(result.stored).toEqual({ timezone: "UTC", locale: "ru" });
  expect(result.emptyTimezone).toBe("23514");
  expect(result.longLocale).toBe("23514");
  expect(result.nullLocale).toBe("23502");
});

it("upgrades an LFS-201 database: existing accounts keep their data and get default preferences", async () => {
  const connection = isolatedClient(preferencesSchema);
  const identifier = quote(preferencesSchema);
  const userId = `user_${randomUUID()}`;
  const result = await databaseOperation(async () => {
    await migrate(connection.db, { migrationsFolder: historyFolder("lfs201"), migrationsSchema: preferencesSchema });
    const before = await connection.pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'user' ORDER BY ordinal_position`, [preferencesSchema],
    );
    // Rows as LFS-201 Better Auth wrote them, before the preference columns existed.
    await connection.pool.query(`INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES ($1, 'Existing', $2, '2026-11-14 10:00:00', '2026-11-14 10:00:00')`, [userId, `${userId}@example.test`]);
    await connection.pool.query(`INSERT INTO session (id, token, user_id, expires_at, updated_at) VALUES ($1, $2, $3, '2026-11-21 10:00:00', now())`, [`session_${randomUUID()}`, `token_${userId}`, userId]);
    await connection.pool.query(`INSERT INTO account (id, account_id, provider_id, user_id, password, updated_at) VALUES ($1, $2, 'credential', $2, 'salt:hash', now())`, [`account_${randomUUID()}`, userId]);
    await applyMigrations(connection.db, { migrationsSchema: preferencesSchema });
    await applyMigrations(connection.db, { migrationsSchema: preferencesSchema });
    const journal = await connection.pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${identifier}.__drizzle_migrations`);
    const users = await connection.pool.query<Record<string, unknown>>(
      `SELECT id, name, email, to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at, timezone, locale FROM "user"`,
    );
    const sessions = await connection.pool.query<{ token: string }>(`SELECT token FROM session WHERE user_id = $1`, [userId]);
    const accounts = await connection.pool.query<{ password: string }>(`SELECT password FROM account WHERE user_id = $1`, [userId]);
    return { before: before.rows.map((row) => row.column_name), journal: journal.rows[0]?.count, users: users.rows, sessions: sessions.rows, accounts: accounts.rows };
  });

  expect(result.before).not.toContain("timezone");
  expect(result.before).not.toContain("locale");
  expect(result.journal).toBe(migrationCount);
  expect(result.users).toEqual([{ id: userId, name: "Existing", email: `${userId}@example.test`, created_at: "2026-11-14 10:00:00", timezone: "UTC", locale: "ru" }]);
  expect(result.sessions).toEqual([{ token: `token_${userId}` }]);
  expect(result.accounts).toEqual([{ password: "salt:hash" }]);
});

it("upgrades LFS-202 with goals while preserving users, preferences and sessions", async () => {
  const connection = isolatedClient(goalsSchema);
  const userId = `existing_${randomUUID()}`;
  const result = await databaseOperation(async () => {
    await migrate(connection.db, { migrationsFolder: historyFolder("lfs202"), migrationsSchema: goalsSchema });
    await connection.pool.query(`INSERT INTO "user" (id, name, email, timezone, locale) VALUES ($1, 'Existing', $2, 'Europe/Oslo', 'nb-NO')`, [userId, `${userId}@example.test`]);
    await connection.pool.query(`INSERT INTO session (id, token, user_id, expires_at, updated_at) VALUES ($1, $2, $3, '2026-11-22 10:00:00', now())`, [randomUUID(), `token_${userId}`, userId]);
    await applyMigrations(connection.db, { migrationsSchema: goalsSchema });
    const [goal] = await connection.db.insert(schema.goals).values({
      userId, domainKey: "finance", title: "Exact savings", unit: "NOK", baseline: "9007199254740993.01", target: "9007199254740993.02", direction: "increase",
    }).returning();
    await applyMigrations(connection.db, { migrationsSchema: goalsSchema });
    const preferences = (await connection.pool.query(`SELECT timezone, locale FROM "user" WHERE id = $1`, [userId])).rows[0];
    const sessions = (await connection.pool.query<{ count: number }>("SELECT count(*)::int AS count FROM session WHERE user_id = $1", [userId])).rows[0]?.count;
    const journal = (await connection.pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${quote(goalsSchema)}.__drizzle_migrations`)).rows[0]?.count;
    const indexes = await connection.pool.query<{ indexname: string; indexdef: string }>("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'goals'", [goalsSchema]);
    return { goal, preferences, sessions, journal, indexes: indexes.rows };
  });
  expect(result.goal).toMatchObject({ userId, baseline: "9007199254740993.01", target: "9007199254740993.02", calculationMode: "manual", status: "active" });
  expect(result.preferences).toEqual({ timezone: "Europe/Oslo", locale: "nb-NO" });
  expect(result.sessions).toBe(1);
  expect(result.journal).toBe(migrationCount);
  expect(result.indexes.find((row) => row.indexname === "goals_user_domain_status_idx")?.indexdef).toContain("(user_id, domain_key, status)");
  expect(result.indexes.find((row) => row.indexname === "goals_user_status_due_idx")?.indexdef).toContain("(user_id, status, due_at, id)");
});

it("upgrades LFS-205 without rewriting goals or fabricating historical events", async () => {
  const connection = isolatedClient(auditSchema);
  const result = await databaseOperation(async () => {
    await migrate(connection.db, { migrationsFolder: historyFolder("lfs205"), migrationsSchema: auditSchema });
    const userId = `existing_${randomUUID()}`;
    await connection.db.insert(schema.user).values({ id: userId, name: "Existing", email: `${userId}@example.test` });
    // Raw SQL: the TS schema already has later goal columns (origin, LFS-218) that this history does not.
    const [before] = (await connection.pool.query(`INSERT INTO goals (user_id, domain_key, title, unit, baseline, target, direction)
      VALUES ($1, 'finance', 'Existing goal', 'NOK', '0', '50000', 'increase') RETURNING *`, [userId])).rows as Record<string, unknown>[];
    await applyMigrations(connection.db, { migrationsSchema: auditSchema });
    await applyMigrations(connection.db, { migrationsSchema: auditSchema });
    const after = (await connection.pool.query(`SELECT * FROM goals`)).rows as Record<string, unknown>[];
    const events = await connection.db.select().from(schema.activityEvents);
    const receipts = await connection.db.select().from(schema.goalCommandReceipts);
    const indexes = await connection.pool.query<{ indexname: string; indexdef: string }>("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'activity_events'", [auditSchema]);
    return { before, after, events, receipts, indexes: indexes.rows };
  });
  expect(result.after.map(withoutOrigin)).toEqual([result.before]);
  expect(result.after.map((row) => row.origin)).toEqual(["manual"]);
  expect(result.events).toEqual([]);
  expect(result.receipts).toEqual([]);
  expect(result.indexes.find((entry) => entry.indexname === "activity_events_user_key_unique")?.indexdef).toContain("(user_id, idempotency_key)");
  expect(result.indexes.find((entry) => entry.indexname === "activity_events_user_goal_time_idx")?.indexdef).toContain("(user_id, goal_id, occurred_at, id)");
});

it("upgrades LFS-210 preserving legacy goal receipts, hashes, events and no-data semantics", async () => {
  const connection = isolatedClient(measurementsSchema);
  const result = await databaseOperation(async () => {
    await migrate(connection.db, { migrationsFolder: historyFolder("lfs210"), migrationsSchema: measurementsSchema });
    const userId = `existing_${randomUUID()}`;
    const actor = actorFromVerifiedSession(userId);
    const input = createGoalInputSchema.parse({ domain_key: "finance", title: "Existing goal", unit: "NOK", baseline: "0", target: "50000", direction: "increase" });
    await connection.db.insert(schema.user).values({ id: userId, name: "Existing", email: `${userId}@example.test` });
    const [before] = (await connection.pool.query(`INSERT INTO goals (user_id, domain_key, title, unit, baseline, target, direction)
      VALUES ($1, 'finance', $2, 'NOK', '0', '50000', 'increase') RETURNING *`, [userId, input.title])).rows as ({ id: string } & Record<string, unknown>)[];
    if (!before) throw new Error("Legacy goal was not inserted.");
    // Exact canonical bytes from the LFS-210 create fingerprint, independent of the new shared helper.
    const bytes = '{"input":{"baseline":"0","calculation_mode":"manual","description":null,"direction":"increase","domain_key":"finance","due_at":null,"metric_key":null,"target":"50000","title":"Existing goal","unit":"NOK","unit_label":null},"operation":"create","source":"web","target":null}';
    const hash = createHash("sha256").update(bytes).digest("hex");
    const key = "legacy-create-key";
    await connection.pool.query(`INSERT INTO goal_command_receipts (user_id,idempotency_key,request_hash,operation,source,goal_id,domain_key) VALUES ($1,$2,$3,'create','web',$4,'finance')`, [userId, key, hash, before.id]);
    const snapshot = { status: "active", unit: "NOK", direction: "increase", baseline: "0", target: "50000", due_at: null };
    await connection.pool.query(`INSERT INTO activity_events (user_id,domain_key,goal_id,event_type,source,target_type,target_id,idempotency_key,payload) VALUES ($1,'finance',$2,'goal.created','web','goal',$2,$3,$4)`, [userId, before.id, key, { before: null, after: snapshot }]);
    const oldEvents = await connection.db.select().from(schema.activityEvents);
    const oldReceipt = (await connection.pool.query(`SELECT * FROM goal_command_receipts`)).rows[0] as Record<string, unknown>;
    await applyMigrations(connection.db, { migrationsSchema: measurementsSchema });
    await applyMigrations(connection.db, { migrationsSchema: measurementsSchema });
    const replay = await createGoalsService(createGoalsUnitOfWork(connection.db)).create(actor, input, { idempotencyKey: key, source: "web" });
    const receipts = await connection.pool.query(`SELECT * FROM goal_command_receipts`);
    const newReceipt = receipts.rows[0] as Record<string, unknown>;
    const { resource_type: resourceType, target_id: targetId, ...unchanged } = newReceipt;
    return { before, replay, goals: (await connection.pool.query(`SELECT * FROM goals`)).rows as Record<string, unknown>[], oldEvents, events: await connection.db.select().from(schema.activityEvents),
      oldReceipt, unchanged, resourceType, targetId, receipts: receipts.rowCount, measurements: await connection.db.select().from(schema.goalMeasurements) };
  });
  expect(result.goals.map(withoutOrigin)).toEqual([result.before]);
  expect(result.goals.map((row) => row.origin)).toEqual(["manual"]);
  expect(result.replay.id).toBe(result.before.id);
  expect(result.events).toEqual(result.oldEvents);
  expect(result.unchanged).toEqual(result.oldReceipt);
  expect(result.resourceType).toBe("goal");
  expect(result.targetId).toBeNull();
  expect(result.receipts).toBe(1);
  expect(result.measurements).toEqual([]);
});

it("upgrades LFS-216: existing goals become the person's own, values and facts keep their sources (LFS-218)", async () => {
  const connection = isolatedClient(examplesSchema);
  const result = await databaseOperation(async () => {
    await migrate(connection.db, { migrationsFolder: historyFolder("lfs216"), migrationsSchema: examplesSchema });
    const userId = `existing_${randomUUID()}`;
    await connection.db.insert(schema.user).values({ id: userId, name: "Existing", email: `${userId}@example.test` });
    const [goal] = (await connection.pool.query<{ id: string }>(`INSERT INTO goals (user_id, domain_key, title, unit, baseline, target, direction)
      VALUES ($1, 'finance', 'Existing goal', 'NOK', 0, 50000, 'increase') RETURNING id`, [userId])).rows;
    await connection.pool.query(`INSERT INTO goal_measurements (user_id, goal_id, unit, value, measured_at) VALUES ($1, $2, 'NOK', 1200, now() - interval '1 day')`, [userId, goal!.id]);
    await connection.pool.query(`INSERT INTO activity_events (user_id, domain_key, goal_id, event_type, source, target_type, target_id, payload)
      VALUES ($1, 'finance', $2, 'goal.created', 'web', 'goal', $2, $3)`, [userId, goal!.id, { before: null, after: { unit: "NOK", baseline: "0", target: "50000", direction: "increase", status: "active", due_at: null } }]);
    const oldEvents = (await connection.pool.query(`SELECT * FROM activity_events`)).rows;
    await applyMigrations(connection.db, { migrationsSchema: examplesSchema });
    await applyMigrations(connection.db, { migrationsSchema: examplesSchema });
    const goals = (await connection.pool.query(`SELECT origin FROM goals`)).rows;
    const measurements = (await connection.pool.query(`SELECT source FROM goal_measurements`)).rows;
    const events = (await connection.pool.query(`SELECT * FROM activity_events`)).rows;
    const rejected = async (statement: string, values: unknown[]) => {
      try { await connection.pool.query(statement, values); return false; } catch { return true; }
    };
    const [usd] = (await connection.pool.query<{ id: string }>(`INSERT INTO goals (user_id, domain_key, title, unit, baseline, target, direction, origin)
      VALUES ($1, 'finance', 'Dollars', 'USD', 0, 5000.25, 'increase', 'starter') RETURNING id`, [userId])).rows;
    await connection.pool.query(`INSERT INTO goal_measurements (user_id, goal_id, unit, value, measured_at, source) VALUES ($1, $2, 'USD', 1200.5, now(), 'example')`, [userId, usd!.id]);
    await connection.pool.query(`INSERT INTO activity_events (user_id, domain_key, goal_id, event_type, source, target_type, target_id, payload)
      VALUES ($1, 'finance', $2, 'goal.created', 'starter', 'goal', $2, $3)`, [userId, usd!.id, { before: null, after: { unit: "USD", baseline: "0", target: "5000.25", direction: "increase", status: "active", due_at: null } }]);
    return { goals, measurements, events, oldEvents, checks: {
      origin: await rejected(`UPDATE goals SET origin = 'import' WHERE id = $1`, [usd!.id]),
      usdScale: await rejected(`INSERT INTO goal_measurements (user_id, goal_id, unit, value, measured_at) VALUES ($1, $2, 'USD', 1.255, now())`, [userId, usd!.id]),
      measurementSource: await rejected(`UPDATE goal_measurements SET source = 'import' WHERE goal_id = $1`, [usd!.id]),
      eventSource: await rejected(`UPDATE activity_events SET source = 'robot' WHERE goal_id = $1`, [usd!.id]),
    }, receipts: (await connection.pool.query(`SELECT count(*)::int AS count FROM starter_pack_receipts`)).rows[0] };
  });
  expect(result.goals).toEqual([{ origin: "manual" }]);
  expect(result.measurements).toEqual([{ source: "manual" }]);
  expect(result.events).toEqual(result.oldEvents);
  expect(result.checks).toEqual({ origin: true, usdScale: true, measurementSource: true, eventSource: true });
  expect(result.receipts).toEqual({ count: 0 });
});
