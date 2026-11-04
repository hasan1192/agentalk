import { errorText, t } from "./i18n";
import { errorGuidance } from "./error-guidance.mjs";

export default function ErrorNotice({ message }: { message: string }) {
  const guidance = errorGuidance(message);
  return (
    <div className="error-explanation">
      <p className="error-summary">
        {guidance ? t(guidance.title) : errorText(message)}
      </p>
      {guidance && (
        <>
          <p className="error-cause">{t(guidance.cause)}</p>
          <p className="error-action">
            <strong>{t("Ne yapabilirsin?")}</strong> {t(guidance.action)}
          </p>
          <details className="error-technical">
            <summary>{t("Teknik ayrıntı")}</summary>
            <p>{errorText(message)}</p>
          </details>
        </>
      )}
    </div>
  );
}
