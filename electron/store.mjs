import { MediaStore } from "./media.mjs";
import { attachmentPlacement } from "../src/message-layout.mjs";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const id = () => randomUUID();
const safeId = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const text = (value, label, limit = 12000) => {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw new Error(`${label} geçersiz veya çok uzun.`);
  return value.trim();
};
export function atomicJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${id()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}
export function visibleTo(message, participantId) {
  return (
    message.from === participantId || message.recipients.includes(participantId)
  );
}
export const defaultRules =
  "Türkçe ve kısa katkılar sun. Yalnızca sana teslim edilen mesajları kullan. Başka katılımcı adına yazma. Yeni katkın yoksa cevap üretme. Kullanıcının yönlendirmesi önceliklidir. Yanıt sonrasında beklemeye dön.";

export function generateBaslaMd(chat, character) {
  return `# Agentalk Dış Ajan Kılavuzu

Bu klasör, Agentalk masasındaki **${character.name}** (\`${character.id}\`) dış ajanına aittir.

## Rol ve Klasör Düzeni

- **\`bridge.json\`**: Güncel bağlantı bilgileri, kimlik belirteci (\`token\`), uç nokta adresi ve geçerli konu kimliği (\`topicId\`). Kimliğinizi ve geçerli konuyu her zaman bu dosyadan okuyun.
- **\`rules/rules.md\`**: Masanın güncel kuralları ve talimatları.
- **\`inbox/\`**: Size teslim edilen mesaj zarfları (\`000001-<id>.json\`).
- **\`outbox/\`**: Masaya göndereceğiniz yanıt ve onay zarfları.
- **\`receipts/\`**: Gönderiminizin kabul/hata makbuzları ve onaylanan son teslimat sırası (\`cursor.json\`).
- **\`quarantine/\`**: Hatalı veya reddedilen zarfların güvenli arşivi.
- **\`context/messages.json\`**: Erişiminize açık güncel sohbet geçmişi.
- **\`presence.json\`**: Uygulamanın yazdığı güncel canlılık durumu. \`online\`, \`state\`, \`lastSeenAt\`, \`expiresAt\` alanlarını içerir; okuma makbuzu değildir.

---

## Önemli Kurallar

1. **Arayüz Kutusu Oturum Sahibine (Kullanıcıya) Aittir**: Agentalk arayüzündeki metin kutusu oturum sahibine aittir. Ajanlar arayüz kutusuna mesaj yazamaz veya kullanıcı adına gönderim yapamaz. Gönderim kanalınız yalnızca \`outbox/\` klasörü veya HTTP uç noktasıdır.
2. **Kimlik Doğrulama**: Gönderen bilgisi istemci alanından değil, doğrulanmış \`token\` ile katılımcı kimliğinizden alınır. Başka katılımcı veya kullanıcı kimliğiyle gönderim yapmayın.
3. **\`cursor.json\` Yeni Mesaj Sayacı Değildir**: \`cursor.json\` yeni mesaj sayısını değil, sizin tarafınızdan en son başarıyla işlenip onaylanan (receipt/ack) teslimat sıra numarasını (\`deliverySequence\`) gösterir. Okunmamış yeni mesajlar doğrudan \`inbox/\` klasöründedir.
4. **Kesintisiz Cursor ve Bekleme**: Teslimat sırası atlanamaz (örn. 1 onaylanmadan 2 onaylanamaz). Yeni katkınız yoksa yanıt üretmeden teslimatı işlenmiş sayabilirsiniz (ack).
5. **Bekleme Döngüsü**: Yanıtın ardından oturumu bitirmeyin. Yeni teslimatı bekleme aracına dönün. Yeni mesaj geldiğinde işleyin, gerektiğinde yanıtlayın, sonra tekrar bekleyin. Kullanıcı durdurunca veya katılımcı devre dışı bırakılınca durun.

---

## Birincil Yöntem: Dosya Akışı

1. **Inbox Teslimatını Oku**:
   \`inbox/\` klasöründeki dosyaları teslimat sırasına göre okuyun (örn. \`000001-<mesaj-id>.json\`). Boş klasörde glob hatalarını önlemek için doğrudan klasör listeleme kullanın.
   Gelen teslimat zarfı şeması:
   \`\`\`json
   {
     "deliverySequence": 1,
     "message": {
       "id": "<mesaj-id>",
       "from": "user",
       "topicId": "<konu-id>",
       "to": ["${character.id}"],
       "content": "Gelen mesaj metni",
       "time": "2026-10-04T00:00:00.000Z"
     }
   }
   \`\`\`

2. **Yanıt Zarfını Hazırla**:
   \`bridge.json\` içindeki güncel \`token\` ve gelen mesajdaki \`topicId\` ile yanıt zarfınızı oluşturun:
   \`\`\`json
   {
     "id": "<kalıcı-gönderim-işlem-kimliği>",
     "token": "<güncel-bridge.json-token>",
     "topicId": "<kaynak-mesaj-topicId>",
     "to": ["user"],
     "replyTo": "<kaynak-mesaj-id>",
     "content": "Somut katkı ve yanıt metni"
   }
   \`\`\`
   *(Not: \`to: ["user"]\` yalnızca oturum sahibine yanıttır; ajanlar arası veya herkes gönderiminde gerçek hedefler veya \`["all"]\` kullanılmalıdır.)*

3. **Taslak Olarak Kaydet ve Atomik Taşı**:
   Yarım dosya okunmasını önlemek için zarfı önce \`outbox/<id>.json.tmp\` olarak kaydedin, ardından atomik taşıma ile \`outbox/<id>.json\` yapın.

4. **Kabul/Hata Makbuzunu Kontrol Et**:
   \`receipts/<id>.json\` dosyasının içeriğini inceleyin:
   - \`status === "accepted"\` ve \`messageId\` alanı varsa gönderim başarıyla kabul edilmiştir.
   - \`status === "error"\` ise hata nedeni ve düzeltme bilgisi verilir. Hatalı dosya \`quarantine/\` klasörüne taşınmıştır.
   *Sırf makbuz dosyasının varlığını başarı saymayın; daima status alanını denetleyin.*

5. **Teslimatı Onayla (Ack) ve Beklemeye Dön**:
   İşlenen teslimatı bildirmek için \`outbox/ack-<sıra-no>.json\` içine \`{"token": "<token>", "deliverySequence": 1}\` yazın veya HTTP \`/receipt\` uç noktasını çağırın.
   Yeni katkınız yoksa yanıt üretmeden teslimatı onaylayıp bekleme döngüsüne dönebilirsiniz.

---

## Alternatif Yöntem: REST API

- \`GET /v1/${chat.id}/${character.id}/inbox\` (Header: \`Authorization: Bearer <token>\`)
- \`POST /v1/${chat.id}/${character.id}/message\` (Header: \`Authorization: Bearer <token>\`, Body: zarf JSON)
- \`POST /v1/${chat.id}/${character.id}/receipt\` (Header: \`Authorization: Bearer <token>\`, Body: \`{"deliverySequence": 1}\`)
- \`POST /v1/${chat.id}/${character.id}/ack\` (Header: \`Authorization: Bearer <token>\`, Body: \`{"deliverySequence": 1}\`)
- \`POST /v1/${chat.id}/${character.id}/heartbeat\` (Header: \`Authorization: Bearer <token>\`, Body: \`{"sessionId": "...", "typing": false}\`)

---

## Canlılık ve görülme

Beklerken en az 10 saniyede bir doğrulanmış \`/heartbeat\` isteği gönderin: \`{"sessionId":"sabit-oturum-kimliğiniz","typing":false}\`. Canlılık 30 saniyede sona erer. Kapanırken aynı oturum kimliğiyle \`{"sessionId":"...","online":false}\` gönderin. \`presence.json\` uygulamanın projeksiyonudur; doğrudan yazmayın. Dosyada açık görünmek mesajı okumuş sayılmaz. İçeriğini gerçekten okuduğunuz mesaj için \`POST /read\` ve \`{"messageId":"..."}\` gönderin. Teslimat işlemesi \`/receipt\` ile ayrıca bildirilir. Gözlem veya dosya indirme okuma olayı oluşturmaz.

## Medya ve belgeler (fotoğraf, ses, video, PDF ve diğer dosyalar)

Gelen \`attachments\` alanı medya kimliği, MIME türü, ad, boyut, süre ve optimizasyon ayarlarını içerir. \`path\`, bu katılımcı klasörüne göre \`media/<id>/<file>\` yoludur. Yalnızca gönderdiğiniz veya size teslim edilmiş medya buraya kopyalanır. Geçmiş medya ve mesajlar \`context/messages.json\` içindedir; bir mesaja yanıt veya doğal dilde eski bir medyaya başvuru geldiğinde erişiminize açık ilgili eki oradan bulun.

Her ekin \`position\` alanı mesaj metnindeki UTF-16 konumudur. \`placement.beforeLine\` / \`afterLine\` 1'den başlayan satır numaralarıdır; \`inline\` aynı satır arasına eklemeyi belirtir. Metni bu konumlarda eklerle birlikte sırayla değerlendirin. Gönderirken her eke \`position\` verebilirsiniz; verilmezse yeni ek metnin sonuna yerleşir. Eski konumsuz mesajlar özgün ek-önce görünümünü korur.

PDF, DOCX, XLSX, PPTX, ODT/ODS/ODP ve UTF-8/UTF-16 metin (TXT, MD, CSV, TSV, JSON, XML, LOG) dosyaları yerelde metne çevrilir. \`document.status\` okuma durumunu; izinli \`textPath\` ise tüm çıkarılmış metni içeren JSON dosyasını gösterir. Önizleme yalnız kısa alıntıdır. Şifreli, bozuk, taranmış, kayıp veya sınırı aşan belgelerde normal konuşmayla başka kopya/metin isteyin; içerik uydurmayın. OCR ve belge içindeki grafik/medya analizi henüz yoktur.

Modeliniz ilgili fotoğraf/ses/video/dosya türünü okuyamıyorsa, normal sohbet yanıtınızda bunu açıkça söyleyin ve uygun metin açıklaması veya transkript isteyin. Hata zarfı göndermeyin; medyayı okumuş gibi içerik uydurmayın. Yanıtın ardından bekleme döngüsüne dönün.

Medya göndermek için dosyayı \`outbox/media/\` altına kaydedin ve zarfınıza \`"attachments": [{"path":"outbox/media/clip.webm", "settings":{"maxSize":640,"fps":1}}]\` ekleyin. Fotoğraf ayarları: maxSize, quality (20–100), format (jpeg/webp/png), detail (low/auto/high). Ses/video: start, duration (en fazla 120 saniye), bitrate, sampleRate, channels; video ayrıca maxSize, fps (0.5–30), quality (18–48), muted. Ayar verilmezse düşük maliyetli varsayılan dönüşüm uygulanır. İçerik boş olabilir. Dönüştürülen dosya en fazla 12 MB, mesaj toplamı 16 MB ve en fazla 6 ektir. Dosya gönderirken gerçek dosya yolunu zarf dışında paylaşmayın. Mutlak yollar, üst klasöre çıkış ve symlink kabul edilmez.

Daha önce görmeye yetkili olduğunuz medyayı \`{"id":"<medya-id>"}\` ekiyle yeniden gönderebilirsiniz. REST ile aynı zarf şeması kullanılır; \`GET /media/<id>\` yalnızca doğrulanmış bu kimliğe ait içeriği döndürür. Dosyayı yerelde okuyamayan ajan aynı endpoint üzerinden indirebilir.

## Hazır Dinleyici Betiği

Agentalk ile birlikte gelen hazır dinleyiciyi şu komutla çalıştırabilirsiniz:
\`\`\`sh
node scripts/folder-agent.mjs "<bu-klasörün-yolu>" listen
\`\`\`
`;
}

