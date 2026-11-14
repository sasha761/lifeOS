import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { apiSuccessSchema, HTTP_HEADERS, identifierSchema } from "@lifeos/contracts";
import type { ApiFailure, ErrorCode, RequestContext } from "@lifeos/contracts";
import { ApiError, mapApiError } from "./api-error.ts";

export type HttpEvent = RequestContext & { event: "http.request"; status: number; code?: ErrorCode };
export type HttpLogger = (event: HttpEvent) => void;
export const writeHttpLog: HttpLogger = ({ event, status, code, request_id, correlation_id }) => {
  console.log(JSON.stringify({ event, status, code, request_id, correlation_id }));
};

export function createRequestContext(request: Request): RequestContext {
  const request_id = randomUUID();
  const correlation = identifierSchema.safeParse(request.headers.get(HTTP_HEADERS.correlationId));
  return { request_id, correlation_id: correlation.success ? correlation.data : request_id };
}

export async function parseJsonBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let value: unknown;
  try { value = await request.json(); } catch { throw new ApiError("VALIDATION_ERROR"); }
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError("VALIDATION_ERROR");
  return result.data;
}

export function apiRoute<T extends z.ZodType>(
  dataSchema: T,
  handler: (request: Request, context: RequestContext) => z.infer<T> | Promise<z.infer<T>>,
  log: HttpLogger = writeHttpLog,
): (request: Request) => Promise<Response> {
  const successSchema = apiSuccessSchema(dataSchema);
  return async (request) => {
    const context = createRequestContext(request);
    const headers = {
      "Cache-Control": "no-store",
      [HTTP_HEADERS.requestId]: context.request_id,
      [HTTP_HEADERS.correlationId]: context.correlation_id,
    };
    let response: Response;
    let code: ErrorCode | undefined;
    try {
      const data = await handler(request, context);
      // Output validation failures are internal errors, never client DTO errors.
      const body = successSchema.parse({ data, meta: context, errors: [] });
      response = Response.json(body, { status: 200, headers });
    } catch (error: unknown) {
      const mapped = mapApiError(error);
      code = mapped.error.code;
      const body: ApiFailure = { data: null, meta: context, errors: [mapped.error] };
      response = Response.json(body, { status: mapped.status, headers });
    }
    log({ event: "http.request", status: response.status, code, ...context });
    return response;
  };
}
