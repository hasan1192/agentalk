export const supportedLocales: string[];
export function resolveLocale(value: unknown): "tr" | "en" | "de";
export function translate(
  catalogs: Record<string, Record<string, string>>,
  locale: string,
  key: string,
  values?: Record<string, unknown>,
): string;
