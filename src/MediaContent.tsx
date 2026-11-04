import { t } from "./i18n";
import type { MediaAttachment } from "./types";
import { FileText } from "lucide-react";
import { messagePieces } from "./message-layout.mjs";
import MediaToken from "./MediaToken";
export const mediaSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(0)} KB`
      : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
export const mediaLabel = (kind: MediaAttachment["kind"]) =>
  t(
    { image: "Fotoğraf", audio: "Ses", video: "Video", document: "Dosya" }[
      kind
    ],
  );
export const documentNotice = (status?: string) =>
  t(
    {
      ready: "Metin okunabilir",
      password: "Dosya şifreli. Şifresiz bir kopya paylaş.",
      "no-text":
        "Okunabilir metin bulunamadı. Metin içeren bir kopya veya transkript paylaş.",
      unreadable: "Dosya okunamadı. Başka bir kopya veya metin olarak paylaş.",
      unsupported:
        "Bu dosya biçimi okunamıyor. PDF, DOCX, XLSX, PPTX, OpenDocument veya metin olarak paylaş.",
      limit: "Dosya okuma sınırını aşıyor. Daha küçük bir bölüm paylaş.",
    }[status || ""] || "Dosya",
  );
export function MediaPlayer({
  media,
  url,
}: {
  media: MediaAttachment;
  url: string;
}) {
  return media.kind === "document" ? (
    <span className="document-preview">
      <span className="document-preview-heading">
        <FileText size={24} />
        <strong>{media.name.split(".").at(-1)?.toUpperCase()}</strong>
      </span>
      <span className="document-preview-status">
        {documentNotice(media.document?.status)}
        {media.document?.pages
          ? ` · ${media.document.pages} ${t("sayfa")}`
          : ""}
      </span>
      {media.document?.excerpt && (
        <span className="document-preview-excerpt">
          {media.document.excerpt}
        </span>
      )}
    </span>
  ) : media.kind === "image" ? (
    <img src={url} alt={media.name} loading="lazy" draggable={false} />
  ) : media.kind === "audio" ? (
    <audio src={url} controls preload="metadata" aria-label={media.name} />
  ) : (
    <video
      src={url}
      controls
      preload="metadata"
      playsInline
      aria-label={media.name}
    />
  );
}
export default function MediaContent({
  attachments,
  chatId,
  content = "",
}: {
  attachments: MediaAttachment[];
  chatId: string;
  content?: string;
}) {
  return (
    <div className="message-inline-content">
      {messagePieces(content, attachments).map((piece, index) =>
        piece.type === "text" ? (
          <span key={`text-${index}`} className="message-body-text">
            {piece.text}
          </span>
        ) : (
          <span
            className={`message-media ${piece.attachment.kind}`}
            key={piece.attachment.id}
          >
            <MediaToken
              media={piece.attachment}
              url={`agentalk-media://asset/${chatId}/${piece.attachment.id}`}
            />
          </span>
        ),
      )}
    </div>
  );
}
