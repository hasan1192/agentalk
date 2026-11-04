import { useSyncExternalStore } from "react";
import en from "./locales/en.json";
import de from "./locales/de.json";
import { resolveLocale, translate } from "./locale.mjs";
export const LANGUAGES = [
  { id: "tr", name: "Türkçe" },
  { id: "en", name: "English" },
  { id: "de", name: "Deutsch" },
];
let locale = resolveLocale(
  localStorage.getItem("agentalk_language") || navigator.language,
);
const listeners = new Set<() => void>();
function applyLocale() {
  document.documentElement.lang = locale;
  for (const listener of listeners) listener();
}
applyLocale();
export function initializeLocale(systemLocale: string) {
  locale = resolveLocale(
    localStorage.getItem("agentalk_language") || systemLocale,
  );
  localStorage.setItem("agentalk_language", locale);
  applyLocale();
}
export function setLocale(value: string) {
  locale = resolveLocale(value);
  localStorage.setItem("agentalk_language", locale);
  applyLocale();
  void window.agentalk
    ?.command("app.language", { language: locale })
    .catch((error) => {
      window.alert(errorText(error.message));
    });
}
export function useLocale() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => locale,
  );
}
export function t(key: string, values?: Record<string, unknown>) {
  return translate({ en, de }, locale, key, values);
}

export function errorText(message: string) {
  const clean = message.replace(
    /^Error invoking remote method '[^']+': Error: /,
    "",
  );
  const http = clean.match(/^Sunucu HTTP (\d+) döndürdü\. (.+)$/);
  if (http)
    return t("Sunucu HTTP {status} döndürdü. {detail}", {
      status: http[1],
      detail: t(http[2]),
    });
  const retry = clean.match(/^Sağlayıcı beklemesi · yeniden deneme (\d+)\/2$/);
  if (retry)
    return t("Sağlayıcı beklemesi · yeniden deneme {count}/2", {
      count: retry[1],
    });
  return t(clean);
}
