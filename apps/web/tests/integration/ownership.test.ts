import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { currentUserResponseSchema, identifierSchema } from "@lifeos/contracts";
import { ownedBy } from "@lifeos/db";
import type { LifeosDatabase } from "@lifeos/db";
import { NotFoundError, requireOwned } from "@lifeos/domain";
import type { Actor } from "@lifeos/domain";
import { apiRoute, parseJsonBody } from "../../server/api-route.ts";
import { createCurrentUserRoute, requireApiActor } from "../../server/auth/session.ts";
import { createAuthHarness, databaseOperation, TEST_ORIGIN } from "./support/auth-harness.ts";
import type { AuthHarness, TestUser } from "./support/auth-harness.ts";
import { expectDomainOwnership, expectHttpOwnership } from "./support/ownership-contract.ts";

// Test-only owned resource. It exists solely in this suite's schema (not in application migrations)
// and shows the repository/service/route pattern that goals, measurements and events will follow.
const FIXTURE_TABLE = "ownership_fixture_note";
const note = pgTable(FIXTURE_TABLE, {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  body: text("body").notNull(),
});

function createNotes(database: LifeosDatabase) {
  return {
    async create(actor: Actor, body: string): Promise<string> {
      const [row] = await database.insert(note).values({ userId: actor.userId, body }).returning({ id: note.id });
      if (!row) throw new Error("The fixture note was not created.");
      return row.id;
    },
    async read(actor: Actor, id: string) {
      const [row] = await database.select().from(note).where(ownedBy(note.userId, actor, eq(note.id, id)));
      return requireOwned(actor, row);
    },
    async update(actor: Actor, id: string, body: string) {
      const [row] = await database.update(note).set({ body }).where(ownedBy(note.userId, actor, eq(note.id, id))).returning();
      return requireOwned(actor, row);
    },
    async remove(actor: Actor, id: string): Promise<void> {
      const [row] = await database.delete(note).where(ownedBy(note.userId, actor, eq(note.id, id))).returning();
      requireOwned(actor, row);
    },
  };
}

const noteDto = z.strictObject({ id: z.uuid(), body: z.string() });

/** The route shape of a future owned resource: actor from the session first, then id and body. */
function createNoteRoutes(harness: AuthHarness, notes: ReturnType<typeof createNotes>) {
  // Malformed ids are answered like unknown ones, so no response distinguishes the three cases.
  const idOf = (request: Request) => {
    const parsed = identifierSchema.safeParse(new URL(request.url).searchParams.get("id"));
    if (!parsed.success) throw new NotFoundError();
    return parsed.data;
  };
  return {
    GET: apiRoute(noteDto, async (request) => {
      const actor = await requireApiActor(harness.auth, request.headers);
      const { id, body } = await notes.read(actor, idOf(request));
      return { id, body };
    }),
    PATCH: apiRoute(noteDto, async (request) => {
      const actor = await requireApiActor(harness.auth, request.headers);
      const input = await parseJsonBody(request, z.strictObject({ body: z.string().min(1).max(200) }));
      const { id, body } = await notes.update(actor, idOf(request), input.body);
      return { id, body };
    }),
    DELETE: apiRoute(z.strictObject({ deleted: z.literal(true) }), async (request) => {
      const actor = await requireApiActor(harness.auth, request.headers);
      await notes.remove(actor, idOf(request));
      return { deleted: true as const };
    }),
  };
}

let harness: AuthHarness;
let notes: ReturnType<typeof createNotes>;
let routes: ReturnType<typeof createNoteRoutes>;
let owner: TestUser;
let other: TestUser;

const snapshotOf = (id: string) => databaseOperation(async () => (await harness.database.db.select().from(note).where(eq(note.id, id)))[0] ?? null);

