import { goalInstantSchema } from "@lifeos/contracts";

export type ZonedInstantChoice = { instant: string; offset: string };
/** Native datetime-local fields display the account's zone, independent of the browser's zone. */
export function instantToLocalInput(instant: string, timeZone: string): string {
  const options = { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hourCycle: "h23" } as const;
  const parts = new Intl.DateTimeFormat("en-CA", options).formatToParts(new Date(instant));
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === name)?.value ?? "";
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}.${part("fractionalSecond")}`;
}
function wallInstant(value: string): string | null {
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
  const parsed = goalInstantSchema.safeParse(`${withSeconds}Z`);
  return parsed.success ? parsed.data : null;
}
export function zonedInstantChoices(local: string, timeZone: string): ZonedInstantChoice[] {
  const wall = wallInstant(local);
  if (!wall) return [];
  const epoch = new Date(wall).getTime();
  const normalized = wall.slice(0, -1);
  const offsets = new Set<number>();
  try {
    for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
      const sample = epoch + hours * 3_600_000;
      const localSample = wallInstant(instantToLocalInput(new Date(sample).toISOString(), timeZone));
      if (localSample) offsets.add(new Date(localSample).getTime() - sample);
    }
    return [...offsets].map((offset) => new Date(epoch - offset).toISOString())
      .filter((instant) => instantToLocalInput(instant, timeZone) === normalized).sort().map((instant) => ({
        instant, offset: new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(new Date(instant))
          .find((part) => part.type === "timeZoneName")!.value.replace("GMT", "UTC"),
      }));
  } catch { return []; }
}
export function resolveGoalTime(local: string, timeZone: string, offset: string | null): string {
  const choices = zonedInstantChoices(local, timeZone);
  if (!choices.length) throw new Error("Укажите существующие дату и время в выбранном часовом поясе.");
  const selected = choices.length === 1 ? choices[0] : choices.find((choice) => choice.offset === offset);
  if (!selected) throw new Error("В это время часы переводятся. Выберите смещение UTC.");
  return selected.instant;
}
/** Calendar date (YYYY-MM-DD) of an instant in the account's zone, for a native date field. */
export function instantToLocalDate(instant: string, timeZone: string): string {
  return instantToLocalInput(instant, timeZone).slice(0, 10);
}
/** A date-only deadline (LFS-213) is stored as the last millisecond of that day in the account's zone. */
export function endOfLocalDay(date: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Укажите дату срока.");
  return resolveGoalTime(`${date}T23:59:59.999`, timeZone, null);
}
