import { t } from "./i18n";
import type { MediaSupport } from "./types";
export const defaultMediaSupport: MediaSupport = {
  image: "auto",
  audio: "auto",
  video: "auto",
};
const supportLabels = {
  image: "Fotoğraf okuma",
  audio: "Ses okuma",
  video: "Video okuma",
};
export default function MediaOptions({
  support,
  onSupport,
}: {
  support: MediaSupport;
  onSupport: (value: MediaSupport) => void;
}) {
  return (
    <details className="media-model-options">
      <summary>{t("Modelin medya desteği")}</summary>
      <p className="field-hint">
        {t(
          "Otomatik seçim sağlayıcı ve model bilgisini kullanır. Kapalı seçilen medya modele gönderilmez; desteklenmeyen içerik sohbet içinde açıklanır.",
        )}
      </p>
      <div className="form-group-grid">
        {(["image", "audio", "video"] as const).map((kind) => (
          <label className="input-field" key={kind}>
            <span>{t(supportLabels[kind])}</span>
            <select
              aria-label={t(supportLabels[kind])}
              value={support[kind] === "no" ? "no" : "auto"}
              onChange={(e) =>
                onSupport({
                  image: support.image === "no" ? "no" : "auto",
                  audio: support.audio === "no" ? "no" : "auto",
                  video: support.video === "no" ? "no" : "auto",
                  [kind]: e.target.value as "auto" | "no",
                })
              }
            >
              <option value="auto">{t("Otomatik")}</option>
              <option value="no">{t("Kapalı")}</option>
            </select>
          </label>
        ))}
      </div>
    </details>
  );
}
