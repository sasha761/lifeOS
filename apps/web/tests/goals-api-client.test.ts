import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createGoalCommand, GoalRequestError } from "../lib/goals-api-client.ts";

const meta = { request_id: "4fe63a56-7a7f-4905-bdc3-c9dff1d439dc", correlation_id: "4fe63a56-7a7f-4905-bdc3-c9dff1d439dc" };
const schema = z.strictObject({ id: z.string() });
const success = () => Response.json({ data: { id: "saved" }, meta, errors: [] });
const command = { url: "/api/v1/goals", method: "POST" as const, body: { title: "Private" } };
describe("browser idempotent write attempts", () => {
  it("blocks synchronous double submit and allocates a new key only after a completed intent", async () => {
    const barrier = Promise.withResolvers<Response>();
    const fetcher = vi.fn<typeof fetch>().mockReturnValueOnce(barrier.promise).mockResolvedValueOnce(success());
    const key = vi.fn().mockReturnValueOnce("key-1").mockReturnValueOnce("key-2");
    const client = createGoalCommand(fetcher, key);
    const first = client.run(command, schema);
    expect(await client.run(command, schema)).toBeUndefined(); expect(fetcher).toHaveBeenCalledTimes(1);
    barrier.resolve(success()); expect(await first).toEqual({ id: "saved" });
    await client.run(command, schema);
    expect(fetcher.mock.calls.map((call) => (call[1]?.headers as Record<string, string>)["idempotency-key"])).toEqual(["key-1", "key-2"]);
  });
  it.each(["network", "500", "invalid-response"])("reuses the same key and exact body after %s", async (failure) => {
    const fetcher = vi.fn<typeof fetch>();
    if (failure === "network") fetcher.mockRejectedValueOnce(new Error("private secret"));
    else fetcher.mockResolvedValueOnce(failure === "500" ? Response.json({ data: null, meta, errors: [{ code: "INTERNAL_ERROR", message: "Internal server error." }] }, { status: 500 }) : Response.json({ private: "secret" }));
    fetcher.mockResolvedValueOnce(success());
    const client = createGoalCommand(fetcher, () => "same-key");
    await expect(client.run(command, schema)).rejects.toMatchObject({ uncertain: true });
    await expect(client.run({ ...command, body: { title: "Changed" } }, schema)).rejects.toBeInstanceOf(GoalRequestError);
    expect(await client.run(command, schema)).toEqual({ id: "saved" });
    expect(fetcher.mock.calls[0][1]).toEqual(fetcher.mock.calls[1][1]);
  });
  it("allows correction after a definitive validation error and never echoes server messages", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: null, meta, errors: [{ code: "VALIDATION_ERROR", message: "private_table secret" }] }, { status: 400 })).mockResolvedValueOnce(success());
    const client = createGoalCommand(fetcher, vi.fn().mockReturnValueOnce("first-key").mockReturnValueOnce("corrected-key"));
    await expect(client.run(command, schema)).rejects.toMatchObject({ uncertain: false, status: 400, message: "Сервер отклонил данные. Проверьте значения и дату измерения." });
    await expect(client.run({ ...command, body: { title: "Corrected" } }, schema)).resolves.toEqual({ id: "saved" });
  });
  it("sends DELETE without a body or JSON content-type", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(success());
    await createGoalCommand(fetcher, () => "delete-key").run({ url: "/api/v1/goal-measurements/id", method: "DELETE" }, schema);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ body: undefined, headers: { "idempotency-key": "delete-key" } });
  });
});
