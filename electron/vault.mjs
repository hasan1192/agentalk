import fs from "node:fs";
import path from "node:path";
import { atomicJSON } from "./store.mjs";

export class Vault {
  constructor(root, safeStorage) {
    this.safe = safeStorage;
    this.status = null;
    this.file = path.join(root, "vault.json");
    this.data = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, "utf8"))
      : {};
  }
  available() {
    this.status =
      this.safe.isEncryptionAvailable() &&
      (process.platform !== "linux" ||
        this.safe.getSelectedStorageBackend() !== "basic_text");
    return this.status;
  }
  set(id, key) {
    if (!key) {
      if (this.data[id]) {
        delete this.data[id];
        atomicJSON(this.file, this.data);
      }
      return;
    }
    if (!this.available())
      throw new Error(
        "İşletim sistemi anahtar kasası kullanılamıyor. Anahtar düz metin olarak kaydedilmedi.",
      );
    this.data[id] = this.safe.encryptString(key).toString("base64");
    atomicJSON(this.file, this.data);
  }
  delete(id) {
    if (this.data[id]) {
      delete this.data[id];
      atomicJSON(this.file, this.data);
    }
  }
  get(id) {
    if (!this.data[id]) return "";
    if (!this.available())
      throw new Error("Anahtar kasası şu anda açılamıyor.");
    return this.safe.decryptString(Buffer.from(this.data[id], "base64"));
  }
}
