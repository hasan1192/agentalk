import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { errorGuidance } from "../src/error-guidance.mjs";

test("HTTP açıklamaları doğrulama, izin, kota ve geçici sunucu hatalarını ayırır", () => {
  for (const [status, word] of [
    [400, "isteği"],
    [401, "anahtarı"],
    [403, "izni"],
    [404, "bulunamadı"],
    [408, "yanıt"],
    [413, "büyük"],
    [415, "isteği"],
    [422, "isteği"],
    [429, "sınırına"],
    [500, "Sağlayıcı"],
    [503, "Sağlayıcı"],
    [504, "yanıt"],
  ]) {
    const result = errorGuidance(
      `Error invoking remote method 'agentalk:command': Error: Sunucu HTTP ${status} döndürdü. Modeli ve bağlantı ayarlarını kontrol et.`,
    );
    assert(result?.title.includes(word), String(status));
    assert(result.cause && result.action);
  }
  assert.match(
    errorGuidance("Sunucu HTTP 400 döndürdü. Ayrıntı.").cause,
    /kesin nedeni belirtmez/,
  );
  assert.doesNotMatch(
    errorGuidance("Sunucu HTTP 429 döndürdü. Ayrıntı.").action,
    /otomatik/,
  );
});

test("bilinmeyen hatada neden uydurulmaz ve sağlayıcı metni açıklamaya kopyalanmaz", () => {
  assert.equal(errorGuidance("Kullanıcı metni: HTTP 401"), null);
  assert.equal(errorGuidance("Belirsiz bir hata"), null);
  const details = errorGuidance("Sunucu HTTP 401 döndürdü. gizli-test-değeri");
  assert(!JSON.stringify(details).includes("gizli-test-değeri"));
  assert.match(
    errorGuidance(
      "İşletim sistemi anahtar kasası kullanılamıyor. Anahtar düz metin olarak kaydedilmedi.",
    ).cause,
    /düz metin/,
  );
  assert.match(
    errorGuidance(
      "Bağlam 30.000 karakter; ayarlanan 20.000 sınırını aşıyor. Mesajlar kırpılmadı.",
    ).action,
    /bağlam bütçesini artır/,
  );
});

test("boş dosya, büyük dosyadan ayrılır ve küçültme önerilmez", () => {
  const empty = errorGuidance(
    "Error invoking remote method 'agentalk:media:stage': Error: Dosya boş. İçerik bulunan bir dosya seç.",
  );
  assert.equal(empty.title, "Dosya boş");
  assert.match(empty.cause, /0 bayt/);
  assert.doesNotMatch(empty.action, /küçült|100 MB/);
  const large = errorGuidance("Medya dosyası en fazla 100 MB olmalı.");
  assert.notEqual(large.title, empty.title);
  assert.match(large.action, /küçült/);
});

test("animasyonlu WebP reddi bozuk dosya hatası gibi sunulmaz", () => {
  const notice = errorGuidance(
    "Animasyonlu WebP desteklenmiyor. Statik WebP, PNG veya GIF kopyası ekle.",
  );
  assert.equal(notice.title, "Animasyonlu WebP desteklenmiyor");
  assert.match(notice.cause, /bozuk olduğu anlamına gelmez/);
  assert.match(notice.action, /Statik WebP, PNG veya GIF/);
});

test("yeni hata açıklamaları bütün arayüz dillerinde bulunur", () => {
  const source = fs.readFileSync(
    new URL("../src/error-guidance.mjs", import.meta.url),
    "utf8",
  );
  const keys = [...source.matchAll(/(?:title|cause|action): "([^"]+)"/g)].map(
    (match) => match[1],
  );
  for (const language of ["en", "de"]) {
    const catalog = JSON.parse(
      fs.readFileSync(
        new URL(`../src/locales/${language}.json`, import.meta.url),
        "utf8",
      ),
    );
    for (const key of keys) assert(catalog[key], `${language}: ${key}`);
  }
});
