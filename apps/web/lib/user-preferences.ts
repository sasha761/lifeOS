import { supportedTimeZones } from "@lifeos/contracts";
import type { UserPreferences } from "@lifeos/contracts";

export type SelectOption = { value: string; label: string };

/** Common choices for the form. The API accepts any valid BCP 47 tag, so the stored value is always offered too. */
const LOCALE_CHOICES: readonly string[] = ["ru", "uk", "en-US", "en-GB", "nb", "de", "pl"];

const capitalize = (value: string) => value.charAt(0).toLocaleUpperCase("ru") + value.slice(1);

/** Server-side list: the same runtime that validates PATCH requests decides which zones exist. */
export function timeZoneOptions(current: string): string[] {
  const zones = supportedTimeZones();
  return zones.includes(current) ? zones : [current, ...zones];
}

export function localeLabel(locale: string): string {
  try {
    return `${capitalize(new Intl.DisplayNames(["ru"], { type: "language" }).of(locale) ?? locale)} (${locale})`;
  } catch {
    return locale;
  }
}

export function localeOptions(current: string): SelectOption[] {
  const values = LOCALE_CHOICES.includes(current) ? LOCALE_CHOICES : [current, ...LOCALE_CHOICES];
  return values.map((value) => ({ value, label: localeLabel(value) }));
}

/** "UTC+01:00" for an instant in a zone; empty if ICU no longer knows the stored zone. */
export function utcOffsetLabel(instant: Date, timeZone: string): string {
  try {
    const offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(instant).find((part) => part.type === "timeZoneName")?.value;
    return offset ? offset.replace("GMT", "UTC") : "";
  } catch {
    return "";
  }
}

/**
 * Formats a stored UTC instant in the user's zone and locale. Falls back to UTC and Russian if the
 * runtime rejects the stored values, so a page never fails because of an ICU update.
 */
export function formatDateTime(instant: Date, preferences: UserPreferences): string {
  const style = { dateStyle: "long", timeStyle: "short" } as const;
  try {
    return new Intl.DateTimeFormat(preferences.locale, { ...style, timeZone: preferences.timezone }).format(instant);
  } catch {
    return new Intl.DateTimeFormat("ru", { ...style, timeZone: "UTC" }).format(instant);
  }
}
