import { ChevronDown, Paperclip, X } from "lucide-react";
import { MediaKindIcon } from "./MediaToken";
import { mediaLabel, mediaSize } from "./MediaContent";
import { t } from "./i18n";
import type { MediaDraft } from "./types";

export default function ComposerAttachments({
  media,
  disabled,
  onOpen,
  onRemove,
}: {
  media: MediaDraft[];
  disabled: boolean;
  onOpen: (media: MediaDraft, button: HTMLButtonElement) => void;
  onRemove: (id: string) => void;
}) {
  if (!media.length) return null;
  return (
    <details className="composer-attachment-summary">
      <summary>
        <Paperclip size={13} aria-hidden="true" />
        <span>
          {t("{count} ek · {size}", {
            count: media.length,
            size: mediaSize(media.reduce((sum, item) => sum + item.bytes, 0)),
          })}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <ul aria-label={t("Gönderilecek ekler")}>
        {media.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="composer-attachment-open"
              title={item.name}
              aria-label={t("{name} ayarlarını aç", { name: item.name })}
              disabled={disabled}
              onClick={(event) => onOpen(item, event.currentTarget)}
            >
              <MediaKindIcon kind={item.kind} />
              <span>
                <strong>{item.name}</strong>
                <small>
                  {mediaLabel(item.kind)} · {mediaSize(item.bytes)}
                </small>
              </span>
            </button>
            <button
              type="button"
              className="composer-attachment-remove"
              aria-label={t("{name} ekini kaldır", { name: item.name })}
              disabled={disabled}
              onClick={() => onRemove(item.id)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
