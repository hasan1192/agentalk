export const supportedLocales = ["tr", "en", "de"];
export function resolveLocale(value) {
  const language = String(value || "")
    .replaceAll("_", "-")
    .toLowerCase()
    .split("-")[0];
  return supportedLocales.includes(language) ? language : "en";
}
export function translate(catalogs, locale, key, values = {}) {
  const text =
    resolveLocale(locale) === "tr"
      ? key
      : (catalogs[resolveLocale(locale)]?.[key] ?? catalogs.en?.[key] ?? key);
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}
