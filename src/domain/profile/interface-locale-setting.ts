import { INTERFACE_LOCALES, type InterfaceLocale } from "@/lib/i18n/locale";

/**
 * DAN-427 (M11.5-P02) body of the interface language setting (contract on
 * #1836, c.6820446364). The body is `{"locale": "hr" | "en"}` and nothing
 * else: no other key, no tag form, no case or padding. Who sets it comes from
 * the session, never from the body.
 *
 * This is the language of the screen (D-70, F-06). The language a work is
 * written in is a value of the work and is not read or written here.
 */
export const INTERFACE_LOCALE_SETTING_VALUES: readonly InterfaceLocale[] = INTERFACE_LOCALES;

export interface InterfaceLocaleSetting {
  locale: InterfaceLocale;
}

function isInterfaceLocale(value: unknown): value is InterfaceLocale {
  return typeof value === "string" && (INTERFACE_LOCALE_SETTING_VALUES as readonly string[]).includes(value);
}

/** The setting, or null for anything but a plain object with exactly one valid `locale`. */
export function parseInterfaceLocaleSetting(value: unknown): InterfaceLocaleSetting | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== "locale") return null;
  const locale = (value as { locale?: unknown }).locale;
  return isInterfaceLocale(locale) ? { locale } : null;
}
