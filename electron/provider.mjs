import {
  MediaUnsupported,
  assertMediaSupported,
  wireMessages,
  mediaIndex,
  selectMedia,
  decodeDataUrl,
  pcmWav,
} from "./media-provider.mjs";
import { messagePieces } from "../src/message-layout.mjs";
export function validateConnection(input) {
  let url;
  try {
    url = new URL(input.baseUrl);
  } catch {
    throw new Error("Geçerli bir sunucu adresi gir.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Adres yalnızca HTTP/HTTPS ve anahtarsız olmalı.");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (input.kind === "local" && !loopback)
    throw new Error(
      "Bu bilgisayar bağlantısı için localhost veya loopback adresi kullan.",
    );
  if (input.kind === "cloud" && url.protocol !== "https:")
    throw new Error("Bulut bağlantısı HTTPS kullanmalı.");
  return {
    name: String(input.name || "")
      .trim()
      .slice(0, 80),
    baseUrl: url.href.replace(/\/$/, ""),
    kind: ["local", "network", "cloud"].includes(input.kind)
      ? input.kind
      : "local",
    adapter: ["ollama", "anthropic", "gemini", "compatible"].includes(
      input.adapter,
    )
      ? input.adapter
      : "compatible",
    concurrency: Math.max(
      1,
      Math.min(8, Math.floor(Number(input.concurrency) || 1)),
    ),
    models: [],
  };
}

async function request(connection, route, key, options = {}) {
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(180000)])
    : AbortSignal.timeout(15000);
  let result;

  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (connection.adapter === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    if (key) headers["x-api-key"] = key;
  } else if (connection.adapter === "gemini") {
    if (key) headers["x-goog-api-key"] = key;
  } else {
    if (key) headers["Authorization"] = `Bearer ${key}`;
  }

  if (connection.baseUrl && connection.baseUrl.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = "https://agentalk.app";
    headers["X-Title"] = "Agentalk";
  }

  try {
    result = await fetch(`${connection.baseUrl}${route}`, {
      ...options,
      signal,
      redirect: "error",
      headers,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error(
      "Sunucuya ulaşılamadı veya istek zaman aşımına uğradı. Adresi ve sunucuyu kontrol et.",
    );
  }
  if (!result.ok) {
    if (options.mediaKinds?.length && [400, 415, 422].includes(result.status)) {
      const body = (await result.text()).slice(0, 12000);
      if (
        /image|vision|audio|video|multimodal|mime|media|modalit|content.?type|unsupported.?content/i.test(
          body,
        )
      )
        throw new MediaUnsupported(
          options.mediaKinds,
          options.outputMedia ? "output" : "unsupported",
        );
    }
    const error = new Error(
      `Sunucu HTTP ${result.status} döndürdü. ${
        result.status === 429
          ? "Hız sınırı; kısa bir bekleme sonrası yeniden denenecek."
          : result.status === 401 || result.status === 403
            ? "Kimlik doğrulamayı kontrol et (API anahtarının geçerliliğini ve yetkilerini incele)."
            : "Modeli ve bağlantı ayarlarını kontrol et."
      }`,
    );
    error.status = result.status;
    throw error;
  }
  try {
    return await result.json();
  } catch {
    throw new Error("Sunucu geçerli JSON döndürmedi.");
  }
}

export async function discoverModels(connection, key) {
  const models = [];
  const capabilities = {};
  let cursor = "";
  const seen = new Set();
  for (let page = 0; page < 100; page++) {
    const route =
      connection.adapter === "ollama"
        ? "/api/tags"
        : connection.adapter === "gemini"
          ? `/models?pageSize=100${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ""}`
          : connection.adapter === "anthropic"
            ? `/models?limit=100${cursor ? `&after_id=${encodeURIComponent(cursor)}` : ""}`
            : "/models";
    const data = await request(connection, route, key);
    const raw =
      connection.adapter === "ollama" || connection.adapter === "gemini"
        ? data.models
        : (data.data ?? data.models);
    if (!Array.isArray(raw))
      throw new Error(
        "Sunucunun model listesi tanınmadı. Model kimliğini elle girebilirsin.",
      );
    for (const item of raw) {
      if (
        connection.adapter === "gemini" &&
        (!Array.isArray(item.supportedGenerationMethods) ||
          !item.supportedGenerationMethods.includes("generateContent")) &&
        !/^models\/gemini-3\.8-.*-tts$/.test(item.name || "")
      )
        continue;
      if (
        item.architecture?.output_modalities &&
        !item.architecture.output_modalities.some((kind) =>
          ["text", "image", "audio"].includes(kind),
        )
      )
        continue;
      const name = typeof item === "string" ? item : (item.id ?? item.name);
      if (typeof name !== "string" || !name.trim()) continue;
      const normalized =
        connection.adapter === "gemini" ? name.replace(/^models\//, "") : name;
      // OpenAI lists non-chat models too; Agentalk currently uses Chat Completions.
      if (
        new URL(connection.baseUrl).hostname === "api.openai.com" &&
        (!/^(gpt-|o\d)/.test(normalized) ||
          /(?:realtime|transcribe|tts|image|instruct|search|codex|deep-research)/.test(
            normalized,
          ))
      )
        continue;
      const modalities =
        item?.architecture?.input_modalities || item?.input_modalities;
      if (Array.isArray(modalities))
        capabilities[normalized] = Object.fromEntries(
          ["image", "audio", "video"].map((kind) => [
            kind,
            modalities.includes(kind),
          ]),
        );
      if (
        new URL(connection.baseUrl).hostname === "api.openai.com" &&
        /^gpt-(?:audio|4o(?:-mini)?-audio)(?:-|$)/.test(normalized)
      )
        capabilities[normalized] = { image: false, audio: true, video: false };
      models.push(normalized);
    }
    const next =
      connection.adapter === "gemini"
        ? data.nextPageToken
        : connection.adapter === "anthropic" && data.has_more
          ? data.last_id
          : "";
    if (!next) {
      connection.modelCapabilities = capabilities;
      return [...new Set(models)].sort((a, b) => a.localeCompare(b));
    }
    if (typeof next !== "string" || seen.has(next))
      throw new Error("Model listesi sayfalaması geçersiz.");
    seen.add(next);
    cursor = next;
  }
  throw new Error("Model listesi çok fazla sayfa döndürdü.");
}

export function buildContext(state, chat, character, source) {
  const allowed = state.messages.filter(
    (m) =>
      m.chatId === chat.id &&
      m.topicId === chat.topicId &&
      !m.deleted &&
      (m.from === character.id || m.recipients.includes(character.id)),
  );
  const names = Object.fromEntries([
    ["user", "Kullanıcı"],
    ...state.characters.map((c) => [c.id, c.name]),
  ]);
  const roster = chat.participantIds.map((pid) => ({
    id: pid,
    name: names[pid],
  }));
  const replyStyle =
    chat.memberPreferences?.[character.id]?.replyStyle ||
    chat.replyStyle ||
    "balanced";
  const habit = {
    concise: "Yanıtlarını kısa ve somut tut; gereksiz tekrar yapma.",
    balanced:
      "Doğal konuş; gerektiği kadar açıklama yap, gereksiz tekrar yapma.",
    detailed:
      "Gerekçelerini ve örneklerini ayrıntılı açıkla; konuşmaya somut katkı sun.",
  }[replyStyle];
  const system = `Sen ${character.name} (${character.id}) adlı katılımcısın. Rolün: ${character.role}.\n${character.instructions}\nCevap alışkanlığı: ${habit}\nMasa kuralları:\n${chat.rules}\nDiğer katılımcılar: ${JSON.stringify(roster)}.\nSadece sana teslim edilmiş aşağıdaki mesajları biliyorsun. Yeni katkın yoksa yalnızca [BEKLE] yaz. Katılımcılarla konuşmak için yalnızca JSON biçiminde {"content":"mesajın", "to":["user" veya katılımcı kimliği veya "all"]} üret. Özel yanıtın alıcısını açıkça seç. JSON üretemezsen düz metnin son gönderen kişiye gider. Başka kimlik adına yazma.`;
  const index = mediaIndex(state, chat, character);
  const selectedIds = selectMedia(
    index,
    source || allowed.at(-1),
    state,
    character,
  );
  const lastMessageForMedia = new Map(
    allowed.flatMap((m) => (m.attachments || []).map((a) => [a.id, m.id])),
  );
  const mediaGuide = index.length
    ? `\nMedya kataloğu (yalnızca erişimine açık içerik): ${JSON.stringify(index.map(({ id, name, kind, messageId, from, time, width, height, duration }) => ({ id, name, kind, messageId, from, time, width, height, duration })))}. Katalog, medya içeriği değildir. Yeni veya açıkça istenen medya çağrıda bulunabilir. Kullanıcı geçmiş medyaya doğal dilde başvurursa uygun kimliği seç; içeriği çağrıda yoksa yalnızca {"inspectMedia":["medya-kimliği"]} üret, dosya içeriği sonraki adımda verilir. İçeriği görmeden analiz uydurma. Mevcut medyayı göndermek için normal JSON yanıtına "attachments":[{"id":"medya-kimliği"}] ekleyebilirsin; boş content ve medya eki geçerlidir.`
    : "";
  const messages = [
    { role: "system", content: system + mediaGuide },
    ...allowed.map((m) => {
      const orderedContent = messagePieces(m.content, m.attachments).map(
        (piece) =>
          piece.type === "text"
            ? { text: piece.text }
            : {
                mediaId: piece.attachment.id,
                text: `[Dosya: ${piece.attachment.id} | ${piece.attachment.name} | ${piece.attachment.kind} | önceki satır: ${piece.attachment.placement?.beforeLine ?? "yok"}, sonraki satır: ${piece.attachment.placement?.afterLine ?? "yok"}]`,
              },
      );
      let prefix =
        m.from === character.id
          ? ""
          : `[${names[m.from] || m.from} → ${m.to.map((x) => names[x] || x).join(", ")}]\n`;
      let body = orderedContent.map((piece) => piece.text).join("");
      if (m.replyTo) {
        const orig = state.messages.find((x) => x.id === m.replyTo);
        if (orig) {
          const origAuthor = names[orig.from] || orig.from;
          const origSnippet = orig.deleted
            ? "[Bu mesaj silindi]"
            : orig.from === character.id ||
                orig.recipients.includes(character.id)
              ? orig.content.slice(0, 150)
              : "[Özel mesaj içeriği]";
          prefix = `[Alıntı: ${origAuthor}: "${origSnippet}"]\n` + prefix;
        }
      }
      return {
        role: m.from === character.id ? "assistant" : "user",
        sourceContent: m.content,
        content: prefix + body,
        orderedContent: [{ text: prefix }, ...orderedContent],
        mediaIds: (m.attachments || [])
          .filter(
            (a) =>
              selectedIds.includes(a.id) &&
              lastMessageForMedia.get(a.id) === m.id,
          )
          .map((a) => a.id),
      };
    }),
  ];
  const characters = messages.reduce((n, m) => n + m.content.length, 0);
  const missingIds = selectedIds.filter(
    (mediaId) => !messages.some((m) => m.mediaIds?.includes(mediaId)),
  );
  if (missingIds.length)
    messages.push({
      role: "user",
      content: "İncelenmesi istenen medya içerikleri:",
      mediaIds: missingIds,
    });
  const context = {
    mediaIds: selectedIds,
    messageIds: allowed.map((m) => m.id),
    characters,
    budget: character.contextBudget,
  };
  if (characters > character.contextBudget) {
    const error = new Error(
      `Bağlam ${characters.toLocaleString("tr")} karakter; ayarlanan ${character.contextBudget.toLocaleString("tr")} sınırını aşıyor. Mesajlar kırpılmadı. Yeni konu aç veya bütçeyi artır.`,
    );
    error.context = context;
    throw error;
  }
  return { messages, context };
}

export async function checkMediaSupport(
  connection,
  key,
  character,
  parts,
  signal,
) {
  return assertMediaSupported(
    connection,
    key,
    character,
    parts,
    signal,
    request,
  );
}

export async function complete(connection, key, character, messages, signal) {
  if (!character.model?.trim())
    throw new Error("Karakter için model kimliği seç.");
  const mediaParts = messages.flatMap((m) => m.mediaParts || []);
  await assertMediaSupported(
    connection,
    key,
    character,
    mediaParts,
    signal,
    request,
  );
  const outputKind = ["image", "audio"].includes(character.mediaOutput)
    ? character.mediaOutput
    : "";
  const outputsAllowed =
    {
      gemini: ["image", "audio"],
      compatible: ["audio"],
      anthropic: [],
      ollama: [],
    }[connection.adapter] || [];
  if (outputKind && !outputsAllowed.includes(outputKind))
    throw new MediaUnsupported([outputKind], "output");
  const mediaKinds = [
    ...new Set([
      ...mediaParts.map((part) => part.kind),
      ...(outputKind ? [outputKind] : []),
    ]),
  ];
  const outputMedia = Boolean(outputKind && !mediaParts.length);
  const modelName = character.model.replace(/^models\//, "");
  if (
    connection.adapter === "gemini" &&
    outputKind === "audio" &&
    /(?:^|-)tts(?:-|$)/i.test(modelName)
  ) {
    const lastUser = messages.filter((m) => m.role === "user").at(-1);
    const transcript = lastUser?.sourceContent ?? lastUser?.content ?? "";
    if (typeof transcript !== "string" || !transcript.trim())
      throw new MediaUnsupported(["audio"], "output");
    const modern = /^gemini-3\.8-/.test(modelName);
    const body = modern
      ? {
          model: modelName,
          store: false,
          input: [
            {
              type: "user_input",
              content: [{ type: "text", text: transcript }],
            },
          ],
          response_format: { type: "audio", mime_type: "audio/wav" },
          generation_config: { speech_config: [{ voice: "Kore" }] },
        }
      : {
          contents: [{ role: "user", parts: [{ text: transcript }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
            },
          },
        };
    const data = await request(
      connection,
      modern ? "/interactions" : `/models/${modelName}:generateContent`,
      key,
      {
        method: "POST",
        signal,
        body: JSON.stringify(body),
        mediaKinds: ["audio"],
        outputMedia: true,
      },
    );
    const nativeParts = modern
      ? (data.steps || [])
          .filter((step) => step.type === "model_output")
          .flatMap((step) => step.content || [])
          .filter((part) => part.type === "audio")
          .map((part) => ({
            mime: part.mime_type || "audio/wav",
            data: part.data,
          }))
      : (data.candidates?.[0]?.content?.parts || [])
          .filter((part) => part.inlineData?.data)
          .map((part) => ({
            mime: part.inlineData.mimeType,
            data: part.inlineData.data,
          }));
    const mediaOutputs = nativeParts.map((part) => ({
      mime: /^audio\/l16/i.test(part.mime) ? "audio/wav" : part.mime,
      data: /^audio\/l16/i.test(part.mime)
        ? pcmWav(part.data, Number(part.mime.match(/rate=(\d+)/)?.[1]) || 24000)
        : part.data,
      name: "model-audio.wav",
    }));
    if (!mediaOutputs.length)
      throw new Error("Model boş veya desteklenmeyen bir yanıt döndürdü.");
    return {
      content: "",
      mediaOutputs,
      usage: {
        total_tokens:
          data.usage?.total_tokens ??
          data.total_usage?.total_tokens ??
          data.usageMetadata?.totalTokenCount ??
          0,
      },
    };
  }
  messages = wireMessages(messages, connection.adapter);
  if (outputKind === "audio")
    messages.unshift({
      role: "system",
      content:
        "Ses yanıtında doğal konuş. JSON şemasını ve teknik etiketleri seslendirme; yanıt doğrudan son gönderene iletilir.",
    });
  if (connection.adapter === "anthropic") {
    const systemMessages = messages.filter((m) => m.role === "system");
    const system = systemMessages.map((m) => m.content).join("\n\n");
    const chatMessages = messages.filter((m) => m.role !== "system");

    const formatted = [];
    for (const msg of chatMessages) {
      const text = Array.isArray(msg.content)
        ? msg.content
        : (msg.content || "").trim() || "[Boş]";
      const role = msg.role === "assistant" ? "assistant" : "user";
      if (
        formatted.length > 0 &&
        formatted[formatted.length - 1].role === role
      ) {
        const previous = formatted[formatted.length - 1];
        if (Array.isArray(previous.content) || Array.isArray(text)) {
          const blocks = (content) =>
            Array.isArray(content)
              ? content
              : [{ type: "text", text: content }];
          previous.content = [...blocks(previous.content), ...blocks(text)];
        } else previous.content += "\n\n" + text;
      } else {
        formatted.push({ role, content: text });
      }
    }
    if (formatted.length === 0) {
      formatted.push({ role: "user", content: "Başla." });
    } else if (formatted[0].role !== "user") {
      formatted.unshift({ role: "user", content: "Konuşmaya katıl." });
    }

    const body = {
      model: character.model,
      max_tokens: 4096,
      messages: formatted,
    };
    if (system) {
      body.system = system;
    }

    const data = await request(connection, "/messages", key, {
      method: "POST",
      signal,
      body: JSON.stringify(body),
      mediaKinds,
      outputMedia,
    });

    const content = Array.isArray(data.content)
      ? data.content
          .map((part) => (typeof part === "string" ? part : part.text || ""))
          .join("")
      : typeof data.content === "string"
        ? data.content
        : "";

    if (!content.trim())
      throw new Error("Anthropic modeli boş bir yanıt döndürdü.");

    return {
      content,
      usage: {
        total_tokens:
          (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
    };
  }

  if (connection.adapter === "gemini") {
    const systemMessages = messages.filter((m) => m.role === "system");
    const systemPrompt = systemMessages.map((m) => m.content).join("\n\n");
    const chatMessages = messages.filter((m) => m.role !== "system");

    const contents = [];
    for (const msg of chatMessages) {
      const text = (msg.content || "").trim() || "[Boş]";
      const role = msg.role === "assistant" ? "model" : "user";
      if (contents.length > 0 && contents[contents.length - 1].role === role) {
        contents[contents.length - 1].parts.push(...(msg.parts || [{ text }]));
      } else {
        contents.push({ role, parts: msg.parts || [{ text }] });
      }
    }
    if (contents.length === 0) {
      contents.push({ role: "user", parts: [{ text: "Başla." }] });
    }

    const body = {
      contents,
      generationConfig: {
        maxOutputTokens: 4096,
        ...(character.mediaOutput === "image"
          ? { responseModalities: ["TEXT", "IMAGE"] }
          : character.mediaOutput === "audio"
            ? { responseModalities: ["AUDIO"] }
            : {}),
      },
    };
    if (systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: systemPrompt }],
      };
    }

    const modelName = character.model.replace(/^models\//, "");
    const data = await request(
      connection,
      `/models/${modelName}:generateContent`,
      key,
      {
        method: "POST",
        signal,
        body: JSON.stringify(body),
        mediaKinds,
        outputMedia,
      },
    );

    const parts = data.candidates?.[0]?.content?.parts || [];
    const content = parts
      .filter((p) => !p.thought)
      .map((p) => p.text || "")
      .join("");
    const mediaOutputs = parts
      .filter((p) => !p.thought && p.inlineData?.data)
      .map((p) => {
        const mime = p.inlineData.mimeType;
        const pcm = /^audio\/l16/i.test(mime || "");
        return {
          mime: pcm ? "audio/wav" : mime,
          data: pcm
            ? pcmWav(
                p.inlineData.data,
                Number(mime.match(/rate=(\d+)/)?.[1]) || 24000,
              )
            : p.inlineData.data,
          name: "model-media",
        };
      });
    if (!content.trim() && !mediaOutputs.length)
      throw new Error(
        "Gemini modeli boş veya desteklenmeyen bir yanıt döndürdü.",
      );

    return {
      content,
      mediaOutputs,
      usage: {
        total_tokens: data.usageMetadata?.totalTokenCount || 0,
      },
    };
  }

  const native = connection.adapter === "ollama";
  const data = await request(
    connection,
    native ? "/api/chat" : "/chat/completions",
    key,
    {
      method: "POST",
      signal,
      body: JSON.stringify({
        model: character.model,
        messages,
        stream: false,
        ...(!native && character.mediaOutput === "audio"
          ? {
              modalities: ["text", "audio"],
              audio: { voice: "alloy", format: "wav" },
            }
          : {}),
      }),
      mediaKinds,
      outputMedia,
    },
  );
  const message = native ? data.message : data.choices?.[0]?.message;
  const mediaOutputs = [];
  let content =
    typeof message?.content === "string"
      ? message.content
      : Array.isArray(message?.content)
        ? message.content.map((p) => p.text || "").join("")
        : "";
  for (const part of [
    ...(message?.images || []),
    ...(Array.isArray(message?.content)
      ? message.content.filter((p) => p.type === "image_url")
      : []),
  ]) {
    const url = typeof part === "string" ? part : part.image_url?.url;
    if (url) mediaOutputs.push(decodeDataUrl(url));
  }
  if (message?.audio?.data) {
    mediaOutputs.push({
      mime: "audio/wav",
      data: message.audio.data,
      name: "model-audio.wav",
    });
    if (!content) content = message.audio.transcript || "";
  }
  if (!content.trim() && !mediaOutputs.length)
    throw new Error("Model boş veya desteklenmeyen bir yanıt döndürdü.");
  return {
    content,
    mediaOutputs,
    usage: native
      ? { total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0) }
      : data.usage,
  };
}

export function parseReply(raw, fallbackTo) {
  const trimmed = raw.trim();
  if (trimmed === "[BEKLE]") return null;
  let object;
  try {
    object = JSON.parse(
      trimmed.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""),
    );
  } catch {
    return { content: trimmed, to: [fallbackTo] };
  }
  if (Array.isArray(object?.inspectMedia)) {
    if (
      object.inspectMedia.length < 1 ||
      object.inspectMedia.length > 6 ||
      object.inspectMedia.some((id) => typeof id !== "string")
    )
      throw new Error("Geçersiz medya isteği.");
    return { inspectMedia: object.inspectMedia };
  }
  if (
    !object ||
    typeof object.content !== "string" ||
    !Array.isArray(object.to) ||
    object.to.some((x) => typeof x !== "string")
  )
    throw new Error("Modelin mesaj/alıcı biçimi geçersiz. Yanıt yayınlanmadı.");
  if (object.content.trim() === "[BEKLE]") return null;
  if (
    object.attachments !== undefined &&
    (!Array.isArray(object.attachments) ||
      object.attachments.length > 6 ||
      object.attachments.some(
        (a) =>
          !a ||
          typeof a.id !== "string" ||
          (a.position !== undefined &&
            (!Number.isInteger(a.position) || a.position < 0)),
      ))
  )
    throw new Error("Modelin medya ekleri geçersiz.");
  return {
    content: object.content,
    to: object.to,
    ...(object.attachments?.length
      ? {
          attachments: object.attachments.map((a) => ({
            id: a.id,
            ...(a.position !== undefined ? { position: a.position } : {}),
          })),
        }
      : {}),
  };
}
