import { healthDataSchema } from "@lifeos/contracts";
import type { HealthData } from "@lifeos/contracts";
import { apiRoute } from "../../../server/api-route.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute(healthDataSchema, (): HealthData => ({
  status: "ok", service: "lifeos-web", timestamp: new Date().toISOString(),
}));