function send(method: "GET" | "PATCH" | "DELETE", id: string, cookie?: string, body?: unknown): Promise<Response> {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (body !== undefined) headers.set("content-type", "application/json");
  return routes[method](new Request(`${TEST_ORIGIN}/api/v1/fixture-notes?id=${encodeURIComponent(id)}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  harness = await createAuthHarness({ suite: "lfs202_ownership", users: ["owner", "other"], fixtureTables: [FIXTURE_TABLE] });
  await databaseOperation(() => harness.database.pool.query(
    `CREATE TABLE ${FIXTURE_TABLE} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, body text NOT NULL)`,
  ));
  notes = createNotes(harness.database.db);
  routes = createNoteRoutes(harness, notes);
  owner = await harness.signUp("owner");
  other = await harness.signUp("other");
});

afterAll(async () => {
  vi.restoreAllMocks();
  await harness?.close();
});

describe("ownership pattern for owned resources", () => {
  it("lets only the owner reach a resource at the domain level; a foreign id behaves like an unknown one", async () => {
    let counter = 0;
    const id = await expectDomainOwnership({
      create: (actor) => notes.create(actor, "owner's private note"),
      read: (actor, target) => notes.read(actor, target),
      update: (actor, target) => notes.update(actor, target, `overwritten ${++counter}`),
      remove: (actor, target) => notes.remove(actor, target),
      snapshot: snapshotOf,
    }, { owner, other });
    expect(await snapshotOf(id)).toMatchObject({ userId: owner.userId, body: "owner's private note" });
  });

  it("answers 401 to guests and an indistinguishable 404 to another user over HTTP, without leaking data", async () => {
    const ownedId = await notes.create(owner.actor, "Owner secret 4821");
    await expectHttpOwnership({
      requests: [
        { name: "GET", send: (id, cookie) => send("GET", id, cookie) },
        { name: "PATCH", send: (id, cookie) => send("PATCH", id, cookie, { body: "taken over" }) },
        { name: "DELETE", send: (id, cookie) => send("DELETE", id, cookie) },
      ],
      users: { owner, other },
      ownedId,
      ownerSecrets: ["Owner secret 4821"],
      snapshot: () => snapshotOf(ownedId),
    });
    // The owner still has full access through the same routes.
    expect((await send("GET", ownedId, owner.cookie)).status).toBe(200);
    expect((await send("PATCH", ownedId, owner.cookie, { body: "edited by owner" })).status).toBe(200);
    expect((await send("DELETE", ownedId, owner.cookie)).status).toBe(200);
    expect(await snapshotOf(ownedId)).toBeNull();
    // Malformed ids are answered like unknown ones.
    expect((await send("GET", "not-a-uuid", other.cookie)).status).toBe(404);
  });

  it("does not let a userId in the body or query re-target a mutation at another user's resource", async () => {
    const ownedId = await notes.create(owner.actor, "untouched");
    const forged = await send("PATCH", ownedId, other.cookie, { body: "forged", userId: owner.userId });
    expect(forged.status).toBe(400);
    const viaQuery = await routes.PATCH(new Request(`${TEST_ORIGIN}/api/v1/fixture-notes?id=${ownedId}&userId=${owner.userId}`, {
      method: "PATCH", headers: { cookie: other.cookie, "content-type": "application/json", "x-user-id": owner.userId }, body: JSON.stringify({ body: "forged" }),
    }));
    expect(viaQuery.status).toBe(404);
    expect(await snapshotOf(ownedId)).toMatchObject({ body: "untouched" });
  });
});

describe("Better Auth sessions of another user", () => {
  it("are not listed to, and cannot be revoked by, a different user", async () => {
    const listed = await harness.callAuth("/list-sessions", { cookie: other.cookie });
    expect(listed.status).toBe(200);
    const tokens = (await listed.json() as { token: string; userId: string }[]);
    expect(tokens.map((session) => session.userId)).not.toContain(owner.userId);
    expect(JSON.stringify(tokens)).not.toContain(owner.sessionToken);
    expect(tokens.map((session) => session.token)).toContain(other.sessionToken);

    const revoke = await harness.callAuth("/revoke-session", { cookie: other.cookie, body: { token: owner.sessionToken } });
    expect(revoke.status).toBe(200);
    const me = await createCurrentUserRoute(() => harness.auth)(new Request(`${TEST_ORIGIN}/api/v1/me`, { headers: { cookie: owner.cookie } }));
    expect(me.status).toBe(200);
    expect(currentUserResponseSchema.parse(await me.json()).data?.id).toBe(owner.userId);
  });

  it("cascade-deletes owned rows with their owner", async () => {
    const id = await notes.create(other.actor, `disposable ${randomUUID()}`);
    await databaseOperation(() => harness.database.pool.query(`DELETE FROM "user" WHERE id = $1`, [other.userId]));
    expect(await snapshotOf(id)).toBeNull();
  });
});