export function groupPreferences(data, participantIds) {
  const number = (value, fallback, min, max, label) => {
    const result = value === undefined ? fallback : Number(value);
    if (!Number.isFinite(result) || result < min || result > max)
      throw new Error(`${label} ${min}–${max} aralığında olmalı.`);
    return result;
  };
  const style = (value) =>
    ["concise", "balanced", "detailed"].includes(value) ? value : "balanced";
  const memberPreferences = {};
  for (const pid of participantIds) {
    const pref = data.memberPreferences?.[pid] || {};
    memberPreferences[pid] = {
      replyStyle: style(pref.replyStyle || data.replyStyle),
      respondToPeers: pref.respondToPeers ?? data.respondToPeers ?? true,
    };
    if (typeof memberPreferences[pid].respondToPeers !== "boolean")
      throw new Error("Cevap davranışı geçersiz.");
  }
  return {
    mode: data.mode === "mention_only" ? "mention_only" : "free",
    heartbeatSeconds: number(data.heartbeatSeconds, 1, 0, 60, "Heartbeat"),
    maxParallel: Math.floor(
      number(data.maxParallel, 4, 1, 8, "Eşzamanlı cevap"),
    ),
    maxTurns: Math.floor(number(data.maxTurns, 0, 0, 10000, "Yanıt bütçesi")),
    replyStyle: style(data.replyStyle),
    respondToPeers: data.respondToPeers ?? true,
    memberPreferences,
  };
}

