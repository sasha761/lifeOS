import { z } from "zod";
import {
  goalDeletionSchema, goalDetailsSchema, goalMeasurementDeletionSchema, goalMeasurementSchema, goalsPageSchema, HTTP_HEADERS,
  idempotencyKeySchema, measurementsPageSchema, patchGoalInputSchema,
} from "@lifeos/contracts";
import type { Actor, GoalMeasurementsService, GoalsReader, GoalsService } from "@lifeos/domain";
import { ApiError } from "./api-error.ts";
import { apiRoute, parseJsonBody } from "./api-route.ts";
import type { HttpLogger } from "./api-route.ts";
import type { Auth } from "./auth/create-auth.ts";
import { requireApiActor } from "./auth/session.ts";

export type GoalRouteContext = { params: Promise<{ goalId: string }> };
export type MeasurementRouteContext = { params: Promise<{ measurementId: string }> };
export type GoalsRouteDependencies = {
  resolveAuth(): Auth;
  resolveGoals(): GoalsService;
  resolveMeasurements(): GoalMeasurementsService;
  resolveReader(): GoalsReader;
  log?: HttpLogger;
};
/** Query parameters as a plain record; a repeated key is a validation error, never "first wins". */
export function query(request: Request): Record<string, string> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, value] of new URL(request.url).searchParams) {
    if (Object.hasOwn(result, key)) throw new ApiError("VALIDATION_ERROR");
    result[key] = value;
  }
  return result;
}
function noQuery(request: Request): void {
  if (Object.keys(query(request)).length) throw new ApiError("VALIDATION_ERROR");
}
/** Origin, no query and a valid Idempotency-Key for every goal write; shared with the example commands (LFS-218). */
export function commandContext(request: Request, publicBaseURL: string) {
  const origin = request.headers.get("origin");
  // Next may reconstruct request.url with its internal host. Trust the configured public URL, never Host/X-Forwarded-Host.
  if (origin !== null && origin !== new URL(publicBaseURL).origin) throw new ApiError("FORBIDDEN");
  noQuery(request);
  const key = idempotencyKeySchema.safeParse(request.headers.get(HTTP_HEADERS.idempotencyKey));
  if (!key.success) throw new ApiError("VALIDATION_ERROR");
  return { idempotencyKey: key.data, source: "web" as const };
}
/** Next may expose a zero-byte body as a stream; reject actual content, not that stream. */
export async function requireEmptyBody(request: Request): Promise<void> {
  if (request.body !== null && (await request.text()).length !== 0) throw new ApiError("VALIDATION_ERROR");
}
async function json(request: Request) {
  // JSON + the mandatory custom header require preflight for cross-origin browser writes.
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new ApiError("VALIDATION_ERROR");
  return parseJsonBody(request, z.unknown());
}
/** Thin HTTP adapters. Auth precedes params/body/query; business validation and writes stay in domain. */
export function createGoalsRoutes(dependencies: GoalsRouteDependencies) {
  const { resolveAuth, resolveGoals, resolveMeasurements, resolveReader, log } = dependencies;
  function goalRoute<T extends z.ZodType>(schema: T, work: (request: Request, actor: Actor, id: string) => Promise<z.infer<T>>) {
    return (request: Request, context: GoalRouteContext) => apiRoute(schema, async (request) => {
      const actor = await requireApiActor(resolveAuth(), request.headers);
      return work(request, actor, (await context.params).goalId);
    }, log)(request);
  }
  function measurementRoute<T extends z.ZodType>(schema: T, work: (request: Request, actor: Actor, id: string) => Promise<z.infer<T>>) {
    return (request: Request, context: MeasurementRouteContext) => apiRoute(schema, async (request) => {
      const actor = await requireApiActor(resolveAuth(), request.headers);
      return work(request, actor, (await context.params).measurementId);
    }, log)(request);
  }
  return {
    collection: {
      GET: apiRoute(goalsPageSchema, async (request) => {
        const actor = await requireApiActor(resolveAuth(), request.headers);
        return resolveReader().list(actor, query(request));
      }, log),
      POST: apiRoute(goalDetailsSchema, async (request) => {
        const actor = await requireApiActor(resolveAuth(), request.headers);
        const options = commandContext(request, resolveAuth().options.baseURL);
        const goal = await resolveGoals().create(actor, await json(request), options);
        return resolveReader().get(actor, goal.id);
      }, log),
    },
    goal: {
      DELETE: goalRoute(goalDeletionSchema, async (request, actor, id) => {
        const options = commandContext(request, resolveAuth().options.baseURL);
        await requireEmptyBody(request);
        return resolveGoals().deleteGoal(actor, id, options);
      }),
      GET: goalRoute(goalDetailsSchema, async (request, actor, id) => { noQuery(request); return resolveReader().get(actor, id); }),
      PATCH: goalRoute(goalDetailsSchema, async (request, actor, id) => {
        const options = commandContext(request, resolveAuth().options.baseURL);
        const parsed = patchGoalInputSchema.safeParse(await json(request));
        if (!parsed.success) throw new ApiError("VALIDATION_ERROR");
        const goal = "status" in parsed.data ? await resolveGoals().archive(actor, id, options) : await resolveGoals().update(actor, id, parsed.data, options);
        return resolveReader().get(actor, goal.id);
      }),
    },
    measurements: {
      GET: goalRoute(measurementsPageSchema, (request, actor, id) => resolveReader().history(actor, id, query(request))),
      POST: goalRoute(goalMeasurementSchema, async (request, actor, id) => {
        const options = commandContext(request, resolveAuth().options.baseURL);
        return resolveMeasurements().create(actor, id, await json(request), options);
      }),
    },
    measurement: {
      PATCH: measurementRoute(goalMeasurementSchema, async (request, actor, id) => {
        const options = commandContext(request, resolveAuth().options.baseURL);
        return resolveMeasurements().update(actor, id, await json(request), options);
      }),
      DELETE: measurementRoute(goalMeasurementDeletionSchema, async (request, actor, id) => {
        const options = commandContext(request, resolveAuth().options.baseURL);
        await requireEmptyBody(request);
        return resolveMeasurements().remove(actor, id, options);
      }),
    },
  };
}
