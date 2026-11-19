import type { z } from "zod";
import { apiFailureSchema, apiSuccessSchema } from "@lifeos/contracts";

export class GoalRequestError extends Error {
  constructor(readonly status: number, readonly uncertain: boolean, message: string) { super(message); }
}
const errorMessage = (status: number) => status === 401 ? "Сессия закончилась. Войдите снова." : status === 404 ? "Запись не найдена или недоступна."
  : status === 403 ? "Сервер отклонил источник запроса. Откройте приложение по его основному адресу."
  : status === 409 ? "Данные изменились или цель уже в архиве. Обновите страницу и проверьте запись."
  : status === 400 ? "Сервер отклонил данные. Проверьте значения и дату измерения." : "Не удалось получить ответ сервера. Повторите запрос.";
async function responseData<T extends z.ZodType>(response: Response, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try { body = await response.json(); } catch { throw new GoalRequestError(response.status, true, "Не удалось проверить ответ сервера. Повторите запрос."); }
  const parsed = apiSuccessSchema(schema).safeParse(body);
  if (response.ok && parsed.success && body !== null && typeof body === "object" && "data" in body) return schema.parse(body.data);
  const definitive = [400, 401, 403, 404, 409].includes(response.status) && apiFailureSchema.safeParse(body).success;
  throw new GoalRequestError(response.status, !definitive, errorMessage(response.status));
}
export async function getGoalsData<T extends z.ZodType>(url: string, schema: T, signal?: AbortSignal): Promise<z.infer<T>> {
  return responseData(await fetch(url, { credentials: "same-origin", cache: "no-store", signal }), schema);
}
type Command = { url: string; method: "POST" | "PATCH" | "DELETE"; body?: unknown };
/** An unresolved attempt is immutable. A retry uses the exact body and key, including after a 500. */
export function createGoalCommand(fetcher: typeof fetch = fetch, key: () => string = () => crypto.randomUUID()) {
  let attempt: { signature: string; key: string; command: Command } | undefined;
  let pending = false;
  return {
    async run<T extends z.ZodType>(command: Command, schema: T): Promise<z.infer<T> | undefined> {
      if (pending) return undefined;
      const signature = JSON.stringify(command);
      if (attempt && attempt.signature !== signature) throw new GoalRequestError(0, true, "Сначала повторите предыдущий запрос с неизменёнными данными.");
      attempt ??= { signature, key: key(), command };
      pending = true;
      try {
        const headers: Record<string, string> = { "idempotency-key": attempt.key };
        if (attempt.command.body !== undefined) headers["content-type"] = "application/json";
        const result = await responseData(await fetcher(command.url, { method: command.method, credentials: "same-origin", cache: "no-store", headers,
          body: attempt.command.body === undefined ? undefined : JSON.stringify(attempt.command.body) }), schema);
        attempt = undefined;
        return result;
      } catch (error) {
        if (error instanceof GoalRequestError) { if (!error.uncertain) attempt = undefined; throw error; }
        throw new GoalRequestError(0, true, "Соединение прервалось. Сервер мог сохранить изменения. Повторите отправку.");
      } finally { pending = false; }
    },
  };
}
