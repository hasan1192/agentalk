import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Vault } from "../electron/vault.mjs";

test("kasa başlangıcı ve anahtarsız kullanım OS sorgusu yapmaz; şifrelemesiz kayıt reddedilir", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentalk-vault-test-"));
  try {
    let checks = 0;
    const vault = new Vault(root, {
      isEncryptionAvailable: () => {
        checks++;
        return false;
      },
    });
    assert.equal(vault.status, null);
    assert.equal(vault.get("fixture"), "");
    vault.set("fixture", "");
    assert.equal(checks, 0);
    assert.throws(
      () => vault.set("fixture", "fixture-not-a-real-key"),
      /Anahtar düz metin olarak kaydedilmedi/,
    );
    assert.equal(checks, 1);
    assert.equal(vault.status, false);
    assert(!fs.existsSync(path.join(root, "vault.json")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("kasa durumu gerçek anahtar işleminde güncellenir; yeniden açılış sorgu yapmadan eski kaydı korur", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentalk-vault-test-"));
  try {
    let checks = 0;
    const cipher = Buffer.from("fixture-cipher");
    const safe = {
      isEncryptionAvailable: () => {
        checks++;
        return true;
      },
      getSelectedStorageBackend: () => "gnome_libsecret",
      encryptString: () => cipher,
      decryptString: (input) => {
        assert.deepEqual(input, cipher);
        return "fixture-not-a-real-key";
      },
    };
    const vault = new Vault(root, safe);
    vault.set("fixture", "fixture-not-a-real-key");
    assert.equal(vault.status, true);
    const saved = fs.readFileSync(path.join(root, "vault.json"), "utf8");
    assert(!saved.includes("fixture-not-a-real-key"));
    const reopened = new Vault(root, safe);
    assert.equal(reopened.status, null);
    assert.equal(checks, 1);
    assert.equal(reopened.get("fixture"), "fixture-not-a-real-key");
    assert.equal(reopened.status, true);
    assert.equal(checks, 2);
    assert.equal(fs.readFileSync(path.join(root, "vault.json"), "utf8"), saved);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
