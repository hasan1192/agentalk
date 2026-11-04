import { useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { t } from "./i18n";

export default function ProfilePhoto({
  value,
  onChange,
  tile = false,
}: {
  value: string;
  onChange: (value: string) => void;
  tile?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  return (
    <div className={`profile-photo-editor${tile ? " profile-photo-tile" : ""}`}>
      <span className="profile-photo-preview">
        {value ? (
          <img src={value} alt={t("Profil fotoğrafı")} />
        ) : (
          <span>+</span>
        )}
      </span>
      <div className="profile-photo-actions">
        <button
          type="button"
          className="btn-secondary btn-sm profile-photo-select"
          onClick={() => input.current?.click()}
        >
          {tile ? (
            <span className="profile-photo-caption">
              <Camera size={14} />
              {t("Fotoğraf seç")}
            </span>
          ) : (
            t("Profil fotoğrafı seç")
          )}
        </button>
        {value && (
          <button
            type="button"
            className="btn-secondary btn-sm profile-photo-remove"
            aria-label={t("Fotoğrafı kaldır")}
            title={t("Fotoğrafı kaldır")}
            onClick={() => onChange("")}
          >
            {tile ? <X size={13} /> : t("Fotoğrafı kaldır")}
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label={t("Profil fotoğrafı seç")}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setError("");
            if (
              file.size > 10 * 1024 * 1024 ||
              !["image/png", "image/jpeg", "image/webp"].includes(file.type)
            ) {
              setError(t("PNG, JPEG veya WebP seç (en fazla 10 MB)."));
              return;
            }
            try {
              const bitmap = await createImageBitmap(file);
              const canvas = document.createElement("canvas");
              canvas.width = canvas.height = 256;
              const side = Math.min(bitmap.width, bitmap.height);
              canvas
                .getContext("2d")!
                .drawImage(
                  bitmap,
                  (bitmap.width - side) / 2,
                  (bitmap.height - side) / 2,
                  side,
                  side,
                  0,
                  0,
                  256,
                  256,
                );
              bitmap.close();
              onChange(canvas.toDataURL("image/png"));
            } catch {
              setError(t("Fotoğraf açılamadı."));
            }
          }}
        />
      </div>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
