import { useEffect, useRef, useState } from "react";
import {
  Image,
  Music,
  Video,
  FileText,
  LoaderCircle,
  AlertCircle,
  RotateCcw,
  X,
} from "lucide-react";
import { t } from "./i18n";
import ErrorNotice from "./ErrorNotice";
import { MediaPlayer, mediaSize, mediaLabel } from "./MediaContent";
import NumberField from "./NumberField";
import type { MediaDraft, MediaSettings } from "./types";

type Item = {
  key: string;
  name: string;
  draft?: MediaDraft;
  settings?: MediaSettings;
  defaults?: MediaSettings;
  invalid?: Record<string, boolean>;
  reset: number;
  working: boolean;
  error: string;
};
const formatLabel = (format?: string) =>
  ({
    jpeg: "JPEG",
    webp: "WebP",
    png: "PNG",
    wav: "WAV",
    opus: "Opus",
    webm: "WebM",
  })[format || ""] || "";
export default function MediaPreview({
  files,
  editDraft,
  existingBytes = 0,
  chatId,
  topicId,
  onAdd,
  onCancel,
}: {
  files?: File[];
  editDraft?: MediaDraft;
  existingBytes?: number;
  chatId: string;
  topicId: string;
  onAdd: (items: MediaDraft[]) => void;
  onCancel: () => void;
}) {
  const [items, setItems] = useState<Item[]>(
    (editDraft ? [editDraft] : files || []).map((file, i) => ({
      key: String(i),
      name: file.name,
      working: true,
      reset: 0,
      error: "",
    })),
  );
  const [selected, setSelected] = useState("0");
  const scroll = useRef<HTMLDivElement>(null);
  const alive = useRef(true),
    handedOff = useRef(false),
    owned = useRef(new Set<string>());
  const revisions = useRef(new Map<string, number>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const update = (key: string, patch: Partial<Item>) =>
    setItems((all) =>
      all.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const sources = editDraft ? [editDraft] : files || [];
      for (let i = 0; i < sources.length; i++) {
        if (cancelled) break;
        const file = sources[i];
        try {
          if (file instanceof File && file.size === 0)
            throw new Error("Dosya boş. İçerik bulunan bir dosya seç.");
          if (file instanceof File && file.size > 100 * 1024 * 1024)
            throw new Error(t("Medya dosyası en fazla 100 MB olmalı."));
          const draft = editDraft
            ? await window.agentalk.copyMediaDraft(editDraft.id)
            : await window.agentalk.stageMedia(
                chatId,
                topicId,
                file.name,
                await (file as File).arrayBuffer(),
              );
          if (cancelled) {
            void window.agentalk.discardMedia(draft.id);
            break;
          }
          owned.current.add(draft.id);
          update(String(i), {
            draft,
            settings: draft.settings,
            defaults: { ...draft.settings },
            working: false,
          });
        } catch (e) {
          if (!cancelled)
            update(String(i), {
              working: false,
              error: (e as Error).message,
            });
        }
      }
    })();
    return () => {
      cancelled = true;
      alive.current = false;
      for (const timer of timers.current.values()) clearTimeout(timer);
      if (!handedOff.current)
        for (const id of owned.current) void window.agentalk.discardMedia(id);
    };
  }, [files, editDraft, chatId, topicId]);
  const item = items.find((item) => item.key === selected) || items[0];
  const change = (patch: MediaSettings, reset = false) => {
    if (!item?.draft) return;
    const key = item.key;
    const settings = reset ? { ...patch } : { ...item.settings, ...patch };
    if (patch.start !== undefined)
      settings.duration = Math.min(
        settings.duration || 0.1,
        item.draft.original.duration - patch.start,
        120,
      );
    const rev = (revisions.current.get(key) || 0) + 1;
    revisions.current.set(key, rev);
    update(key, {
      settings,
      working: true,
      error: "",
      ...(reset ? { invalid: {}, reset: item.reset + 1 } : {}),
    });
    clearTimeout(timers.current.get(key));
    timers.current.set(
      key,
      setTimeout(async () => {
        try {
          const draft = await window.agentalk.previewMedia(
            item.draft!.id,
            settings,
          );
          if (alive.current && revisions.current.get(key) === rev)
            update(key, { draft, settings: draft.settings, working: false });
        } catch (e) {
          if (alive.current && revisions.current.get(key) === rev)
            update(key, {
              working: false,
              error: (e as Error).message,
            });
        }
      }, 350),
    );
  };
  const remove = (key: string) => {
    const old = items.find((i) => i.key === key);
    if (old?.working) return;
    clearTimeout(timers.current.get(key));
    if (old?.draft) {
      owned.current.delete(old.draft.id);
      void window.agentalk.discardMedia(old.draft.id);
    }
    if (items.length === 1) {
      onCancel();
      return;
    }
    setItems((all) => all.filter((i) => i.key !== key));
  };
  const num = (
    label: string,
    setting: keyof MediaSettings,
    min: number,
    max: number,
    step = 1,
  ) => (
    <label className="input-field">
      <span>{t(label)}</span>
      <NumberField
        key={`${item?.key}-${item?.reset}-${setting}`}
        aria-label={t(label)}
        min={min}
        max={max}
        step={step}
        value={Number(item?.settings?.[setting] ?? min)}
        onChange={(value) => change({ [setting]: value })}
        onValidityChange={(valid) =>
          setItems((all) =>
            all.map((i) =>
              i.key === item?.key
                ? { ...i, invalid: { ...i.invalid, [setting]: !valid } }
                : i,
            ),
          )
        }
      />
    </label>
  );
  const drafts = items.flatMap((item) =>
    item.draft &&
    !item.working &&
    !item.error &&
    !Object.values(item.invalid || {}).some(Boolean)
      ? [item.draft]
      : [],
  );
  const total = items.reduce((sum, item) => sum + (item.draft?.bytes || 0), 0);
  const messageTotal = existingBytes + total;
  const overLimit = messageTotal > 16 * 1024 * 1024;
  const problems = items.filter(
    (item) => item.error || Object.values(item.invalid || {}).some(Boolean),
  );
  const kind = item?.draft?.kind;
  const source = item?.draft?.original;
  const hasSound = kind === "audio" || (kind === "video" && source?.hasAudio);
  const dimensions = item?.draft?.width
    ? `${item.draft.width} × ${item.draft.height} px`
    : "";
  return (
    <div className="media-preview-body">
      <div className="media-preview-scroll" ref={scroll}>
        <div className="media-file-tabs" aria-label={t("Eklenen dosyalar")}>
          {items.map((i) => {
            const hasProblem = problems.includes(i);
            const label = hasProblem
              ? t("{name} · Sorun var", { name: i.name })
              : i.name;
            return (
              <div
                key={i.key}
                className={`${item?.key === i.key ? "selected" : ""} ${hasProblem ? "has-error" : ""}`}
              >
                <button
                  type="button"
                  aria-pressed={item?.key === i.key}
                  title={label}
                  aria-label={label}
                  onClick={() => setSelected(i.key)}
                >
                  {i.draft?.kind === "document" ? (
                    <FileText size={16} />
                  ) : i.draft?.kind === "audio" ? (
                    <Music size={16} />
                  ) : i.draft?.kind === "video" ? (
                    <Video size={16} />
                  ) : (
                    <Image size={16} />
                  )}
                  <span>{i.name}</span>
                  {hasProblem && (
                    <AlertCircle
                      size={14}
                      className="media-file-issue"
                      aria-hidden="true"
                    />
                  )}
                  {i.working && (
                    <LoaderCircle size={14} className="media-spinner" />
                  )}
                </button>
                {!editDraft && (
                  <button
                    type="button"
                    aria-label={t("Medyayı kaldır")}
                    disabled={i.working}
                    onClick={() => remove(i.key)}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {item?.error && (
          <div className="media-error media-file-error" role="alert">
            <ErrorNotice message={item.error} />
          </div>
        )}
        {item?.working && !item.draft && (
          <div className="media-preview-preparing" role="status">
            <LoaderCircle size={20} className="media-spinner" />
            <span>{t("Medya hazırlanıyor…")}</span>
          </div>
        )}
        {item?.draft && (
          <div
            className={`media-preview-columns ${kind === "document" ? "document-only" : ""}`}
          >
            <div className={`media-preview-stage ${kind || "loading"}`}>
              <div className="media-preview-viewport">
                <MediaPlayer
                  key={item.draft.version}
                  media={item.draft}
                  url={item.draft.url}
                />
                {item.working && item.draft && (
                  <div className="media-preview-processing">
                    <LoaderCircle size={16} className="media-spinner" />
                    {t("Önizleme güncelleniyor…")}
                  </div>
                )}
              </div>
              {item.draft && (
                <div className="media-preview-stats">
                  <div>
                    <span>
                      {mediaLabel(item.draft.kind)}
                      {formatLabel(item.draft.settings.format)
                        ? ` · ${formatLabel(item.draft.settings.format)}`
                        : ""}
                    </span>
                    <span>
                      {mediaSize(item.draft.original.bytes)} →{" "}
                      <strong>{mediaSize(item.draft.bytes)}</strong>
                    </span>
                  </div>
                  {(dimensions || item.draft.duration || kind === "video") && (
                    <div>
                      <span>{dimensions}</span>
                      <span>
                        {[
                          item.draft.duration
                            ? `${item.draft.duration.toFixed(1)} s`
                            : "",
                          kind === "video"
                            ? `${item.draft.settings.fps} FPS`
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
            {item.draft && kind !== "document" && (
              <div className="media-preview-settings">
                <div className="media-settings-heading">
                  <h3>{t("Gönderilecek medya")}</h3>
                  <button
                    type="button"
                    className="media-reset"
                    onClick={() => change(item.defaults!, true)}
                    title={t("Bu dosyanın ilk ayarlarını geri getir.")}
                  >
                    <RotateCcw size={14} />
                    {t("Varsayılana dön")}
                  </button>
                </div>
                <div className="media-settings-group">
                  <label className="input-field">
                    <span>
                      {t(
                        kind === "image"
                          ? "Görüntü biçimi"
                          : kind === "audio"
                            ? "Ses biçimi"
                            : "Video biçimi",
                      )}
                    </span>
                    <select
                      aria-label={t(
                        kind === "image"
                          ? "Görüntü biçimi"
                          : kind === "audio"
                            ? "Ses biçimi"
                            : "Video biçimi",
                      )}
                      value={item.settings?.format}
                      onChange={(e) =>
                        change({
                          format: e.target.value as MediaSettings["format"],
                        })
                      }
                    >
                      {kind === "image" ? (
                        <>
                          <option value="jpeg">JPEG</option>
                          <option value="webp">WebP</option>
                          <option value="png">PNG</option>
                        </>
                      ) : kind === "audio" ? (
                        <>
                          <option value="wav">WAV</option>
                          <option value="opus">Opus</option>
                        </>
                      ) : (
                        <option value="webm">WebM · VP9</option>
                      )}
                    </select>
                  </label>
                  {source?.sourceFormat &&
                    ![
                      "JPEG",
                      "PNG",
                      "WEBP",
                      "WAV",
                      "OGG",
                      "WEBM",
                      "MATROSKA",
                    ].includes(source.sourceFormat) && (
                      <p className="field-hint">
                        {t(
                          "Kaynak: {format}. Desteklenen en yakın çıktı biçimi seçildi.",
                          { format: source.sourceFormat },
                        )}
                      </p>
                    )}
                  {source?.sourceFormat === "GIF" && (
                    <p className="field-hint">
                      {t("Animasyonlu görsel tek kare olarak gönderilir.")}
                    </p>
                  )}
                  {kind !== "audio" && (
                    <>
                      <div className="form-group-grid media-resolution-fields">
                        <label className="input-field">
                          <span>{t("Çözünürlük birimi")}</span>
                          <select
                            aria-label={t("Çözünürlük birimi")}
                            value={item.settings?.resizeMode}
                            onChange={(e) => {
                              const resizeMode = e.target
                                .value as MediaSettings["resizeMode"];
                              const size = Math.max(
                                source?.width || 1,
                                source?.height || 1,
                              );
                              change({
                                resizeMode,
                                ...(resizeMode === "percent"
                                  ? {
                                      scalePercent: Math.max(
                                        1,
                                        Math.min(
                                          100,
                                          Math.round(
                                            ((item.settings?.maxSize || size) /
                                              size) *
                                              1000,
                                          ) / 10,
                                        ),
                                      ),
                                    }
                                  : {}),
                              });
                            }}
                          >
                            <option value="pixels">{t("Piksel")}</option>
                            <option value="percent">{t("Yüzde")}</option>
                          </select>
                        </label>
                        {item.settings?.resizeMode === "percent"
                          ? num("Ölçek (%)", "scalePercent", 1, 100, 0.1)
                          : num("Çözünürlük sınırı (px)", "maxSize", 1, 2048)}
                      </div>
                      <p className="field-hint">
                        {t(
                          "Oran korunur; büyütme yapılmaz. En fazla 2048 × 2048 px.",
                        )}
                        {source?.width
                          ? ` ${t("Kaynak")}: ${source.width} × ${source.height} px.`
                          : ""}
                      </p>
                    </>
                  )}
                  {kind === "image" &&
                    (item.settings?.format === "png" ? (
                      <p className="field-hint">
                        {t("PNG kayıpsızdır; kalite ayarı gerekmez.")}
                      </p>
                    ) : (
                      num(
                        item.settings?.format === "jpeg"
                          ? "JPEG kalitesi (%)"
                          : "WebP kalitesi (%)",
                        "quality",
                        20,
                        100,
                      )
                    ))}
                </div>
                {kind !== "image" && (
                  <div className="media-settings-group">
                    <h4>{t("Kesit")}</h4>
                    <div className="form-group-grid">
                      {num(
                        "Başlangıç (s)",
                        "start",
                        0,
                        Math.max(0, (source?.duration || 0) - 0.1),
                        0.1,
                      )}
                      {num(
                        "Kesit süresi (s)",
                        "duration",
                        0.1,
                        Math.max(
                          0.1,
                          Math.min(
                            120,
                            (source?.duration || 0) -
                              (item.settings?.start || 0),
                          ),
                        ),
                        0.1,
                      )}
                    </div>
                    {source && source.duration > 120 && (
                      <p className="field-hint">
                        {t("Bir kesit en fazla 120 saniye olabilir.")}
                      </p>
                    )}
                    {kind === "video" && (
                      <>
                        {num("Kare hızı (FPS)", "fps", 0.5, 30, 0.5)}
                        {num("VP9 sıkıştırma (CRF)", "quality", 18, 48)}
                        <p className="field-hint">
                          {t(
                            "Düşük değer daha net görüntü, yüksek değer daha küçük dosya sağlar.",
                          )}
                        </p>
                      </>
                    )}
                  </div>
                )}
                {hasSound && (
                  <div className="media-settings-group">
                    <h4>{t("Ses")}</h4>
                    {kind === "video" && (
                      <label className="media-checkbox">
                        <input
                          type="checkbox"
                          checked={Boolean(item.settings?.muted)}
                          onChange={(e) => change({ muted: e.target.checked })}
                        />
                        {t("Videonun sesini kaldır")}
                      </label>
                    )}
                    {!item.settings?.muted && (
                      <>
                        {kind === "video" ||
                        item.settings?.format === "opus" ? (
                          num("Ses bit hızı (kbps)", "bitrate", 32, 192)
                        ) : (
                          <p className="field-hint">
                            {t(
                              "WAV sıkıştırılmamış PCM ses kullanır; bit hızı ayarı gerekmez.",
                            )}
                          </p>
                        )}
                        <div className="form-group-grid">
                          <label className="input-field">
                            <span>{t("Örnekleme hızı")}</span>
                            <select
                              aria-label={t("Örnekleme hızı")}
                              value={item.settings?.sampleRate}
                              onChange={(e) =>
                                change({ sampleRate: Number(e.target.value) })
                              }
                            >
                              {[
                                ...new Set([
                                  8000,
                                  12000,
                                  16000,
                                  24000,
                                  ...(kind === "audio" &&
                                  item.settings?.format === "wav"
                                    ? [
                                        44100,
                                        ...(source?.sampleRate &&
                                        source.sampleRate <= 48000 &&
                                        source.sampleRate >= 8000
                                          ? [source.sampleRate]
                                          : []),
                                      ]
                                    : []),
                                  48000,
                                ]),
                              ]
                                .sort((a, b) => a - b)
                                .map((rate) => (
                                  <option key={rate} value={rate}>
                                    {rate / 1000} kHz
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label className="input-field">
                            <span>{t("Ses kanalları")}</span>
                            <select
                              aria-label={t("Ses kanalları")}
                              value={item.settings?.channels}
                              onChange={(e) =>
                                change({ channels: Number(e.target.value) })
                              }
                            >
                              <option value={1}>Mono</option>
                              <option value={2}>Stereo</option>
                            </select>
                          </label>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {kind === "image" && (
                  <details className="media-ai-options">
                    <summary>{t("AI görsel inceleme ayarı")}</summary>
                    <p className="field-hint">
                      {t(
                        "Dosya kalitesinden bağımsızdır. Bu ayarı destekleyen AI bağlantılarında görsel inceleme düzeyini belirler; diğer bağlantılar kullanmaz.",
                      )}
                    </p>
                    <label className="input-field">
                      <span>{t("AI inceleme düzeyi")}</span>
                      <select
                        aria-label={t("AI inceleme düzeyi")}
                        value={item.settings?.detail}
                        onChange={(e) =>
                          change({
                            detail: e.target.value as MediaSettings["detail"],
                          })
                        }
                      >
                        <option value="auto">{t("Otomatik")}</option>
                        <option value="low">{t("Düşük")}</option>
                        <option value="high">{t("Yüksek")}</option>
                      </select>
                    </label>
                  </details>
                )}
                <p className="media-cost-hint">
                  {t(
                    "Boyut, ayrıntı, süre ve kare hızı modelin medya maliyetini etkileyebilir. Dosya sıkıştırması tek başına token sayısını garanti etmez.",
                  )}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="modal-actions-footer">
        {(existingBytes > 0 || overLimit) && (
          <div
            className={`media-total-budget ${overLimit ? "is-over-limit" : ""}`}
            role={overLimit ? "alert" : "status"}
          >
            <span>
              {t(
                "Mevcut ekler: {existing} · Seçilenler: {selected} · Toplam: {total} / 16 MB",
                {
                  existing: mediaSize(existingBytes),
                  selected: mediaSize(total),
                  total: mediaSize(messageTotal),
                },
              )}
            </span>
            {overLimit && (
              <strong className="media-error">
                {t("Bir mesajın toplam medya boyutu en fazla 16 MB olmalı.")}
              </strong>
            )}
          </div>
        )}
        {problems.length > 0 && (
          <div className="media-import-problems" role="status">
            <span>
              <AlertCircle size={15} aria-hidden="true" />
              {t("{count} dosyada sorun var. Düzelt veya kaldır.", {
                count: problems.length,
              })}
            </span>
            <button
              type="button"
              onClick={() => {
                setSelected(problems[0].key);
                scroll.current?.scrollTo({ top: 0 });
              }}
            >
              {t("Sorunlu dosyayı aç")}
            </button>
          </div>
        )}
        <button type="button" className="btn-secondary" onClick={onCancel}>
          {t("Vazgeç")}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={
            !items.length || drafts.length !== items.length || overLimit
          }
          onClick={() => {
            handedOff.current = true;
            onAdd(drafts);
          }}
        >
          {t(editDraft ? "Değişiklikleri uygula" : "Mesaja ekle")} ·{" "}
          {mediaSize(total)}
        </button>
      </div>
    </div>
  );
}