// Photos are normalized by the UI to small PNGs; never persist file paths or SVG.
export function profilePhoto(value = "") {
  if (!value) return "";
  if (
    typeof value !== "string" ||
    value.length > 400000 ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    throw new Error("Geçersiz profil fotoğrafı.");
  const bytes = Buffer.from(value.slice(22), "base64");
  if (
    bytes.length < 24 ||
    !bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.toString("ascii", 12, 16) !== "IHDR" ||
    bytes.readUInt32BE(16) < 1 ||
    bytes.readUInt32BE(20) < 1 ||
    bytes.readUInt32BE(16) > 512 ||
    bytes.readUInt32BE(20) > 512
  )
    throw new Error("Geçersiz profil fotoğrafı.");
  return value;
}

export function validateMediaSupport(value = {}) {
  return Object.fromEntries(
    ["image", "audio", "video"].map((kind) => [
      kind,
      ["auto", "yes", "no"].includes(value?.[kind]) ? value[kind] : "auto",
    ]),
  );
}
export function validateMediaOutput(value) {
  return ["text", "image", "audio"].includes(value) ? value : "text";
}

export class Store {
  constructor(root, onChange = () => {}) {
    this.root = root;
    this.media = new MediaStore(root);
    this.presences = new Map();
    this.onChange = onChange;
    this.state = {
      chats: [],
      characters: [],
      connections: [],
      messages: [],
      runs: [],
      selectedChatId: "",
    };
    this.events = [];
    this.file = path.join(root, "_system", "events.jsonl");
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.file)) {
      const raw = fs.readFileSync(this.file, "utf8");
      if (raw && !raw.endsWith("\n"))
        throw new Error(
          "Olay kaydı yarım kalmış. Yazma durduruldu; kayıt kurtarma gerekiyor.",
        );
      raw
        .split("\n")
        .filter(Boolean)
        .forEach((line, index) => {
          const event = JSON.parse(line);
          if (event.sequence !== index + 1 || event.schemaVersion !== 1)
            throw new Error("Olay sırası bozuk. Yazma durduruldu.");
          this.events.push(event);
          this.apply(event);
        });
    }
    // The journal is authoritative. Projections can be recreated after interrupted delivery.
    this.project();
    for (const run of [...this.state.runs]) {
      if (run.status === "running")
        this.append("run.updated", {
          id: run.id,
          status: "error",
          error:
            "Uygulama üretim sırasında kapandı. Tekrar denemek için yeniden kuyruğa al.",
        });
    }
    // Upgrade scheduling preferences through new control events, preserving history.
    for (const chat of [...this.state.chats]) {
      if (chat.kind === "direct" && chat.observer)
        this.append("chat.updated", { id: chat.id, observer: false });
      if (chat.mode === "round_robin" || chat.deliberationEnabled)
        this.append("chat.updated", {
          id: chat.id,
          mode: "free",
          deliberationEnabled: false,
        });
    }
  }
  apply(event) {
    // Retired board events remain in the journal for backwards compatibility.
    if (["decision.created", "decision.updated"].includes(event.type)) return;
    const d = event.data;
    if (event.type === "preferences.sidebar") this.state.sidebarOrder = d;
    if (event.type === "preferences.language") this.state.language = d.language;
    const mapping = {
      "chat.created": "chats",
      "character.created": "characters",
      "connection.created": "connections",
      "message.accepted": "messages",
      "run.created": "runs",
    };
    const updates = {
      "chat.updated": "chats",
      "character.updated": "characters",
      "connection.updated": "connections",
      "run.updated": "runs",
    };
    if (mapping[event.type]) this.state[mapping[event.type]].push(d);
    if (updates[event.type]) {
      const entity = this.state[updates[event.type]].find((x) => x.id === d.id);
      if (!entity)
        throw new Error(`Güncellenecek kayıt bulunamadı: ${event.type}`);
      Object.assign(entity, d);
    }
    if (event.type === "connection.deleted") {
      this.state.connections = this.state.connections.filter(
        (x) => x.id !== d.id,
      );
    }
    if (event.type === "message.deleted") {
      const msg = this.state.messages.find((m) => m.id === d.id);
      if (msg) {
        msg.deleted = true;
        msg.deletedAt = event.time;
        msg.content = "Bu mesaj silindi.";
      }
    }
    if (event.type === "message.read") {
      const msg = this.state.messages.find((m) => m.id === d.messageId);
      if (msg) {
        msg.readTimes = msg.readTimes || {};
        msg.readTimes[d.participantId] = d.time;
      }
    }
    if (event.type === "chat.updated" && d.participantIds) {
      for (const pid of d.participantIds) {
        for (const msg of this.state.messages) {
          if (
            msg.chatId === d.id &&
            msg.to.includes("all") &&
            !msg.recipients.includes(pid) &&
            msg.from !== pid &&
            !msg.deleted
          ) {
            msg.recipients.push(pid);
          }
        }
      }
    }
    if (event.type === "chat.selected") this.state.selectedChatId = d.id;
  }
  append(type, data) {
    const event = {
      schemaVersion: 1,
      id: id(),
      sequence: this.events.length + 1,
      time: new Date().toISOString(),
      type,
      data,
    };
    const fd = fs.openSync(this.file, "a", 0o600);
    try {
      fs.writeSync(fd, `${JSON.stringify(event)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    this.events.push(event);
    this.apply(event);
    this.project();
    this.onChange();
    return data;
  }
  chat(chatId) {
    const chat = this.state.chats.find((x) => x.id === chatId);
    if (!chat) throw new Error("Masa bulunamadı.");
    return chat;
  }
  character(characterId) {
    const c = this.state.characters.find((x) => x.id === characterId);
    if (!c) throw new Error("Karakter bulunamadı.");
    return c;
  }
  participantPath(chatId, participantId) {
    if (!safeId(chatId) || !safeId(participantId))
      throw new Error("Geçersiz klasör kimliği.");
    const chat = this.chat(chatId);
    if (
      participantId !== "user" &&
      !chat.participantIds.includes(participantId)
    )
      throw new Error("Bu masanın katılımcısı değil.");
    return path.join(this.root, "chats", chatId, "participants", participantId);
  }
  createChat(data, allowArchived = false) {
    const participantIds = [...new Set(data.participantIds ?? [])];
    participantIds.forEach((x) => {
      if (
        this.character(x).deleted ||
        (!allowArchived && this.character(x).archived)
      )
        throw new Error("Silinmiş kişi gruba eklenemez.");
    });
    if (!participantIds.length)
      throw new Error("Grup oluşturmadan önce en az bir kayıtlı kişi seç.");
    const kind = data.kind === "direct" ? "direct" : "group";
    if (kind === "direct" && participantIds.length !== 1)
      throw new Error("Birebir sohbet tek kişiyle açılır.");
    const preferences = groupPreferences(data, participantIds);
    const chat = this.append("chat.created", {
      id: id(),
      name: text(data.name, "Masa adı", 100),
      photo: profilePhoto(data.photo),
      description: (data.description ?? "").slice(0, 500),
      rules: text(data.rules || defaultRules, "Kurallar"),
      participantIds,
      status: "open",
      waiting: true,
      observer: false,
      kind,
      ...preferences,
      turnCount: 0,
      deliberationEnabled: false,
      topicId: id(),
      createdAt: new Date().toISOString(),
    });
    this.append("chat.selected", { id: chat.id });
    return chat;
  }
  updateGroup(data) {
    const chat = this.chat(data.id);
    if (chat.observer || chat.status !== "open")
      throw new Error("Önce açık sohbetin yazışmasına dön.");
    return this.append("chat.updated", {
      id: chat.id,
      name: text(data.name || chat.name, "Grup adı", 100),
      description: String(data.description ?? chat.description).slice(0, 500),
      photo: profilePhoto(data.photo ?? chat.photo),
      rules: text(data.rules || chat.rules, "Kurallar"),
      ...groupPreferences({ ...chat, ...data }, chat.participantIds),
      deliberationEnabled: false,
    });
  }
  createCharacter(data) {
    const kind = data.kind === "folder" ? "folder" : "api";
    if (data.chatId) {
      const target = this.chat(data.chatId);
      if (target.status !== "open" || target.observer)
        throw new Error("Önce açık masanın yazışmasına dön.");
    }
    if (
      kind === "api" &&
      !this.state.connections.some((x) => x.id === data.connectionId)
    )
      throw new Error("Önce bir bağlantı seç.");
    const c = this.append("character.created", {
      id: id(),
      name: text(data.name, "Karakter adı", 60),
      photo: profilePhoto(data.photo),
      archived: false,
      role: text(data.role || "Dengeli değerlendirici", "Rol", 200),
      color: /^#[a-f\d]{6}$/i.test(data.color) ? data.color : "#7b8b75",
      instructions: text(
        data.instructions ||
          "Seçenekleri değerlendir, kısa ve somut katkılar sun.",
        "Talimatlar",
      ),
      kind,
      connectionId: kind === "api" ? data.connectionId : "",
      model: kind === "api" ? text(data.model, "Model", 200) : "",
      enabled: true,
      version: Number.isInteger(data.version) ? Math.max(1, data.version) : 1,
      mediaSupport: validateMediaSupport(data.mediaSupport),
      mediaOutput: validateMediaOutput(data.mediaOutput),
      contextBudget: Math.max(
        4000,
        Math.min(500000, Number(data.contextBudget) || 40000),
      ),
    });
    if (data.chatId) {
      const chat = this.chat(data.chatId);
      if (chat.status !== "open")
        throw new Error("Kapalı masaya karakter eklenemez.");
      this.append("chat.updated", {
        id: chat.id,
        participantIds: [...chat.participantIds, c.id],
      });
    }
    return c;
  }
  reorderSidebar(section, ids) {
    if (!["people", "groups"].includes(section) || !Array.isArray(ids))
      throw new Error("Geçersiz sıralama.");
    const entities =
      section === "people"
        ? this.state.characters
        : this.state.chats.filter((c) => c.kind !== "direct");
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id) => !entities.some((c) => c.id === id && !c.deleted))
    )
      throw new Error("Geçersiz sıralama.");
    return this.append("preferences.sidebar", {
      ...this.state.sidebarOrder,
      [section]: ids,
    });
  }
  archiveCharacter(characterId, value) {
    const c = this.character(characterId);
    if (c.deleted) throw new Error("Silinmiş kişi düzenlenemez.");
    if (Boolean(c.archived) === Boolean(value)) return c;
    this.append("character.updated", {
      id: c.id,
      archived: Boolean(value),
      enabled: value ? false : (c.enabledBeforeArchive ?? true),
      enabledBeforeArchive: value ? c.enabled : c.enabledBeforeArchive,
    });
    for (const chat of this.state.chats.filter(
      (x) =>
        !x.deleted && x.kind === "direct" && x.participantIds.includes(c.id),
    )) {
      if (value && chat.status === "open")
        this.append("chat.updated", {
          id: chat.id,
          status: "closed",
          waiting: false,
          archivedByPerson: true,
        });
      else if (!value && chat.archivedByPerson)
        this.append("chat.updated", {
          id: chat.id,
          status: "open",
          waiting: true,
          archivedByPerson: false,
        });
    }
    return c;
  }
  cloneGroup(chatId, name) {
    const source = this.chat(chatId);
    if (source.kind === "direct" || source.deleted)
      throw new Error("Geçersiz grup.");
    return this.createChat(
      {
        ...source,
        name,
        participantIds: source.participantIds.filter(
          (pid) => !this.character(pid).deleted,
        ),
      },
      true,
    );
  }
  deleteChat(chatId) {
    const chat = this.chat(chatId);
    if (chat.observer) throw new Error("Gözlem görünümü salt okunur.");
    this.append("chat.updated", {
      id: chat.id,
      deleted: true,
      status: "closed",
      waiting: false,
    });
    if (this.state.selectedChatId === chat.id)
      this.append("chat.selected", { id: "" });
  }
  deleteCharacter(characterId) {
    const character = this.character(characterId);
    if (
      this.state.chats.some(
        (c) =>
          !c.deleted &&
          c.status === "open" &&
          c.observer &&
          c.participantIds.includes(characterId),
      )
    )
      throw new Error("Önce bu kişinin bulunduğu gruplarda gözlemden çık.");
    this.append("character.updated", {
      id: character.id,
      deleted: true,
      enabled: false,
    });
    for (const chat of this.state.chats.filter(
      (c) => c.kind === "direct" && c.participantIds.includes(characterId),
    ))
      this.deleteChat(chat.id);
    for (const chat of this.state.chats.filter(
      (c) => c.kind !== "direct" && c.participantIds.includes(characterId),
    ))
      this.append("chat.updated", {
        id: chat.id,
        participantIds: chat.participantIds.filter(
          (pid) => pid !== characterId,
        ),
      });
  }
  acceptMessage(sender, data) {
    const chat = this.chat(data.chatId);
    if (chat.status !== "open")
      throw new Error("Bu masa kapalı. Yeni masa oluştur.");
    if (sender !== "user" && !chat.participantIds.includes(sender))
      throw new Error("Gönderen bu masaya bağlı değil.");
    if (sender !== "user" && this.character(sender).deleted)
      throw new Error("Silinmiş kişi mesaj gönderemez.");
    if (sender !== "user" && (!chat.waiting || !this.character(sender).enabled))
      throw new Error("Konuşma veya kişi durduruldu; yanıt yayınlanmadı.");
    if (sender === "user" && chat.observer)
      throw new Error("Gözlem görünümü salt okunur. Yazışmaya dön.");
    if (data.topicId && data.topicId !== chat.topicId)
      throw new Error("Eski konuya ait mesaj yayınlanmadı.");
    const messageId = data.id || id();
    if (!safeId(messageId)) throw new Error("Geçersiz mesaj kimliği.");
    if (
      data.attachments !== undefined &&
      (!Array.isArray(data.attachments) || data.attachments.length > 6)
    )
      throw new Error("Bir mesajda en fazla 6 medya eki olabilir.");
    const refs = data.attachments || [];
    const content =
      refs.length &&
      (data.content === undefined ||
        (typeof data.content === "string" && data.content.length <= 50000))
        ? data.content || ""
        : (text(data.content, "Mesaj", 50000), data.content);
    const positions = refs.map((ref) => ref.position ?? content.length);
    if (
      positions.some(
        (p) =>
          !Number.isInteger(p) ||
          p < 0 ||
          p > content.length ||
          (p > 0 &&
            /[\uD800-\uDBFF]/.test(content[p - 1]) &&
            /[\uDC00-\uDFFF]/.test(content[p])),
      )
    )
      throw new Error("Dosyanın mesaj içindeki konumu geçersiz.");
    const to = [...new Set(data.to ?? ["all"])];
    const allowed = ["user", ...chat.participantIds];
    if (
      !to.length ||
      to.some((x) => x !== "all" && !allowed.includes(x)) ||
      (to.includes("all") && to.length !== 1)
    )
      throw new Error("Geçersiz alıcı.");
    const replyTo = data.replyTo || null;
    const old = this.state.messages.find((x) => x.id === messageId);
    if (old) {
      if (
        old.chatId === chat.id &&
        old.from === sender &&
        old.content === content &&
        old.replyTo === replyTo &&
        JSON.stringify(old.to) === JSON.stringify(to) &&
        JSON.stringify((old.attachments || []).map((a) => a.id)) ===
          JSON.stringify(refs.map((a) => a.id)) &&
        refs.every(
          (a, i) => !a.version || a.version === old.attachments?.[i]?.version,
        ) &&
        positions.every(
          (p, i) =>
            (refs[i].position === undefined &&
              old.attachments?.[i]?.position === undefined) ||
            p === (old.attachments?.[i]?.position ?? 0),
        ) &&
        (old.mediaRequestHash || "") === (data.mediaRequestHash || "")
      )
        return old;
      throw new Error("Aynı mesaj kimliği farklı içerikle kullanılamaz.");
    }
    if (replyTo) {
      const original = this.state.messages.find(
        (x) => x.id === replyTo && x.chatId === chat.id,
      );
      if (!original || !visibleTo(original, sender))
        throw new Error("Cevap ilişkisi izinli bir mesaja ait olmalı.");
      if (original.deleted)
        throw new Error("Silinmiş bir mesaja yanıt verilemez.");
    }
    const attachments = refs.map((ref, i) => ({
      ...this.media.resolve(
        chat.id,
        sender,
        ref,
        (id) => this.canReadMedia(chat.id, sender, id),
        chat.topicId,
      ),
      position: positions[i],
      placement: attachmentPlacement(content, positions[i]),
    }));
    if (new Set(attachments.map((a) => a.id)).size !== attachments.length)
      throw new Error("Aynı medya iki kez eklenemez.");
    if (attachments.reduce((sum, a) => sum + a.bytes, 0) > 16 * 1024 * 1024)
      throw new Error("Bir mesajın toplam medya boyutu en fazla 16 MB olmalı.");
    for (const a of attachments)
      this.media.promote(chat.id, sender, { ...a, topicId: chat.topicId });
    const now = new Date().toISOString();
    const recipients = (to.includes("all") ? allowed : to).filter(
      (x) => x !== sender,
    );
    const deliveredTimes = Object.fromEntries(recipients.map((r) => [r, now]));
    const readTimes = { [sender]: now };
    const accepted = this.append("message.accepted", {
      id: messageId,
      chatId: chat.id,
      topicId: chat.topicId,
      from: sender,
      to,
      replyTo,
      content,
      ...(attachments.length ? { attachments } : {}),
      ...(data.mediaRequestHash
        ? { mediaRequestHash: data.mediaRequestHash }
        : {}),
      time: now,
      sequence:
        this.state.messages.filter((x) => x.chatId === chat.id).length + 1,
      recipients,
      deliveredTimes,
      readTimes,
      deleted: false,
    });
    if (sender !== "user") {
      const nextTurn = (chat.turnCount || 0) + 1;
      const budgetExceeded = chat.maxTurns > 0 && nextTurn >= chat.maxTurns;
      this.append("chat.updated", {
        id: chat.id,
        turnCount: nextTurn,
        ...(budgetExceeded ? { waiting: false } : {}),
      });
    }
    return accepted;
  }
  canReadMedia(chatId, participantId, mediaId, observer = false) {
    return this.state.messages.some(
      (m) =>
        m.chatId === chatId &&
        !m.deleted &&
        (visibleTo(m, participantId) ||
          (participantId === "user" &&
            observer &&
            this.chat(chatId).observer)) &&
        m.attachments?.some((a) => a.id === mediaId),
    );
  }
  mediaForParticipant(message, pid) {
    return {
      ...message,
      ...(message.attachments?.length
        ? {
            attachments: message.attachments.map((a) => ({
              ...a,
              path: `media/${a.id}/${a.file}`,
              ...(a.kind === "document" && a.document?.status === "ready"
                ? { textPath: `media/${a.id}/document.json` }
                : {}),
            })),
          }
        : {}),
    };
  }
  setPresence(chatId, participantId, patch) {
    const key = `${chatId}:${participantId}`;
    const previous = this.presences.get(key);
    const value = {
      schemaVersion: 1,
      chatId,
      participantId,
      online: false,
      state: "offline",
      lastSeenAt: null,
      expiresAt: null,
      ...previous,
      ...patch,
    };
    if (JSON.stringify(previous) === JSON.stringify(value)) return;
    this.presences.set(key, value);
    atomicJSON(
      path.join(this.participantPath(chatId, participantId), "presence.json"),
      value,
    );
  }
  presence(chatId, participantId) {
    const value = this.presences.get(`${chatId}:${participantId}`);
    return (
      value || {
        schemaVersion: 1,
        chatId,
        participantId,
        online: false,
        state: "offline",
        lastSeenAt: null,
        expiresAt: null,
      }
    );
  }
  deleteMessage(chatId, messageId, requestedBy = "user") {
    const chat = this.chat(chatId);
    if (requestedBy === "user" && chat.observer)
      throw new Error("Gözlem görünümü salt okunur.");
    const msg = this.state.messages.find(
      (m) => m.id === messageId && m.chatId === chatId,
    );
    if (!msg) throw new Error("Mesaj bulunamadı.");
    if (msg.deleted) return msg;
    this.append("message.deleted", {
      id: messageId,
      chatId,
    });
    return msg;
  }
  markRead(chatId, participantId, messageId) {
    const chat = this.chat(chatId);
    if (participantId === "user" && chat.observer)
      throw new Error("Gözlem görünümü salt okunur.");
    const msg = this.state.messages.find(
      (m) => m.id === messageId && m.chatId === chatId,
    );
    if (!msg) throw new Error("Mesaj bulunamadı.");
    if (!visibleTo(msg, participantId))
      throw new Error("Bu mesaja erişim yetkiniz yok.");
    if (msg.readTimes && msg.readTimes[participantId]) return;
    return this.append("message.read", {
      chatId,
      participantId,
      messageId,
      time: new Date().toISOString(),
    });
  }
  inbox(chatId, participantId) {
    this.participantPath(chatId, participantId);
    return this.state.messages
      .filter(
        (x) =>
          x.chatId === chatId &&
          x.recipients.includes(participantId) &&
          !x.deleted,
      )
      .map((m, index) => ({
        deliverySequence: index + 1,
        message: this.mediaForParticipant(m, participantId),
      }));
  }
  receipt(chatId, participantId, sequence) {
    const entries = this.inbox(chatId, participantId);
    const previous =
      this.events
        .filter(
          (x) =>
            x.type === "delivery.processed" &&
            x.data.chatId === chatId &&
            x.data.participantId === participantId,
        )
        .at(-1)?.data.deliverySequence ?? 0;
    if (
      !Number.isInteger(sequence) ||
      sequence !== previous + 1 ||
      !entries.some((x) => x.deliverySequence === sequence)
    )
      throw new Error("Teslim sırası atlanamaz.");
    this.append("delivery.processed", {
      chatId,
      participantId,
      deliverySequence: sequence,
    });
  }
  project() {
    for (const chat of this.state.chats) {
      const dir = path.join(this.root, "chats", chat.id);
      atomicJSON(path.join(dir, "chat.json"), chat);
      fs.mkdirSync(path.join(dir, "rules", "v1"), { recursive: true });
      fs.writeFileSync(path.join(dir, "rules", "v1", "rules.md"), chat.rules, {
        mode: 0o600,
      });
      for (const pid of ["user", ...chat.participantIds]) {
        const pdir = this.participantPath(chat.id, pid);
        for (const name of [
          "inbox",
          "outbox",
          "receipts",
          "quarantine",
          "context",
          "rules",
          "media",
          "outbox/media",
        ])
          fs.mkdirSync(path.join(pdir, name), { recursive: true, mode: 0o700 });
        const char =
          pid === "user"
            ? { id: "user", name: "Sen", kind: "user" }
            : this.character(pid);
        atomicJSON(path.join(pdir, "profile.json"), char);
        atomicJSON(
          path.join(pdir, "presence.json"),
          this.presence(chat.id, pid),
        );
        fs.writeFileSync(path.join(pdir, "rules", "rules.md"), chat.rules, {
          mode: 0o600,
        });
        if (pid !== "user" && char.kind === "folder") {
          fs.writeFileSync(
            path.join(pdir, "BASLA.md"),
            generateBaslaMd(chat, char),
            { mode: 0o600 },
          );
        }
        const visibleMedia = this.state.messages
          .filter(
            (m) => m.chatId === chat.id && !m.deleted && visibleTo(m, pid),
          )
          .flatMap((m) => m.attachments || []);
        for (const attachment of visibleMedia) {
          const dest = path.join(pdir, "media", attachment.id, attachment.file);
          if (!fs.existsSync(dest)) {
            fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
            let source;
            try {
              source = this.media.file(chat.id, attachment.id);
            } catch (e) {
              if (e.code === "ENOENT") continue;
              throw e;
            }
            if (!fs.existsSync(source)) continue;
            fs.copyFileSync(source, dest);
            fs.chmodSync(dest, 0o600);
          }
          if (attachment.kind === "document") {
            const source = path.join(
              this.media.assetDir(chat.id, attachment.id),
              "document.json",
            );
            const target = path.join(
              pdir,
              "media",
              attachment.id,
              "document.json",
            );
            if (fs.existsSync(source) && !fs.existsSync(target))
              fs.copyFileSync(source, target);
          }
        }
        this.inbox(chat.id, pid).forEach((delivery) => {
          const file = path.join(
            pdir,
            "inbox",
            `${String(delivery.deliverySequence).padStart(6, "0")}-${delivery.message.id}.json`,
          );
          if (!fs.existsSync(file)) atomicJSON(file, delivery);
        });
        atomicJSON(
          path.join(pdir, "context", "messages.json"),
          this.state.messages
            .filter(
              (x) => x.chatId === chat.id && visibleTo(x, pid) && !x.deleted,
            )
            .map((x) => {
              if (x.replyTo) {
                const orig = this.state.messages.find(
                  (m) => m.id === x.replyTo,
                );
                return {
                  ...this.mediaForParticipant(x, pid),
                  replyQuote: orig
                    ? orig.deleted
                      ? "[Bu mesaj silindi]"
                      : visibleTo(orig, pid)
                        ? orig.content.slice(0, 150)
                        : "[Özel mesaj içeriği]"
                    : null,
                };
              }
              return this.mediaForParticipant(x, pid);
            }),
        );
        const processed = this.events.filter(
          (e) =>
            e.type === "delivery.processed" &&
            e.data.chatId === chat.id &&
            e.data.participantId === pid,
        );
        atomicJSON(path.join(pdir, "receipts", "cursor.json"), {
          deliverySequence: processed.at(-1)?.data.deliverySequence ?? 0,
          description:
            "Son başarıyla işlenen teslimat sıra numarası (deliverySequence). Yeni mesaj sayısı DEĞİLDİR. Yeni mesajlar inbox/ klasöründedir.",
        });
      }
      const localEvents = this.events.filter(
        (e) =>
          e.data.chatId === chat.id ||
          (e.data.id === chat.id && e.type.startsWith("chat.")),
      );
      fs.mkdirSync(path.join(dir, "_system"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "_system", "events.jsonl"),
        localEvents.map((e) => JSON.stringify(e)).join("\n") + "\n",
        { mode: 0o600 },
      );
    }
  }
}
