import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveLocale, translate } from "../src/locale.mjs";
const catalogs = Object.fromEntries(
  ["en", "de"].map((locale) => [
    locale,
    JSON.parse(
      fs.readFileSync(
        new URL(`../src/locales/${locale}.json`, import.meta.url),
        "utf8",
      ),
    ),
  ]),
);
test("sistem dili bölgesel kodları destekler, bilinmeyen dil İngilizceye düşer", () => {
  assert.equal(resolveLocale("tr-TR"), "tr");
  assert.equal(resolveLocale("de_AT"), "de");
  assert.equal(resolveLocale("en-GB"), "en");
  assert.equal(resolveLocale("ja-JP"), "en");
  assert.equal(resolveLocale(undefined), "en");
});
test("çeviriler değişkenleri ve kullanıcı metnini korur; eksik çeviri İngilizceye düşer", () => {
  assert.equal(
    translate(catalogs, "de", "{names} yazıyor…", { names: "Ada {name}" }),
    "Ada {name} schreibt…",
  );
  assert.equal(
    translate({ en: { Dil: "Language" }, de: {} }, "de", "Dil"),
    "Language",
  );
  assert.equal(
    translate(catalogs, "tr", "{names} yazıyor…", { names: "Ada" }),
    "Ada yazıyor…",
  );
  assert.equal(
    translate(catalogs, "en", "Kullanıcının özel metni"),
    "Kullanıcının özel metni",
  );
});
test("dil katalogları aynı anahtarları ve yer tutucuları içerir", () => {
  assert.deepEqual(
    Object.keys(catalogs.en).sort(),
    Object.keys(catalogs.de).sort(),
  );
  for (const [locale, catalog] of Object.entries(catalogs))
    for (const [key, value] of Object.entries(catalog)) {
      assert(value.trim(), `${locale}: ${key}`);
      const placeholders = (text) =>
        [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      assert.deepEqual(
        placeholders(value),
        placeholders(key),
        `${locale}: ${key}`,
      );
    }
});
