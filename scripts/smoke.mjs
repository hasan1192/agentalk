import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { runMedia } from "../electron/media.mjs";
import { Store } from "../electron/store.mjs";
import { textPdf } from "../test/fixtures/pdf.mjs";
import {
  orientedJpeg,
  rotatedVideo,
  animatedWebP,
} from "../test/fixtures/media.mjs";

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "agentalk-ui-"));
const artifacts = path.join(base, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const requests = [];
let nextReplyStatus = 200;
let stoppedReplyGate;
const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/api/tags")
    res.end(JSON.stringify({ models: [{ name: "test-model" }] }));
  else {
    const request = JSON.parse(body);
    requests.push(request);
    const gate = request.messages?.some((message) =>
      message.content?.includes("Durdurulacak çağrı"),
    )
      ? stoppedReplyGate?.promise
      : null;
    if (nextReplyStatus !== 200) {
      res.statusCode = nextReplyStatus;
      nextReplyStatus = 200;
      res.end(JSON.stringify({ error: "private-provider-test-detail" }));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (gate) await gate;
    res.end(
      JSON.stringify({
        message: {
          content:
            '{"content":"Yalnızca test sunucusunun yanıtı.","to":["user"]}',
        },
        prompt_eval_count: 8,
        eval_count: 6,
      }),
    );
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const env = {
  ...process.env,
  AGENTALK_PROFILE_DIR: path.join(temporary, "profile"),
  AGENTALK_DATA_DIR: path.join(temporary, "workspace"),
  AGENTALK_DEV_URL: "",
};
const launchOptions = {
  args: process.env.AGENTALK_TEST_EXECUTABLE ? [] : [base],
  executablePath: process.env.AGENTALK_TEST_EXECUTABLE || undefined,
  cwd: base,
  env,
};
// Test-process-only storage emulation: never query the user's macOS keychain.
// Real vault availability and encryption rules are covered by vault.test.mjs.
const isolateTestVault = async (instance) =>
  instance.evaluate(({ safeStorage }) => {
    safeStorage.isEncryptionAvailable = () => true;
    if (process.platform === "linux") {
      safeStorage.getSelectedStorageBackend = () => "gnome_libsecret";
    }
    safeStorage.encryptString = (value) =>
      Buffer.from(`agentalk-test-only:${value}`).map((byte) => byte ^ 0x5a);
    safeStorage.decryptString = (bytes) =>
      Buffer.from(bytes)
        .map((byte) => byte ^ 0x5a)
        .toString()
        .slice("agentalk-test-only:".length);
  });
let application;
const errors = [];
try {
  application = await electron.launch({
    ...launchOptions,
    timeout: 30000,
  });
  await isolateTestVault(application);
  let page = await application.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator(".app-shell").waitFor();
  const firstSnapshot = await page.evaluate(() => window.agentalk.snapshot());
  // Opening the UI must not trigger a Keychain permission query.
  assert.equal(firstSnapshot.vaultAvailable, null);
  const systemLanguage = firstSnapshot.systemLocale
    .toLowerCase()
    .replaceAll("_", "-")
    .split("-")[0];
  const expectedLanguage = ["tr", "en", "de"].includes(systemLanguage)
    ? systemLanguage
    : "en";
  await page.waitForFunction(
    (language) => document.documentElement.lang === language,
    expectedLanguage,
  );
  await page.locator(".settings-trigger").click();
  await page.locator(".language-setting select").selectOption("tr");
  await page.getByRole("button", { name: "Kapat", exact: true }).click();
  assert.equal(await page.locator(".brand-text").innerText(), "agentalk");
  assert.equal(await page.locator(".brand-dot").count(), 0);
  // Pointer capture keeps resizing stable even when the pointer leaves the divider.
  const divider = page.getByRole("separator", {
    name: "Sol paneli boyutlandır",
  });
  await page
    .locator(".sidebar")
    .evaluate((element) =>
      Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
  async function sidebarWidth(expected) {
    await page
      .waitForFunction(
        (width) =>
          Math.abs(
            document.querySelector(".sidebar").getBoundingClientRect().width -
              width,
          ) < 1,
        expected,
        { timeout: 5000 },
      )
      .catch(async (error) => {
        console.log(
          await page.locator(".sidebar").evaluate((element) => ({
            width: element.getBoundingClientRect().width,
            style: element.getAttribute("style"),
            resizing: element.dataset.resizing,
            handle: element.querySelector('[role="separator"]').outerHTML,
            saved: localStorage.getItem("agentalk_sidebar_width"),
          })),
        );
        await page.screenshot({
          path: path.join(artifacts, "sidebar-debug.png"),
        });
        throw error;
      });
  }
  async function dragSidebar(delta, cancel = false) {
    const box = await page
      .getByRole("separator", { name: "Sol paneli boyutlandır" })
      .boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + delta, box.y + 80, {
      steps: 6,
    });
    if (cancel) await page.keyboard.press("Escape");
    await page.mouse.up();
  }
  await dragSidebar(110);
  await sidebarWidth(360);
  assert.equal(await divider.getAttribute("aria-valuenow"), "360");
  await divider.press("ArrowLeft");
  await sidebarWidth(344);
  await divider.press("Shift+ArrowRight");
  await sidebarWidth(376);
  await divider.press("Home");
  await sidebarWidth(220);
  await divider.press("End");
  const maximumSidebar = Number(await divider.getAttribute("aria-valuemax"));
  await sidebarWidth(maximumSidebar);
  await dragSidebar(-90, true);
  await sidebarWidth(maximumSidebar);
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.sidebarResizing),
    undefined,
  );
  await divider.dblclick();
  await sidebarWidth(250);
  await dragSidebar(78);
  await sidebarWidth(328);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("agentalk_sidebar_width")),
    "328",
  );
  assert(
    await page
      .locator(".brand-mark")
      .first()
      .evaluate((image) => image.complete && image.naturalWidth > 0),
  );
  await page
    .getByRole("heading", { name: "Kişilerle başla, bir grupta buluş" })
    .waitFor();
  assert.equal(
    await page.locator(".new-person-button, .new-chat-button").count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Kişileri daralt", exact: true })
      .count(),
    1,
  );
  // Measure real intermediate frames in both directions, not just CSS presence.
  async function toggleDisclosure(id, expectedExpanded) {
    const result = await page.evaluate(
      async ({ id, expectedExpanded }) => {
        const button = document.querySelector(`[aria-controls="${id}"]`);
        const panel = document.getElementById(id);
        const arrow = button.querySelector("svg");
        const frames = [];
        const sample = () =>
          frames.push({
            height: panel.getBoundingClientRect().height,
            angle:
              (Math.atan2(
                new DOMMatrix(getComputedStyle(arrow).transform).b,
                new DOMMatrix(getComputedStyle(arrow).transform).a,
              ) *
                180) /
              Math.PI,
          });
        sample();
        button.click();
        const start = performance.now();
        await new Promise((resolve, reject) => {
          function frame() {
            sample();
            const last = frames.at(-1);
            const active = [
              ...panel.getAnimations({ subtree: true }),
              ...arrow.getAnimations(),
            ].some(
              (animation) =>
                animation.playState === "running" || animation.pending,
            );
            if (
              button.getAttribute("aria-expanded") ===
                String(expectedExpanded) &&
              !active &&
              Math.abs(last.angle - (expectedExpanded ? 90 : 0)) < 1
            )
              resolve();
            else if (performance.now() - start > 5000)
              reject(
                new Error(
                  `Disclosure did not settle: ${JSON.stringify(frames)}`,
                ),
              );
            else requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        });
        return {
          frames,
          expanded: button.getAttribute("aria-expanded"),
          inert: panel.inert,
        };
      },
      { id, expectedExpanded },
    );
    assert.equal(result.expanded, String(expectedExpanded));
    assert.equal(result.inert, !expectedExpanded);
    const first = result.frames[0];
    const last = result.frames.at(-1);
    assert(Math.abs(last.angle - (expectedExpanded ? 90 : 0)) < 1);
    assert(
      expectedExpanded
        ? last.height > first.height
        : last.height < first.height,
    );
    assert(
      result.frames.some(
        (frame) =>
          frame.height > Math.min(first.height, last.height) + 1 &&
          frame.height < Math.max(first.height, last.height) - 1,
      ),
    );
  }
  await toggleDisclosure("sidebar-people", false);
  assert.equal(
    await page
      .getByRole("button", { name: "Kişi şablonu aktar", exact: true })
      .count(),
    0,
  );
  await toggleDisclosure("sidebar-people", true);
  await toggleDisclosure("sidebar-groups", false);
  await toggleDisclosure("sidebar-groups", true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByRole("button", { name: "Kişileri daralt", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.getElementById("sidebar-people").getBoundingClientRect().height <
      1,
  );
  assert.equal(
    await page
      .locator("#sidebar-people")
      .evaluate((panel) => getComputedStyle(panel).transitionDuration),
    "0s",
  );
  await page
    .getByRole("button", { name: "Kişileri genişlet", exact: true })
    .click();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.screenshot({ path: path.join(artifacts, "01-welcome.png") });
  await page.getByRole("button", { name: "Yeni grup", exact: true }).click();
  assert(
    await page
      .getByRole("button", { name: "Grubu oluştur", exact: true })
      .isDisabled(),
  );
  await page
    .getByText("Grup oluşturmak için önce sol bardan bir kişi ekle.")
    .waitFor();
  await page.getByRole("button", { name: "Kapat", exact: true }).click();
  await page.getByRole("button", { name: "Ayarlar", exact: true }).click();
  await page.getByRole("heading", { name: "Genel", exact: true }).waitFor();
  await page.screenshot({
    path: path.join(artifacts, "00-settings-general.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: /^API bağlantıları/ }).click();
  await page
    .getByRole("button", { name: "API bağlantısı ekle", exact: true })
    .first()
    .click();
  const connectionDialog = page.getByRole("dialog", {
    name: "API bağlantısı ekle",
    exact: true,
  });
  assert.equal(await connectionDialog.locator(".provider-card-btn").count(), 0);
  assert.equal(
    await connectionDialog.locator(".connection-advanced").getAttribute("open"),
    null,
  );
  await connectionDialog
    .getByRole("button", { name: "Bulut", exact: true })
    .click();
  for (const [id, url] of Object.entries({
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    deepseek: "https://api.deepseek.com",
    groq: "https://api.groq.com/openai/v1",
    openrouter: "https://openrouter.ai/api/v1",
    mistral: "https://api.mistral.ai/v1",
  })) {
    await connectionDialog
      .getByLabel("Sağlayıcı", { exact: true })
      .selectOption(id);
    assert.equal(
      await connectionDialog.getByLabel("Sunucu adresi").inputValue(),
      url,
    );
  }
  await connectionDialog
    .getByLabel("Sağlayıcı", { exact: true })
    .selectOption("anthropic");
  assert.equal(
    await connectionDialog.locator(".key-portal-link").innerText(),
    "Anahtar al",
  );
  await connectionDialog
    .getByRole("button", { name: "Anahtar al", exact: true })
    .click({ trial: true });
  await connectionDialog
    .locator('[name="apiKey"]')
    .fill("fixture-not-a-real-key");
  await connectionDialog
    .getByLabel("Sağlayıcı", { exact: true })
    .selectOption("gemini");
  assert.equal(
    await connectionDialog.locator('[name="apiKey"]').inputValue(),
    "",
  );
  await connectionDialog
    .getByRole("button", { name: "Özel", exact: true })
    .click();
  assert.equal(
    await connectionDialog.getByLabel("Sunucu adresi").inputValue(),
    "",
  );
  assert(
    await connectionDialog
      .getByLabel("Sunucu adresi")
      .evaluate((input) => !input.validity.valid),
  );
  await connectionDialog
    .getByRole("button", { name: "Yerel", exact: true })
    .click();
  await connectionDialog
    .getByLabel("Sağlayıcı", { exact: true })
    .selectOption("lmstudio");
  await connectionDialog
    .getByText("Sunucuda kimlik doğrulama açıksa anahtar gir.", { exact: true })
    .waitFor();
  await connectionDialog
    .getByLabel("Sağlayıcı", { exact: true })
    .selectOption("ollama");
  await page.screenshot({
    path: path.join(artifacts, "23-api-connection-form.png"),
    animations: "disabled",
  });
  await page.getByLabel("Bağlantı adı").fill("Yerel test bağlantısı");
  await page
    .getByLabel("Sunucu adresi")
    .fill(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("button", { name: "Bağlantıyı kaydet" }).click();
  await page
    .getByRole("button", { name: "Bağlantıyı sına", exact: true })
    .click();
  await page.locator(".connection-details summary").click();
  await page.getByText("test-model", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Karakter oluştur", exact: true })
      .count(),
    0,
  );
  await page.getByLabel("Yerel test bağlantısı kapasitesi").selectOption("2");
  const savedConnection = (
    await page.evaluate(() => window.agentalk.snapshot())
  ).connections[0];
  await page.getByRole("button", { name: "Kapat", exact: true }).click();
  for (const name of ["Ada Test", "Bora Test"]) {
    await page.getByRole("button", { name: "Kişi ekle", exact: true }).click();
    assert.equal(
      await page.getByLabel("Model kimliği").inputValue(),
      "test-model",
    );
    assert.equal(
      await page.locator(".connection-model-container select").inputValue(),
      savedConnection.id,
    );
    assert.equal(await page.locator('input[name="apiKey"]').count(), 0);
    await page.getByLabel("Karakter adı").fill(name);
    if (name === "Ada Test") {
      const identity = await page
        .locator(".person-identity")
        .evaluate((element) => {
          const photo = element
            .querySelector(".profile-photo-preview")
            .getBoundingClientRect();
          const fields = element
            .querySelector(".person-identity-fields")
            .getBoundingClientRect();
          return {
            photoHeight: photo.height,
            photoWidth: photo.width,
            fieldsHeight: fields.height,
            topDifference: photo.top - fields.top,
            gap: fields.left - photo.right,
          };
        });
      assert(Math.abs(identity.photoHeight - identity.photoWidth) < 1);
      assert(Math.abs(identity.photoHeight - identity.fieldsHeight) < 1);
      assert(Math.abs(identity.topDifference) < 1);
      assert(identity.gap >= 16);
      await page.getByLabel("Özel renk", { exact: true }).fill("#c4a265");
      assert(
        await page.locator(".custom-color-swatch.active-color").isVisible(),
      );
      await page.screenshot({
        path: path.join(artifacts, "44-person-create.png"),
        animations: "disabled",
      });
      await page.locator(".media-model-options summary").click();
      const mediaOptions = await page
        .locator(".media-model-options select")
        .evaluateAll((selects) =>
          selects.map((select) =>
            [...select.options].map((option) => ({
              value: option.value,
              text: option.textContent,
            })),
          ),
        );
      assert.equal(mediaOptions.length, 3);
      for (const options of mediaOptions)
        assert.deepEqual(options, [
          { value: "auto", text: "Otomatik" },
          { value: "no", text: "Kapalı" },
        ]);
      await page.getByLabel("Video okuma", { exact: true }).selectOption("no");
      await page.screenshot({
        path: path.join(artifacts, "45-person-media-options.png"),
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Dış ajan", exact: true }).click();
      assert.equal(await page.locator(".media-model-options").count(), 0);
      assert.equal(await page.getByLabel("Model kimliği").count(), 0);
      await page.getByText(/Klasör ayrımı süreç sandboxı değildir/).waitFor();
      await page
        .getByRole("button", { name: "Model karakteri", exact: true })
        .click();
    }
    await page.getByRole("button", { name: "Kişiyi oluştur" }).click();
    await page
      .getByRole("button", { name: `${name} ile sohbet`, exact: true })
      .waitFor();
  }
  assert.equal(
    await page.getByRole("button", { name: /kişisini düzenle/ }).count(),
    0,
  );
  const configuredPerson = (
    await page.evaluate(() => window.agentalk.snapshot())
  ).characters.find((character) => character.name === "Ada Test");
  assert.equal(configuredPerson.color, "#c4a265");
  assert.equal(configuredPerson.mediaSupport.video, "no");
  // Older explicit support and output values remain readable; editing uses the new choices.
  await page.evaluate(
    (id) =>
      window.agentalk.command("character.update", {
        id,
        mediaSupport: { image: "yes", audio: "auto", video: "no" },
        mediaOutput: "audio",
      }),
    configuredPerson.id,
  );
  await page
    .getByRole("button", { name: "Ada Test ile sohbet", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Kişi bilgileri", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Kişi bilgileri", exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("Özel renk", { exact: true }).inputValue(),
    "#c4a265",
  );
  await page.locator(".media-model-options summary").click();
  assert.equal(
    await page.getByLabel("Fotoğraf okuma", { exact: true }).inputValue(),
    "auto",
  );
  assert.equal(
    await page.getByLabel("Video okuma", { exact: true }).inputValue(),
    "no",
  );
  assert.equal(await page.locator(".media-model-options select").count(), 3);
  await page.getByLabel("Video okuma", { exact: true }).selectOption("auto");
  await page
    .getByRole("button", { name: "Değişiklikleri Kaydet", exact: true })
    .click();
  const editedPerson = (
    await page.evaluate(() => window.agentalk.snapshot())
  ).characters.find((character) => character.id === configuredPerson.id);
  assert.equal(editedPerson.color, "#c4a265");
  assert.equal(editedPerson.mediaSupport.image, "auto");
  assert.equal(editedPerson.mediaSupport.video, "auto");
  assert.equal(editedPerson.mediaOutput, "audio");
  await page.evaluate(
    (id) =>
      window.agentalk.command("character.update", { id, mediaOutput: "text" }),
    configuredPerson.id,
  );
  const created = await page.evaluate(() => window.agentalk.snapshot());
  assert.equal(created.chats.length, 0);
  assert.equal(created.connections.length, 1);
  assert.equal(
    created.characters[0].connectionId,
    created.characters[1].connectionId,
  );
  assert.notEqual(created.characters[0].id, created.characters[1].id);
  await page
    .getByRole("button", { name: "Ada Test ile sohbet", exact: true })
    .click();
  await page.getByRole("heading", { name: "Ada Test", exact: true }).waitFor();
  await page.getByLabel("Mesajın", { exact: true }).fill("@");
  assert.equal(
    await page
      .getByRole("listbox", { name: "Kişi etiketle", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByLabel("Mesajın", { exact: true })
      .getAttribute("data-placeholder"),
    "Mesaj gönder…",
  );
  await page.getByLabel("Mesajın", { exact: true }).fill("");
  const geometry = async () =>
    page.evaluate(() => {
      const editor = document
        .querySelector(".composer-rich-input")
        .getBoundingClientRect();
      const attach = document
        .querySelector(".composer-attach")
        .getBoundingClientRect();
      const send = document.querySelector(".send-btn").getBoundingClientRect();
      const form = document
        .querySelector(".composer-card")
        .getBoundingClientRect();
      const header = document
        .querySelector(".chat-info-trigger")
        .getBoundingClientRect();
      const avatar = document
        .querySelector(".chat-info-trigger .avatar")
        .getBoundingClientRect();
      return {
        editor: {
          height: editor.height,
          center: editor.top + editor.height / 2,
        },
        attach: {
          bottom: attach.bottom,
          center: attach.top + attach.height / 2,
        },
        send: { bottom: send.bottom },
        form: { top: form.top, bottom: form.bottom },
        header: {
          left: header.left,
          top: header.top,
          right: header.right,
          bottom: header.bottom,
        },
        avatar: {
          left: avatar.left,
          top: avatar.top,
          right: avatar.right,
          bottom: avatar.bottom,
        },
      };
    });
  const initialGeometry = await geometry();
  assert(
    Math.abs(initialGeometry.editor.center - initialGeometry.attach.center) < 2,
  );
  assert(initialGeometry.avatar.left >= initialGeometry.header.left + 4);
  assert(initialGeometry.avatar.top >= initialGeometry.header.top + 4);
  assert(initialGeometry.avatar.right <= initialGeometry.header.right - 4);
  assert(initialGeometry.avatar.bottom <= initialGeometry.header.bottom - 4);
  await page
    .getByLabel("Mesajın", { exact: true })
    .fill("Birinci satır\nİkinci satır\nÜçüncü satır");
  const tallerGeometry = await geometry();
  assert(tallerGeometry.form.top < initialGeometry.form.top - 20);
  assert(
    Math.abs(tallerGeometry.form.bottom - initialGeometry.form.bottom) < 2,
  );
  assert(
    Math.abs(tallerGeometry.attach.bottom - initialGeometry.attach.bottom) < 2,
  );
  assert(
    Math.abs(tallerGeometry.send.bottom - initialGeometry.send.bottom) < 2,
  );
  await page
    .getByLabel("Mesajın", { exact: true })
    .fill(Array(30).fill("Satır").join("\n"));
  assert((await geometry()).editor.height <= 221);
  await page.getByLabel("Mesajın", { exact: true }).fill("");
  await page.locator(".chat-info-trigger").click();
  await page
    .getByRole("dialog", { name: "Kişi bilgileri", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Kapat", exact: true }).click();

  assert.equal(
    await page
      .getByRole("button", { name: "Katılımcılar", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Gözlem modunu aç", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Tema değiştir", exact: true })
      .count(),
    0,
  );
  const directObserverError = await page.evaluate(async () => {
    const state = await window.agentalk.snapshot();
    try {
      await window.agentalk.command("chat.observe", {
        id: state.selectedChatId,
        value: true,
      });
      return "";
    } catch (error) {
      return error.message;
    }
  });
  assert.match(directObserverError, /yalnızca grup/);
  await page
    .getByRole("button", { name: "Masa seçenekleri", exact: true })
    .click();
  await page
    .locator(".dropdown-menu")
    .getByRole("button", { name: "Kişi bilgileri", exact: true })
    .click();
  await page.getByRole("button", { name: "Kapat", exact: true }).click();
  await page.screenshot({
    path: path.join(artifacts, "13-direct-chat.png"),
    animations: "disabled",
  });

  await page
    .getByRole("button", { name: "Ada Test ile sohbet", exact: true })
    .click();
  assert.equal(
    (await page.evaluate(() => window.agentalk.snapshot())).chats.length,
    1,
  );
  await page.getByRole("button", { name: "Yeni grup", exact: true }).click();
  await page
    .getByLabel("Grup adı", { exact: true })
    .fill("Uçtan uca test masası");
  await page
    .getByLabel("Kısa açıklama", { exact: true })
    .fill("Bu kayıt test profiline aittir.");
  assert(
    await page
      .getByRole("button", { name: "Grubu oluştur", exact: true })
      .isDisabled(),
  );
  await page.getByLabel("Ada Test gruba katılsın").check();
  await page.getByLabel("Bora Test gruba katılsın").check();
  await page.getByLabel("Ada Test yanıt tarzı").selectOption("concise");
  await page.getByLabel("Heartbeat saniye").fill("1");
  await page.getByLabel("Eşzamanlı cevap sayısı").fill("2");
  await page.getByLabel("Grup talimatları").fill("Somut katkılar sunun.");
  await page.screenshot({
    path: path.join(artifacts, "11-group-create.png"),
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Grubu oluştur", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Uçtan uca test masası", exact: true })
    .waitFor();
  assert.equal(await page.locator(".thinking-bar").count(), 0);
  await page.screenshot({
    path: path.join(artifacts, "12-people-groups.png"),
    animations: "disabled",
  });
  assert.equal(
    await page
      .locator(".dropdown-menu")
      .getByRole("button", { name: "Grup bilgileri", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "Grupları daralt", exact: true })
    .click();
  await page.getByRole("list").waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("list").count(), 0);
  await page
    .getByRole("button", { name: "Grupları genişlet", exact: true })
    .click();
  await page
    .locator(".chat-item", { hasText: "Uçtan uca test masası" })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Grup bilgileri", exact: true })
    .click();
  await page.getByLabel("Yanıt bütçesi", { exact: true }).waitFor();
  await page.getByLabel("Grup talimatları", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Kapat", exact: true }).click();
  await page.getByRole("button", { name: "Katılımcılar", exact: true }).click();
  await page.locator(".drawer-panel").waitFor();
  await page.getByRole("button", { name: "Katılımcılar", exact: true }).click();
  await page
    .getByRole("button", { name: "Masa seçenekleri", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", {
        name: /Yeni konuya geç|Tur bütçesini ayarla|Masa kurallarını gör/,
      })
      .count(),
    0,
  );
  await page
    .locator(".dropdown-menu")
    .getByRole("button", { name: "Grup bilgileri", exact: true })
    .click();
  assert.equal(await page.getByLabel("Heartbeat saniye").inputValue(), "1");
  await page.getByLabel("Heartbeat saniye").fill("0.5");
  await page
    .getByRole("button", { name: "Grup ayarlarını kaydet", exact: true })
    .click();
  const initial = await page.evaluate(() => window.agentalk.snapshot());
  const a = initial.characters.find((c) => c.name === "Ada Test");
  const b = initial.characters.find((c) => c.name === "Bora Test");
  assert.equal(await page.getByLabel("Alıcı", { exact: true }).count(), 0);
  await page.getByLabel("Mesajın", { exact: true }).fill("@");
  assert.equal(await page.getByRole("option").count(), 2);
  await page.getByLabel("Mesajın", { exact: true }).fill("@Bo");
  assert.equal(await page.getByRole("option").count(), 1);
  assert((await page.getByRole("option").innerText()).includes("Bora Test"));
  await page.screenshot({
    path: path.join(artifacts, "18-mention-picker.png"),
    animations: "disabled",
  });
  await page.getByLabel("Mesajın", { exact: true }).fill("@Ad");
  await page.getByRole("option", { name: /Ada Test/ }).click();
  await page
    .getByLabel("Mesajın", { exact: true })
    .fill("@Ada Test Sadece Ada için test mesajı.");
  assert.equal(await page.locator(".mention-suggestions").count(), 0);

  await page.getByRole("button", { name: "Mesaj gönder", exact: true }).click();
  await page.locator(".typing-indicator-banner").waitFor();
  assert.match(
    await page.locator(".typing-indicator-banner").innerText(),
    /Ada Test yazıyor/,
  );
  assert.notEqual(
    await page
      .locator(".typing-dots span")
      .first()
      .evaluate((node) => getComputedStyle(node).animationName),
    "none",
  );
  await page.screenshot({ path: path.join(artifacts, "15-typing.png") });
  await page
    .getByText("Yalnızca test sunucusunun yanıtı.", { exact: true })
    .waitFor();
  await page
    .locator('.from-user .read-receipt-ticks[data-status="read"]')
    .waitFor();
  assert.equal(
    await page.locator(".message-header-line .message-time").count(),
    0,
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".typing-indicator-banner").length === 0,
  );
  async function assertMessageEdges() {
    const edges = await page.evaluate(() => {
      const scroll = document.querySelector(".message-scroll");
      const rect = scroll.getBoundingClientRect();
      const style = getComputedStyle(scroll);
      const ai = document
        .querySelector(".message-card.from-ai")
        .getBoundingClientRect();
      const user = document
        .querySelector(".message-card.from-user")
        .getBoundingClientRect();
      return {
        left: ai.left - rect.left,
        right: rect.left + scroll.clientLeft + scroll.clientWidth - user.right,
        leftPadding: parseFloat(style.paddingLeft),
        rightPadding: parseFloat(style.paddingRight),
        userWidth: user.width,
        widths: Array.from(document.querySelectorAll(".message-card")).map(
          (element) => element.getBoundingClientRect().width,
        ),
        flowWidth: document
          .querySelector(".message-flow")
          .getBoundingClientRect().width,
      };
    });
    assert(Math.abs(edges.left - edges.leftPadding) < 2, JSON.stringify(edges));
    assert(
      Math.abs(edges.right - edges.rightPadding) < 2,
      JSON.stringify(edges),
    );
    assert(edges.userWidth < edges.flowWidth, JSON.stringify(edges));
    const expected = Math.max(320, Math.min(760, edges.flowWidth * 0.85));
    assert(
      edges.widths.every((width) => Math.abs(width - expected) < 1),
      JSON.stringify(edges),
    );
    return edges;
  }
  await assertMessageEdges();
  const readIcon = page
    .locator('.read-receipt-ticks[data-status="read"] .receipt-icon')
    .first();
  assert.equal(await readIcon.getAttribute("data-double"), "true");
  assert.equal(await readIcon.locator("path").count(), 2);
  assert.equal(
    await readIcon.evaluate((icon) => getComputedStyle(icon).color),
    "rgb(7, 134, 181)",
  );
  let current = await page.evaluate(() => window.agentalk.snapshot());
  assert.equal(current.runs.length, 1);
  assert.equal(current.runs[0].characterId, a.id);
  assert(current.chats.find((c) => c.id === current.selectedChatId).waiting);
  assert(
    !requests[0].messages.some((m) => m.content.includes("Bora için özel")),
  );
  await page.evaluate(async (personId) => {
    await window.agentalk.command("character.enable", {
      id: personId,
      value: false,
    });
  }, b.id);
  await page.getByLabel("Mesajın", { exact: true }).fill("Kısmi okuma testi");
  await page.getByRole("button", { name: "Mesaj gönder", exact: true }).click();
  await page
    .locator(".from-user", { hasText: "Kısmi okuma testi" })
    .locator('[data-status="partial"]')
    .waitFor();
  const receiptBeforeResume = await page.evaluate(async (personId) => {
    const state = await window.agentalk.snapshot();
    const message = state.messages.find(
      (m) => m.content === "Kısmi okuma testi",
    );
    await window.agentalk.command("message.read", {
      chatId: message.chatId,
      id: message.id,
      participantId: personId,
    });
    return (await window.agentalk.snapshot()).messages.find(
      (m) => m.id === message.id,
    ).readTimes;
  }, b.id);
  assert(
    !receiptBeforeResume[b.id],
    "Renderer cannot forge another person's read receipt",
  );
  await page.evaluate(async (personId) => {
    await window.agentalk.command("character.enable", {
      id: personId,
      value: true,
    });
  }, b.id);
  await page
    .locator(".from-user", { hasText: "Kısmi okuma testi" })
    .locator('[data-status="read"]')
    .waitFor();
  await application.close();
  // A private fixture is inserted only while the app is closed; the journal has one writer at a time.
  const store = new Store(env.AGENTALK_DATA_DIR);
  store.acceptMessage(a.id, {
    chatId: current.selectedChatId,
    content: "Bora için özel test notu.",
    to: [b.id],
  });
  application = await electron.launch(launchOptions);
  await isolateTestVault(application);
  page = await application.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByRole("heading", { name: "Uçtan uca test masası", exact: true })
    .waitFor();
  await sidebarWidth(328);
  assert.equal(
    await page.getByText("Bora için özel test notu.", { exact: true }).count(),
    0,
  );
  await page
    .getByRole("button", { name: "Gözlem modunu aç", exact: true })
    .click();
  await page
    .getByText("Bora için özel test notu.", { exact: true })
    .first()
    .waitFor();
  assert.equal(await page.getByLabel("Mesajın", { exact: true }).count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Gözlem modunu kapat", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.screenshot({ path: path.join(artifacts, "03-observer.png") });
  await page.getByLabel("Katılımcı bağlamı").selectOption(b.id);
  assert.equal(
    await page
      .getByText("@Ada Test Sadece Ada için test mesajı.", { exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "Yazışmaya dön", exact: true })
    .first()
    .click();
  assert.equal(
    await page.getByRole("button", { name: /Karar|Pano/ }).count(),
    0,
  );
  const boardError = await page.evaluate(async () => {
    try {
      await window.agentalk.command("decision.create", {
        content: "Eski pano komutu",
      });
      return "";
    } catch (error) {
      return error.message;
    }
  });
  assert.match(boardError, /Komut tanınmadı/);
  nextReplyStatus = 400;
  await page
    .getByLabel("Mesajın", { exact: true })
    .fill("@Ada Test Hata açıklaması testi");
  await page.getByRole("button", { name: "Mesaj gönder", exact: true }).click();
  const failedReply = page
    .locator(".run-error-card")
    .filter({ hasText: "Sunucu isteği kabul etmedi" });
  await failedReply.waitFor();
  assert(
    (await failedReply.locator(".error-cause").innerText()).includes(
      "kesin nedeni belirtmez",
    ),
  );
  assert(
    (await failedReply.locator(".error-action").innerText()).includes(
      "API biçimini",
    ),
  );
  assert.equal(
    await failedReply.locator(".error-technical").getAttribute("open"),
    null,
  );
  await failedReply.getByText("Teknik ayrıntı", { exact: true }).click();
  assert(
    (await failedReply.locator(".error-technical").innerText()).includes(
      "HTTP 400",
    ),
  );
  assert(
    !(await failedReply.innerText()).includes("private-provider-test-detail"),
  );
  await page.screenshot({
    path: path.join(artifacts, "31-error-explanation.png"),
    animations: "disabled",
  });
  await failedReply
    .getByRole("button", { name: "Tekrar dene", exact: true })
    .click();
  await page.waitForFunction(
    () => !document.querySelector(".typing-indicator-banner"),
  );
  stoppedReplyGate = Promise.withResolvers();
  await page.getByLabel("Mesajın", { exact: true }).fill("Durdurulacak çağrı");
  await page.getByRole("button", { name: "Mesaj gönder", exact: true }).click();
  await page.locator(".typing-indicator-banner").waitFor();
  const stoppedSource = (
    await page.evaluate(() => window.agentalk.snapshot())
  ).messages.find((m) => m.content === "Durdurulacak çağrı").id;
  await page
    .getByRole("button", { name: "Masa seçenekleri", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Aktif konuşmayı durdur", exact: true })
    .click();
  await page.getByText("Durduruldu", { exact: true }).first().waitFor();
  stoppedReplyGate.resolve();
  await page.waitForTimeout(1100);
  assert.equal(await page.locator(".typing-indicator-banner").count(), 0);
  assert(
    !(await page.evaluate(() => window.agentalk.snapshot())).messages.some(
      (m) => m.replyTo === stoppedSource,
    ),
  );
  const widthFixtures = await page.evaluate(async () => {
    const state = await window.agentalk.snapshot();
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    for (const [index, content] of [
      "Kısa",
      "Uzun mesajda kutu yatayda büyümez; yalnızca yeni satırlar eklenir. ".repeat(
        14,
      ),
    ].entries())
      await window.agentalk.command("message.send", {
        id: ids[index],
        chatId: state.selectedChatId,
        content,
        to: ["all"],
      });
    return ids;
  });
  await page.locator(`#message-${widthFixtures[1]}`).waitFor();
  const heightDifference = await page.evaluate(
    (ids) =>
      ids.map(
        (id) =>
          document
            .querySelector(`#message-${id} .message-card`)
            .getBoundingClientRect().height,
      ),
    widthFixtures,
  );
  assert(heightDifference[1] > heightDifference[0] + 30);
  assert(
    (await assertMessageEdges()).widths.every(
      (width) => Math.abs(width - 760) < 1,
    ),
  );
  const originalGeometry = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const original = {
      bounds: window.getBounds(),
      min: window.getMinimumSize(),
    };
    // Exercise the minimum width, including the sidebar drag limit.
    window.setMinimumSize(660, 580);
    window.setContentSize(660, 760);
    return original;
  });
  await page.waitForFunction(() => window.innerWidth <= 661);
  await sidebarWidth(220);
  await assertMessageEdges();
  assert.equal(
    await page
      .getByRole("separator", { name: "Sol paneli boyutlandır" })
      .getAttribute("aria-valuemax"),
    "220",
  );
  await dragSidebar(120, true);
  await sidebarWidth(220);
  await page.getByRole("button", { name: "Katılımcılar", exact: true }).click();
  const narrow = await page.evaluate(() => ({
    conversation: document
      .querySelector(".conversation-panel")
      .getBoundingClientRect().width,
    drawer: getComputedStyle(document.querySelector(".drawer-panel")).position,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }));
  assert(
    narrow.conversation >= 440 &&
      narrow.drawer === "absolute" &&
      narrow.overflow === 0,
    JSON.stringify(narrow),
  );
  await assertMessageEdges();
  await page.screenshot({
    path: path.join(artifacts, "32-minimum-message-width.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Katılımcılar", exact: true }).click();
  await application.evaluate(({ BrowserWindow }, original) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setBounds(original.bounds);
    window.setMinimumSize(...original.min);
  }, originalGeometry);
  await sidebarWidth(328);
  await assertMessageEdges();
  await page.screenshot({
    path: path.join(artifacts, "33-equal-message-widths.png"),
    animations: "disabled",
  });
  current = await page.evaluate(() => window.agentalk.snapshot());
  // Export no longer contains a board. The save dialog targets only this temporary profile.
  const exportPath = path.join(temporary, "chat-export.json");
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, exportPath);
  assert(
    await page.evaluate(
      (id) => window.agentalk.exportChat(id),
      current.selectedChatId,
    ),
  );
  const exported = JSON.parse(fs.readFileSync(exportPath, "utf8"));
  assert(!Object.hasOwn(exported, "decisions"));
  assert(
    exported.messages.some((m) =>
      m.content.endsWith("Sadece Ada için test mesajı."),
    ),
    JSON.stringify(exported.messages.map((m) => m.content)),
  );
  assert(
    !exported.messages.some((m) => m.content === "Bora için özel test notu."),
  );
  // Palette selection preserves appearance. Both counterparts exist for every theme.
  async function selectTheme(id) {
    await page.getByRole("button", { name: "Tema seç", exact: true }).click();
    await page
      .locator(".theme-picker-panel")
      .evaluate((element) =>
        Promise.all(
          element
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished.catch(() => {})),
        ),
      );
    await page.locator(`.theme-option[data-theme-id="${id}"]`).click();
    await page.waitForFunction(
      () =>
        document
          .querySelector(".theme-picker-trigger")
          .getAttribute("aria-expanded") === "false",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Tema seç", exact: true })
        .getAttribute("aria-expanded"),
      "false",
    );
  }
  await page.evaluate(() => {
    localStorage.setItem("agentalk_theme", "whatsapp-light");
    localStorage.removeItem("agentalk_appearance");
  });
  await page.reload();
  await page.locator(".app-shell").waitFor();
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.appearance),
    "light",
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "whatsapp-light",
  );
  await page
    .getByRole("button", { name: "Karanlık görünüme geç", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "whatsapp",
  );
  await page.getByRole("button", { name: "Ayarlar", exact: true }).click();
  assert.equal(
    await page.locator(".theme-filter-pill, .themes-gallery-grid").count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Tema seç", exact: true })
      .getAttribute("aria-expanded"),
    "false",
  );
  assert(
    await page.locator("#theme-options").evaluate((element) => element.inert),
  );
  const orderedIds = await page
    .locator(".theme-option")
    .evaluateAll((items) => items.map((item) => item.dataset.themeId));
  assert.deepEqual(orderedIds.slice(0, 5), [
    "sage",
    "obsidian",
    "midnight",
    "sunset",
    "paper",
  ]);
  assert.equal(orderedIds.length, 15);
  const nativeLight = new Set(["sage", "paper"]);
  const paletteSurfaces = {};
  function luminance(hex) {
    const normalized = hex
      .trim()
      .replace(/^#([a-f\d])([a-f\d])([a-f\d])$/i, "#$1$1$2$2$3$3");
    const rgb = normalized.match(/^#([a-f\d]{6})$/i);
    assert(rgb, `Expected RGB color, received ${hex}`);
    const channels = [0, 2, 4]
      .map((offset) => parseInt(rgb[1].slice(offset, offset + 2), 16) / 255)
      .map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
      );
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }
  for (const mode of ["light", "dark"]) {
    await page
      .getByRole("button", {
        name: mode === "light" ? "Aydınlık" : "Karanlık",
        exact: true,
      })
      .click();
    paletteSurfaces[mode] = {};
    for (const id of orderedIds) {
      await selectTheme(id);
      const nativeMode = nativeLight.has(id) ? "light" : "dark";
      const variant = mode === nativeMode ? id : `${id}-${mode}`;
      await page.waitForFunction(
        (variant) => document.documentElement.dataset.theme === variant,
        variant,
      );
      const colors = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return {
          mode: document.documentElement.dataset.appearance,
          background: style.getPropertyValue("--surface-app"),
          card: style.getPropertyValue("--surface-card"),
          text: style.getPropertyValue("--ink-primary"),
          colorScheme: style.colorScheme,
        };
      });
      assert.equal(colors.mode, mode);
      assert.equal(colors.colorScheme, mode);
      const text = luminance(colors.text),
        card = luminance(colors.card);
      assert(
        (Math.max(text, card) + 0.05) / (Math.min(text, card) + 0.05) >= 4.5,
        `${variant} text contrast`,
      );
      assert(
        mode === "light"
          ? luminance(colors.background) > 0.75
          : luminance(colors.background) < 0.08,
        `${variant} surface brightness`,
      );
      paletteSurfaces[mode][id] = colors.background;
    }
  }
  for (const id of orderedIds)
    assert.notEqual(paletteSurfaces.light[id], paletteSurfaces.dark[id]);
  await selectTheme("obsidian");
  await page.getByRole("button", { name: "Kapat", exact: true }).click();
  await page.screenshot({
    path: path.join(artifacts, "04-theme-obsidian.png"),
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Aydınlık görünüme geç", exact: true })
    .click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "obsidian-light",
  );
  await page.screenshot({
    path: path.join(artifacts, "21-theme-obsidian-light.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Ayarlar", exact: true }).click();
  await selectTheme("sakura");
  await page.screenshot({
    path: path.join(artifacts, "22-theme-sakura-light-settings.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Kapat", exact: true }).click();
  await page
    .getByRole("button", { name: "Karanlık görünüme geç", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "sakura",
  );

  // 5. Kenar Çubuğu Daraltma ve Geri Açma Testi (Collapsed Sidebar & Restore)
  async function animateSidebar(collapsed) {
    const frames = await page.evaluate(async (collapsed) => {
      const sidebar = document.querySelector(".sidebar");
      const target = collapsed
        ? 68
        : Number(
            sidebar
              .querySelector('[role="separator"]')
              .getAttribute("aria-valuenow"),
          );
      const widths = [sidebar.getBoundingClientRect().width];
      sidebar
        .querySelector(collapsed ? ".collapse-toggle" : ".collapsed-toggle-btn")
        .click();
      const start = performance.now();
      await new Promise((resolve, reject) => {
        function sample() {
          const width = sidebar.getBoundingClientRect().width;
          widths.push(width);
          if (Math.abs(width - target) < 0.5 && performance.now() - start > 400)
            resolve();
          else if (performance.now() - start > 3000)
            reject(new Error("Sidebar animation did not settle"));
          else requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
      return widths;
    }, collapsed);
    assert(
      frames.some((width) => width > 70 && width < 326),
      JSON.stringify(frames),
    );
    assert(Math.abs(frames.at(-1) - (collapsed ? 68 : 328)) < 1);
  }
  await animateSidebar(true);
  assert(
    await page.evaluate(() =>
      document.querySelector(".sidebar")?.classList.contains("collapsed"),
    ),
  );
  await page.screenshot({
    path: path.join(artifacts, "10-sidebar-collapsed.png"),
  });

  await page
    .getByRole("button", { name: "Aydınlık görünüme geç", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "sakura-light",
  );
  await page
    .getByRole("button", { name: "Karanlık görünüme geç", exact: true })
    .click();

  // Geri açma (sidebar içindeki buton ile)
  await animateSidebar(false);
  await assertMessageEdges();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: /Kenar çubuğunu daralt/ }).click();
  await sidebarWidth(68);
  await page.locator(".collapsed-toggle-btn").click();
  await sidebarWidth(328);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  assert(
    !(await page.evaluate(() =>
      document.querySelector(".sidebar")?.classList.contains("collapsed"),
    )),
  );

  // Chat-header içindeki expand butonu ile test
  await page.getByRole("button", { name: /Kenar çubuğunu daralt/ }).click();
  await page.waitForTimeout(250);
  assert(
    await page.evaluate(() =>
      document.querySelector(".sidebar")?.classList.contains("collapsed"),
    ),
  );
  await page.locator(".chat-header-expand-btn").click();
  await page.waitForTimeout(250);
  assert(
    !(await page.evaluate(() =>
      document.querySelector(".sidebar")?.classList.contains("collapsed"),
    )),
  );

  // 6. Gece Mavisi Teması ve Yeniden Başlatma Dayanıklılığı
  await page.getByRole("button", { name: "Ayarlar", exact: true }).click();
  await page.getByRole("button", { name: "Genel", exact: true }).click();
  await selectTheme("midnight");
  const themeMidnight = await page.evaluate(() =>
    document.documentElement.getAttribute("data-theme"),
  );
  assert.equal(themeMidnight, "midnight");
  await page.waitForTimeout(200);
  await page.screenshot({
    path: path.join(artifacts, "07-theme-midnight.png"),
  });
  await page
    .getByRole("dialog", { name: "Ayarlar" })
    .getByRole("button", { name: "Kapat", exact: true })
    .click();

  await page.getByRole("button", { name: "Ayarlar", exact: true }).click();
  const nativeBrand = await application.evaluate(({ app, Menu }) => {
    const menu = Menu.getApplicationMenu();
    const about = menu.items
      .flatMap((item) => item.submenu?.items || [])
      .find((item) => item.label === "Agentalk Hakkında");
    about.click();
    return {
      name: app.getName(),
      version: app.getVersion(),
      menu: menu.items[0].label,
    };
  });
  assert.equal(nativeBrand.name, "Agentalk");
  if (process.platform === "darwin") assert.equal(nativeBrand.menu, "Agentalk");
  await page.getByRole("heading", { name: "agentalk", exact: true }).waitFor();
  await page
    .getByText("Bağımsız sesler. Ortak bir sohbet.", { exact: true })
    .waitFor();
  assert(
    (await page.locator(".about-brand small").innerText()).includes(
      nativeBrand.version,
    ),
  );
  await page.screenshot({
    path: path.join(artifacts, "20-brand-about.png"),
    animations: "disabled",
  });
  // A native settings action also changes tabs while the modal is already open.
  await application.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()
      .items.flatMap((item) => item.submenu?.items || [])
      .find((item) => item.label === "Ayarlar…")
      .click();
  });
  await page.getByRole("heading", { name: "Genel", exact: true }).waitFor();
  await page.getByRole("button", { name: "Hakkında", exact: true }).click();
  assert.equal(await page.locator(".flow-steps, .about-principles").count(), 0);
  assert(
    !(await page.locator(".about-body").innerText()).includes(
      "Açık kaynak renk paletleri Agentalk arayüzüne uyarlanmıştır.",
    ),
  );
  await page.locator(".about-licenses summary").first().click();
  await page.locator(".about-licenses details[open] pre").waitFor();
  assert.match(
    await page.locator(".about-licenses details[open] pre").innerText(),
    /MIT License/,
  );
  await page.locator(".about-licenses summary").first().click();
  const ijgNotice = page.locator(".about-licenses details").filter({
    has: page.locator("summary", { hasText: "Independent JPEG Group" }),
  });
  await ijgNotice.locator("summary").click();
  assert.match(
    await ijgNotice.locator("pre").innerText(),
    /This software is based in part on the work of the Independent JPEG Group/,
  );
  for (const component of [
    "Opus 1.6.1",
    "dav1d 1.5.4",
    "Vite runtime helper",
  ]) {
    assert.equal(
      await page
        .locator(".about-licenses summary")
        .filter({ hasText: component })
        .count(),
      1,
    );
  }
  await application.evaluate(({ shell }) => {
    shell.openPath = async (target) => {
      globalThis.testNoticePath = target;
      return "";
    };
  });
  await page
    .getByRole("button", {
      name: "Electron ve Chromium bildirimlerini aç",
      exact: true,
    })
    .click();
  const runtimePaths = await application.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    resources: process.resourcesPath,
    application: app.getAppPath(),
  }));
  assert.equal(
    await application.evaluate(() => globalThis.testNoticePath),
    path.join(
      runtimePaths.packaged
        ? runtimePaths.resources
        : path.join(
            runtimePaths.application,
            "node_modules",
            "electron",
            "dist",
          ),
      "LICENSES.chromium.html",
    ),
  );
  assert(
    fs.existsSync(
      path.join(
        runtimePaths.packaged
          ? runtimePaths.resources
          : path.join(
              runtimePaths.application,
              "node_modules",
              "electron",
              "dist",
            ),
        "LICENSES.chromium.html",
      ),
    ),
  );
  await page
    .getByRole("button", {
      name: "FFmpeg kaynak kodu ve lisanslarını aç",
      exact: true,
    })
    .click();
  const sourceDirectory = runtimePaths.packaged
    ? path.join(runtimePaths.resources, "MediaSources")
    : path.join(base, "vendor", "media", "sources");
  assert.equal(
    await application.evaluate(() => globalThis.testNoticePath),
    sourceDirectory,
  );
  assert(fs.existsSync(path.join(sourceDirectory, "ffmpeg-8.0.3.tar.xz")));
  assert(!fs.existsSync(path.join(sourceDirectory, "build-source.tar.gz")));
  assert(fs.existsSync(path.join(sourceDirectory, "rebuild-media-mac.sh")));
  assert(fs.existsSync(path.join(sourceDirectory, "MEDIA_BUILD.md")));
  if (runtimePaths.packaged) {
    for (const file of fs.readdirSync(path.join(base, "docs", "licenses"))) {
      const expected = fs.readFileSync(
        path.join(base, "docs", "licenses", file),
      );
      for (const directory of [
        path.join(sourceDirectory, "licenses"),
        path.join(runtimePaths.resources, "MediaLicenses"),
      ]) {
        assert.deepEqual(fs.readFileSync(path.join(directory, file)), expected);
      }
    }
  }
  await page.screenshot({
    path: path.join(artifacts, "14-about-licenses.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Kapat", exact: true }).click();
  async function checkPreviewLayout() {
    await page.waitForFunction(() => {
      const root = document.querySelector(".media-preview-body");
      if (
        !root ||
        !root.querySelector(".media-preview-stage") ||
        root.querySelector(".media-spinner")
      )
        return false;
      const image = root.querySelector(".media-preview-viewport img");
      const video = root.querySelector(".media-preview-viewport video");
      return (
        (!image || (image.complete && image.naturalWidth > 0)) &&
        (!video || video.readyState >= 1)
      );
    });
    const layout = await page
      .locator(".media-preview-modal")
      .evaluate((dialog) => {
        const bounds = dialog.getBoundingClientRect();
        const footer = dialog
          .querySelector(".modal-actions-footer")
          .getBoundingClientRect();
        const add = dialog
          .querySelector(".modal-actions-footer .btn-primary")
          .getBoundingClientRect();
        const scroll = dialog.querySelector(".media-preview-scroll");
        const view = dialog
          .querySelector(".media-preview-viewport")
          .getBoundingClientRect();
        const player = dialog.querySelector(
          ".media-preview-viewport img, .media-preview-viewport video",
        );
        const rect = player?.getBoundingClientRect();
        const naturalWidth = player?.naturalWidth || player?.videoWidth;
        const naturalHeight = player?.naturalHeight || player?.videoHeight;
        const settings = dialog
          .querySelector(".media-preview-settings")
          ?.getBoundingClientRect();
        const columns = getComputedStyle(
          dialog.querySelector(".media-preview-columns"),
        ).gridTemplateColumns.split(" ").length;
        return {
          right: bounds.right - add.right,
          bottom: bounds.bottom - add.bottom,
          footerVisible:
            footer.bottom <= window.innerHeight && footer.top >= bounds.top,
          overflow: scroll.scrollWidth - scroll.clientWidth,
          contained:
            !rect ||
            (rect.left >= view.left + 15 &&
              rect.right <= view.right - 15 &&
              rect.top >= view.top + 15 &&
              rect.bottom <= view.bottom - 15),
          ratio:
            naturalWidth && naturalHeight
              ? Math.abs(
                  rect.width / rect.height - naturalWidth / naturalHeight,
                )
              : 0,
          centered:
            !rect ||
            Math.abs(
              (rect.left + rect.right) / 2 - (view.left + view.right) / 2,
            ) < 1,
          columns,
          separated:
            !settings || columns === 1 || settings.left - view.right >= 23,
          controls: Array.from(
            dialog.querySelectorAll(
              ".media-preview-settings input, .media-preview-settings select",
            ),
          ).every((input) => {
            const a = input.getBoundingClientRect(),
              b = input
                .closest(".input-field, .media-checkbox")
                .getBoundingClientRect();
            return (
              a.width === 0 || (a.left >= b.left - 1 && a.right <= b.right + 1)
            );
          }),
        };
      });
    assert(layout.right >= 18 && layout.bottom >= 17, JSON.stringify(layout));
    assert(
      layout.footerVisible && layout.overflow <= 1,
      JSON.stringify(layout),
    );
    assert(
      layout.contained && layout.centered && layout.ratio < 0.02,
      JSON.stringify(layout),
    );
    assert(layout.separated && layout.controls, JSON.stringify(layout));
    return layout;
  }
  // Same media preview for file picker, drop and paste; only confirmed transformed files are sent.
  const mediaChatId = (await page.evaluate(() => window.agentalk.snapshot()))
    .selectedChatId;
  const tonePath = path.join(temporary, "tone.wav"),
    videoPath = path.join(temporary, "clip.webm");
  await runMedia("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-y",
    tonePath,
  ]);
  await runMedia("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x240:rate=8:duration=2",
    "-c:v",
    "libvpx-vp9",
    "-deadline",
    "realtime",
    "-cpu-used",
    "8",
    "-pix_fmt",
    "yuv420p",
    "-y",
    videoPath,
  ]);
  assert.equal(
    await page.getByRole("button", { name: "Medya ekle", exact: true }).count(),
    1,
  );
  await page
    .getByLabel("Medya dosyası seç", { exact: true })
    .setInputFiles(path.join(base, "public/brand/icon-256.png"));
  await page
    .getByRole("dialog", { name: "Medya önizlemesi", exact: true })
    .waitFor();
  await page.locator(".media-preview-stage img").waitFor();
  await page.waitForFunction(
    () => !document.querySelector(".media-preview-processing"),
  );
  assert.equal(
    await page.getByLabel("Görüntü biçimi", { exact: true }).inputValue(),
    "png",
  );
  assert.equal(
    await page.getByLabel("JPEG kalitesi (%)", { exact: true }).count(),
    0,
  );
  const resolution = page.getByLabel("Çözünürlük sınırı (px)", { exact: true });
  await resolution.fill("");
  assert.equal(await resolution.inputValue(), "");
  assert.equal(
    await page.getByRole("button", { name: /Mesaja ekle/ }).isDisabled(),
    true,
  );
  await resolution.press("Tab");
  assert.equal(await resolution.inputValue(), "1");
  await page
    .getByRole("button", { name: "Varsayılana dön", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".media-preview-stage img")?.naturalWidth ===
        256 && !document.querySelector(".media-preview-processing"),
  );
  await page.getByLabel("Görüntü biçimi", { exact: true }).selectOption("jpeg");
  await page.getByLabel("JPEG kalitesi (%)", { exact: true }).fill("");
  assert.equal(
    await page.getByLabel("JPEG kalitesi (%)", { exact: true }).inputValue(),
    "",
  );
  await page.getByLabel("JPEG kalitesi (%)", { exact: true }).press("Tab");
  assert.equal(
    await page.getByLabel("JPEG kalitesi (%)", { exact: true }).inputValue(),
    "20",
  );
  await page.getByLabel("Görüntü biçimi", { exact: true }).selectOption("webp");
  assert.equal(
    await page.getByLabel("WebP kalitesi (%)", { exact: true }).count(),
    1,
  );
  await page
    .getByRole("button", { name: "Varsayılana dön", exact: true })
    .click();
  await checkPreviewLayout();
  assert.equal(
    await page.getByLabel("Görüntü biçimi", { exact: true }).inputValue(),
    "png",
  );
  assert.equal(await resolution.inputValue(), "256");
  await page
    .getByLabel("Çözünürlük birimi", { exact: true })
    .selectOption("percent");
  await page.getByLabel("Ölçek (%)", { exact: true }).fill("50");
  await page.waitForFunction(
    () =>
      document.querySelector(".media-preview-stage img")?.naturalWidth ===
        128 && !document.querySelector(".media-preview-processing"),
  );
  await checkPreviewLayout();
  await page.getByLabel("Çözünürlük birimi", { exact: true }).focus();
  const selectStyle = await page
    .getByLabel("Çözünürlük birimi", { exact: true })
    .evaluate((input) => ({
      position: getComputedStyle(input).backgroundPosition,
      image: getComputedStyle(input).backgroundImage,
    }));
  assert.match(selectStyle.position, /12px/);
  assert.notEqual(selectStyle.image, "none");
  await page.screenshot({ path: path.join(artifacts, "20-photo-preview.png") });
  await page.getByRole("button", { name: /Mesaja ekle/ }).click();
  assert.equal(await page.locator(".composer-media-chip").count(), 1);
  const photoToken = page.locator(".composer-media-chip .media-token");
  assert.match(
    await page.locator(".composer-attachment-summary > summary").innerText(),
    /1 ek/,
  );
  assert((await photoToken.boundingBox()).height < 32);
  await photoToken.hover();
  const hover = page.locator(".media-hover-preview");
  await hover.waitFor();
  await hover.hover();
  await page.waitForTimeout(300);
  assert(await hover.isVisible());
  assert(
    (await hover.boundingBox()).y + (await hover.boundingBox()).height <=
      (await photoToken.boundingBox()).y + 1,
  );
  await hover
    .getByRole("button", { name: "Önizlemeyi büyüt", exact: true })
    .last()
    .click();
  await page.locator(".media-detail-panel .media-preview-settings").waitFor();
  await page.waitForFunction(() => !document.querySelector(".media-spinner"));
  const detailBounds = await page.locator(".media-detail-panel").boundingBox(),
    conversationBounds = await page
      .locator(".conversation-panel")
      .boundingBox();
  assert(Math.abs(detailBounds.width - conversationBounds.width) < 2);
  await page
    .getByLabel("Çözünürlük birimi", { exact: true })
    .selectOption("pixels");
  await page.waitForTimeout(450);
  await page.getByLabel("Çözünürlük sınırı (px)", { exact: true }).fill("64");
  await page.getByLabel("Çözünürlük sınırı (px)", { exact: true }).press("Tab");
  await page.waitForFunction(
    () =>
      document.querySelector(".media-preview-stage img")?.naturalWidth === 64 &&
      !document.querySelector(".media-spinner"),
  );
  await page.getByRole("button", { name: /Değişiklikleri uygula/ }).click();
  const editor = page.getByLabel("Mesajın", { exact: true });
  await editor.focus();
  await editor.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await page.locator(".composer-media-chip .media-token").hover();
  await page.waitForFunction(
    () =>
      document.querySelector(".media-hover-preview img")?.naturalWidth === 128,
  );
  await page.mouse.move(5, 100);
  await editor.focus();
  await editor.evaluate((el) => {
    const node = el.querySelector("[data-attachment-id]"),
      r = document.createRange();
    r.setStartAfter(node);
    r.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(r);
  });
  await editor.press("Backspace");
  assert.equal(await page.locator(".composer-media-chip").count(), 0);
  await editor.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  assert.equal(
    await page.locator(".composer-media-chip .media-token").count(),
    1,
  );
  await page.getByRole("button", { name: "Mesaj gönder", exact: true }).click();
  await page.locator(".message-media.image .media-token").first().click();
  await page.waitForFunction(
    () =>
      document.querySelector(".media-detail-view img")?.naturalWidth === 128,
  );
  assert.equal(
    await page.locator(".media-detail-panel .media-preview-settings").count(),
    0,
  );
  await page
    .locator(".media-detail-panel")
    .getByRole("button", { name: "Kapat", exact: true })
    .click();
  const imageMessage = (
    await page.evaluate(() => window.agentalk.snapshot())
  ).messages.find((m) => m.attachments?.some((a) => a.kind === "image"));
  assert.equal(imageMessage.content, "");
  assert.equal(imageMessage.attachments[0].width, 128);
  assert.equal(imageMessage.attachments[0].settings.resizeMode, "percent");
  assert.equal(imageMessage.attachments[0].settings.scalePercent, 50);
  assert.equal(await page.locator(".composer-media-chip").count(), 0);
  const mediaSourceBeforeDrop = (
    await page.evaluate(() => window.agentalk.snapshot())
  ).messages.length;
  const dataTransfer = await page.evaluateHandle(
    (bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([Uint8Array.from(bytes)], "drop.webm", { type: "video/webm" }),
      );
      return transfer;
    },
    [...fs.readFileSync(videoPath)],
  );
  await page
    .locator(".main-content")
    .dispatchEvent("dragenter", { dataTransfer });
  await page.locator(".chat-media-drop-overlay").waitFor();
  await page.locator(".main-content").dispatchEvent("drop", { dataTransfer });
  await page
    .getByRole("dialog", { name: "Medya önizlemesi", exact: true })
    .waitFor();
  await page.locator(".media-preview-stage video").waitFor();
  await page.getByLabel("Kare hızı (FPS)", { exact: true }).fill("2");
  await page.getByLabel("Kesit süresi (s)", { exact: true }).fill("1");
  await page.waitForFunction(
    () =>
      document
        .querySelector(".media-preview-stats")
        ?.textContent.includes("2 FPS") &&
      !document.querySelector(".media-preview-processing"),
  );
  await page.waitForFunction(
    () => document.querySelector(".media-preview-stage video")?.readyState >= 1,
  );
  await page.locator(".media-preview-stage video").evaluate(async (video) => {
    video.muted = true;
    await video.play();
  });
  await page.waitForFunction(
    () =>
      document.querySelector(".media-preview-stage video")?.currentTime > 0.2,
  );
  await page
    .locator(".media-preview-stage video")
    .evaluate((video) => video.pause());
  assert.equal(
    await page.getByLabel("Video biçimi", { exact: true }).inputValue(),
    "webm",
  );
  assert.equal(
    await page.getByLabel("Videonun sesini kaldır", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByLabel("Ses bit hızı (kbps)", { exact: true }).count(),
    0,
  );
  await checkPreviewLayout();
  await page.screenshot({ path: path.join(artifacts, "21-video-preview.png") });
  await page.getByRole("button", { name: /Mesaja ekle/ }).click();
  await page.getByRole("button", { name: "Mesaj gönder", exact: true }).click();
  await page.locator(".message-media.video .media-token").first().click();
  await page.waitForFunction(
    () => document.querySelector(".media-detail-view video")?.readyState >= 1,
  );
  await page
    .locator(".media-detail-panel")
    .getByRole("button", { name: "Kapat", exact: true })
    .click();
  const videoMessage = (
    await page.evaluate(() => window.agentalk.snapshot())
  ).messages.find((m) => m.attachments?.some((a) => a.kind === "video"));
  assert.equal(videoMessage.attachments[0].settings.fps, 2);
  // Audio preview applies actual Opus compression; the browser plays the selected variant.
  await page
    .getByLabel("Medya dosyası seç", { exact: true })
    .setInputFiles(tonePath);
  await page.locator(".media-preview-stage audio").waitFor();
  assert.equal(
    await page.getByLabel("Ses biçimi", { exact: true }).inputValue(),
    "wav",
  );
  assert.equal(
    await page.getByLabel("Örnekleme hızı", { exact: true }).inputValue(),
    "48000",
  );
  assert.equal(
    await page.getByLabel("Ses kanalları", { exact: true }).inputValue(),
    "2",
  );
  assert.equal(
    await page.getByLabel("Ses bit hızı (kbps)", { exact: true }).count(),
    0,
  );
  await page.getByLabel("Ses biçimi", { exact: true }).selectOption("opus");
  await page.getByLabel("Ses bit hızı (kbps)", { exact: true }).fill("32");
  await page.waitForFunction(
    () =>
      document.querySelector(".media-preview-stage audio")?.readyState >= 1 &&
      !document.querySelector(".media-preview-processing"),
  );
  await page.locator(".media-preview-stage audio").evaluate(async (audio) => {
    audio.muted = true;
    await audio.play();
  });
  await page.waitForFunction(
    () =>
      document.querySelector(".media-preview-stage audio")?.currentTime > 0.2,
  );
  await page
    .locator(".media-preview-stage audio")
    .evaluate((audio) => audio.pause());
  await checkPreviewLayout();
  await page.screenshot({ path: path.join(artifacts, "22-audio-preview.png") });
  await page.getByRole("button", { name: /Mesaja ekle/ }).click();
  await page.getByRole("button", { name: "Mesaj gönder", exact: true }).click();
  await page.locator(".message-media.audio .media-token").first().click();
  await page.waitForFunction(
    () => document.querySelector(".media-detail-view audio")?.readyState >= 1,
  );
  await page
    .locator(".media-detail-panel")
    .getByRole("button", { name: "Kapat", exact: true })
    .click();
  const audioMessage = (
    await page.evaluate(() => window.agentalk.snapshot())
  ).messages.find((m) => m.attachments?.some((a) => a.kind === "audio"));
  assert.equal(audioMessage.attachments[0].mime, "audio/ogg");
  // Range requests support seeking; fetching a private attachment never creates receipts.
  const range = await page.evaluate(
    async ({ chatId, mediaId }) => {
      const response = await fetch(
        `agentalk-media://asset/${chatId}/${mediaId}`,
        { headers: { Range: "bytes=0-9" } },
      );
      return {
        status: response.status,
        length: (await response.arrayBuffer()).byteLength,
        range: response.headers.get("Content-Range"),
      };
    },
    { chatId: mediaChatId, mediaId: audioMessage.attachments[0].id },
  );
  assert.equal(range.status, 206);
  assert.equal(range.length, 10);
  assert(range.range.startsWith("bytes 0-9/"));
  // Export keeps only visible media, with actual transformed files in its companion directory.
  await page.evaluate((id) => window.agentalk.exportChat(id), mediaChatId);
  const mediaExport = JSON.parse(fs.readFileSync(exportPath, "utf8"));
  assert.equal(mediaExport.schemaVersion, 2);
  for (const sent of [imageMessage, videoMessage, audioMessage]) {
    const asset = mediaExport.messages.find((m) => m.id === sent.id)
      .attachments[0];
    assert.equal(
      fs.statSync(path.resolve(path.dirname(exportPath), asset.exportPath))
        .size,
      asset.bytes,
    );
  }
  // Pasting uses the same modal, and cancelling never adds a message.
  const beforeCancel = (await page.evaluate(() => window.agentalk.snapshot()))
    .messages.length;
  await page.locator(".main-content").evaluate(
    (main, bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([Uint8Array.from(bytes)], "paste.png", { type: "image/png" }),
      );
      main.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        }),
      );
    },
    [...fs.readFileSync(path.join(base, "public/brand/icon-256.png"))],
  );
  await page
    .getByRole("dialog", { name: "Medya önizlemesi", exact: true })
    .waitFor();
  await page.locator(".media-preview-stage img").waitFor();
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
  assert.equal(
    (await page.evaluate(() => window.agentalk.snapshot())).messages.length,
    beforeCancel,
  );
  assert.equal(await page.locator(".composer-media-chip").count(), 0);
  assert.equal(beforeCancel, mediaSourceBeforeDrop + 2);
  // Inline documents preserve their exact location and allow writing beside them.
  const composer = page.getByLabel("Mesajın", { exact: true });
  await composer.fill("Dosya öncesi\nDosya sonrası");
  await composer.press("Home");
  await page.getByLabel("Medya dosyası seç", { exact: true }).setInputFiles([
    {
      name: "notes.pdf",
      mimeType: "application/pdf",
      buffer: textPdf("PDF inline test"),
    },
    {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Inline document text"),
    },
  ]);
  await page.locator(".media-preview-stage .document-preview").waitFor();
  await page.waitForFunction(() => !document.querySelector(".media-spinner"));
  assert.equal(await page.locator(".media-preview-settings").count(), 0);
  await checkPreviewLayout();
  await page.screenshot({
    path: path.join(artifacts, "28-document-preview.png"),
  });
  await page.getByRole("button", { name: /Mesaja ekle/ }).click();
  assert.equal(await page.locator(".composer-media-chip.document").count(), 2);
  // A group and DM keep independent unsent text/media, including stable attachment identities.
  const groupDraftText = await composer.innerText();
  const groupDraftIds = await page
    .locator(".composer-media-chip")
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.attachmentId));
  const waitForChatTitle = (name) =>
    page.waitForFunction(
      (name) => document.querySelector(".chat-title")?.textContent === name,
      name,
    );
  await page
    .getByRole("button", { name: "Ada Test ile sohbet", exact: true })
    .click();
  await waitForChatTitle("Ada Test");
  await composer.fill("Birebir sohbetin gönderilmemiş taslağı.");
  await page
    .getByLabel("Medya dosyası seç", { exact: true })
    .setInputFiles(path.join(base, "public/brand/icon-256.png"));
  await page.locator(".media-preview-stage img").waitFor();
  await page.waitForFunction(() => !document.querySelector(".media-spinner"));
  await page.getByRole("button", { name: /Mesaja ekle/ }).click();
  const directDraftText = await composer.innerText();
  const directDraftId = await page
    .locator(".composer-media-chip")
    .getAttribute("data-attachment-id");
  await page
    .locator(".chat-list .chat-item", { hasText: "Uçtan uca test masası" })
    .click();
  await waitForChatTitle("Uçtan uca test masası");
  assert.equal(await composer.innerText(), groupDraftText);
  assert.deepEqual(
    await page
      .locator(".composer-media-chip")
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.attachmentId)),
    groupDraftIds,
  );
  await page
    .getByRole("button", { name: "Ada Test ile sohbet", exact: true })
    .click();
  await waitForChatTitle("Ada Test");
  assert.equal(await composer.innerText(), directDraftText);
  assert.equal(
    await page
      .locator(".composer-media-chip")
      .getAttribute("data-attachment-id"),
    directDraftId,
  );
  await page.locator(".composer-media-remove").click();
  await composer.fill("");
  await page
    .locator(".chat-list .chat-item", { hasText: "Uçtan uca test masası" })
    .click();
  await waitForChatTitle("Uçtan uca test masası");
  assert.equal(await composer.innerText(), groupDraftText);
  await page.screenshot({
    path: path.join(artifacts, "34-restored-chat-draft.png"),
  });
  await composer.evaluate((el) => {
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(r);
  });
  await composer.press("Delete");
  assert.equal(await page.locator(".composer-media-chip").count(), 0);
  await composer.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  assert.equal(
    await page.locator(".composer-media-chip .media-token").count(),
    2,
  );
  await composer.press(
    process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z",
  );
  assert.equal(await page.locator(".composer-media-chip").count(), 0);
  await composer.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  // Return the caret to the point after both files before continuing the original flow.
  await composer.evaluate((el) => {
    el.focus();
    const files = el.querySelectorAll("[data-attachment-id]"),
      r = document.createRange();
    r.setStartAfter(files[files.length - 1]);
    r.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(r);
  });
  await composer.focus();
  await page.keyboard.insertText(" yanından ");
  await composer.press("Shift+Enter");
  await page.keyboard.insertText("Yeni satır ");
  await page.screenshot({
    path: path.join(artifacts, "23-inline-documents.png"),
  });
  await page.getByRole("button", { name: "Mesaj gönder", exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector(".composer-media-chip"),
  );
  const inline = (
    await page.evaluate(() => window.agentalk.snapshot())
  ).messages.find((m) => m.attachments?.some((a) => a.name === "notes.pdf"));
  assert.equal(
    inline.content,
    "Dosya öncesi\n yanından \nYeni satır Dosya sonrası",
  );
  assert.deepEqual(
    inline.attachments.map((a) => a.position),
    ["Dosya öncesi\n".length, "Dosya öncesi\n".length],
  );
  assert(inline.attachments.every((a) => a.document.status === "ready"));
  const inlineDOM = await page
    .locator(`#message-${inline.id} .message-inline-content`)
    .evaluate((node) =>
      Array.from(node.childNodes).map((n) =>
        n.classList?.contains("message-media") ? "file" : n.textContent,
      ),
    );
  assert.deepEqual(inlineDOM, [
    "Dosya öncesi\n",
    "file",
    "file",
    " yanından \nYeni satır Dosya sonrası",
  ]);
  assert.match(
    await page
      .locator(`#message-${inline.id} .read-receipt-ticks`)
      .getAttribute("title"),
    /Henüz görülmedi/,
  );
  // Removing an atomic attachment cleans its draft and leaves the surrounding text.
  await composer.fill("Silme testi");
  await page.getByLabel("Medya dosyası seç", { exact: true }).setInputFiles({
    name: "remove.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Remove me"),
  });
  await page.waitForFunction(() =>
    document
      .querySelector(".document-preview-status")
      ?.textContent.includes("Metin okunabilir"),
  );
  await page.getByRole("button", { name: /Mesaja ekle/ }).click();
  await page.locator(".composer-media-chip.document").evaluate((chip) => {
    const root = document.querySelector(".composer-rich-input");
    const bounds = root.getBoundingClientRect();
    const transfer = new DataTransfer();
    chip.dispatchEvent(
      new DragEvent("dragstart", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
    root.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientX: bounds.left + 1,
        clientY: bounds.top + 10,
      }),
    );
  });
  assert.equal(
    await composer.evaluate(
      (node) =>
        Array.from(node.childNodes).find(
          (n) => n.textContent || n.dataset?.attachmentId,
        )?.dataset?.attachmentId !== undefined,
    ),
    true,
  );
  await page
    .getByRole("button", { name: "Medyayı kaldır", exact: true })
    .click();
  assert.equal(await page.locator(".composer-media-chip").count(), 0);
  assert.equal(await composer.innerText(), "Silme testi");
  await page.locator(".message-scroll").evaluate((el) => {
    el.scrollTo({ top: 0, behavior: "instant" });
    el.dispatchEvent(new Event("scroll"));
  });
  await page.locator(".jump-to-end-btn").waitFor();
  for (const text of ["Kısa", "Satır\n".repeat(4), "Satır\n".repeat(60)]) {
    await composer.fill(text);
    const gap = await page.evaluate(() => {
      const b = document
          .querySelector(".jump-to-end-btn")
          .getBoundingClientRect(),
        card = document.querySelector(".composer-card").getBoundingClientRect();
      return card.top - b.bottom;
    });
    assert(Math.abs(gap - 12) < 1, String(gap));
  }
  assert((await composer.boundingBox()).height <= 220);
  assert(await composer.evaluate((el) => el.scrollHeight > el.clientHeight));
  await composer.fill("");
  // Unsupported input and old replies are ordinary agent messages, with waiting preserved.
  await page.evaluate(
    async ({ chatId, personId }) => {
      await window.agentalk.command("character.update", {
        id: personId,
        mediaSupport: { image: "no", audio: "no", video: "no" },
      });
      await window.agentalk.command("chat.wait", { id: chatId, value: true });
    },
    { chatId: mediaChatId, personId: a.id },
  );
  await page.evaluate(
    async ({ chatId, personId, imageId }) =>
      window.agentalk.command("message.send", {
        id: crypto.randomUUID(),
        chatId,
        content: "Bu fotoğrafa yeniden bak",
        to: [personId],
        replyTo: imageId,
      }),
    { chatId: mediaChatId, personId: a.id, imageId: imageMessage.id },
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".message-body-text")].some((node) =>
      node.textContent.includes("Bu model fotoğraf içeriğini okuyamıyor"),
    ),
  );
  assert(
    (await page.evaluate(() => window.agentalk.snapshot())).chats.find(
      (c) => c.id === mediaChatId,
    ).waiting,
  );
  await page.evaluate(
    (id) => window.agentalk.command("chat.wait", { id, value: false }),
    mediaChatId,
  );
  await page.screenshot({ path: path.join(artifacts, "23-media-chat.png") });
  // Private agent media is denied by the player protocol; observation reads never acknowledge delivery.
  await page.evaluate(async (chatId) => {
    await window.agentalk.command("character.create", {
      name: "Media Folder Test",
      kind: "folder",
      chatId,
    });
    await window.agentalk.command("chat.wait", { id: chatId, value: true });
  }, mediaChatId);
  const folderPerson = (
    await page.evaluate(() => window.agentalk.snapshot())
  ).characters.find((c) => c.name === "Media Folder Test");
  const folderPath = path.join(
    env.AGENTALK_DATA_DIR,
    "chats",
    mediaChatId,
    "participants",
    folderPerson.id,
  );
  const folderConfig = JSON.parse(
    fs.readFileSync(path.join(folderPath, "bridge.json"), "utf8"),
  );
  const privateId = crypto.randomUUID();
  const privateResult = await fetch(`${folderConfig.endpoint}/message`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${folderConfig.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: privateId,
      topicId: folderConfig.topicId,
      to: [a.id],
      attachments: [
        {
          name: "private.png",
          data: fs
            .readFileSync(path.join(base, "public/brand/icon-256.png"))
            .toString("base64"),
        },
      ],
    }),
  });
  assert.equal(privateResult.status, 200);
  await page.evaluate(
    (id) => window.agentalk.command("chat.wait", { id, value: false }),
    mediaChatId,
  );
  const privateState = await page.evaluate(() => window.agentalk.snapshot());
  const privateAttachment = privateState.messages.find(
    (m) => m.id === privateId,
  ).attachments[0];
  const assetStatus = () =>
    page.evaluate(
      async ({ chatId, mediaId }) =>
        (await fetch(`agentalk-media://asset/${chatId}/${mediaId}`)).status,
      { chatId: mediaChatId, mediaId: privateAttachment.id },
    );
  assert.equal(await assetStatus(), 403);
  await page.evaluate(
    (id) => window.agentalk.command("chat.observe", { id, value: true }),
    mediaChatId,
  );
  const receiptCounts = () =>
    fs
      .readFileSync(
        path.join(env.AGENTALK_DATA_DIR, "_system", "events.jsonl"),
        "utf8",
      )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((event) =>
        ["message.read", "delivery.processed"].includes(event.type),
      ).length;
  const beforeObserveFetch = receiptCounts();
  assert.equal(await assetStatus(), 200);
  assert.equal(receiptCounts(), beforeObserveFetch);
  await page.evaluate((id) => window.agentalk.exportChat(id), mediaChatId);
  assert(
    fs.existsSync(
      path.join(
        `${exportPath}.media`,
        privateAttachment.id,
        privateAttachment.file,
      ),
    ),
  );
  const blockedStage = await page.evaluate(
    async ({ chatId, topicId, bytes }) => {
      try {
        await window.agentalk.stageMedia(
          chatId,
          topicId,
          "blocked.png",
          Uint8Array.from(bytes).buffer,
        );
        return false;
      } catch {
        return true;
      }
    },
    {
      chatId: mediaChatId,
      topicId: folderConfig.topicId,
      bytes: [...fs.readFileSync(path.join(base, "public/brand/icon-256.png"))],
    },
  );
  assert(blockedStage);
  await page.evaluate(
    async ({ chatId, personId }) => {
      await window.agentalk.command("chat.observe", {
        id: chatId,
        value: false,
      });
      await window.agentalk.command("character.delete", { id: personId });
    },
    { chatId: mediaChatId, personId: folderPerson.id },
  );
  assert.equal(await assetStatus(), 403);
  await page.evaluate((id) => window.agentalk.exportChat(id), mediaChatId);
  assert(
    !fs.existsSync(path.join(`${exportPath}.media`, privateAttachment.id)),
  );
  // Sidebar order, photos, message search, info entry points, archive and duplication.
  const originalGroupId = current.selectedChatId;
  await page.getByLabel("Mesajın", { exact: true }).fill("@Ad");
  await page.getByLabel("Mesajın", { exact: true }).press("Enter");
  await page.getByLabel("Mesajın", { exact: true }).fill("@Ada Test @Bo");
  await page.getByLabel("Mesajın", { exact: true }).press("Enter");
  assert.equal(await page.locator(".mention-targets button").count(), 2);
  await page
    .getByLabel("Mesajın", { exact: true })
    .fill("@Ada Test @Bora Test Çoklu etiket testi");
  await page.getByRole("button", { name: "Mesaj gönder", exact: true }).click();
  const multi = (
    await page.evaluate(() => window.agentalk.snapshot())
  ).messages.find((m) => m.content.includes("Çoklu etiket testi"));
  assert.deepEqual(multi.to.sort(), [a.id, b.id].sort());
  await page.getByLabel("Mesajın", { exact: true }).fill("@Ad");
  await page.getByLabel("Mesajın", { exact: true }).press("Enter");
  await page.getByLabel("Mesajın", { exact: true }).fill("@Ada Testx");
  assert.equal(await page.locator(".mention-targets button").count(), 0);
  await page.getByLabel("Mesajın", { exact: true }).fill("");

  await page.locator(".chat-info-trigger").click();
  await page
    .getByRole("dialog", { name: "Grup bilgileri", exact: true })
    .waitFor();
  await page
    .getByLabel("Profil fotoğrafı seç", { exact: true })
    .setInputFiles(path.join(base, "public/brand/icon-256.png"));
  await page.locator(".profile-photo-preview img").waitFor();
  await page
    .getByRole("button", { name: "Grup ayarlarını kaydet", exact: true })
    .click();
  const groupPhoto = (
    await page.evaluate(() => window.agentalk.snapshot())
  ).chats.find((c) => c.id === originalGroupId).photo;
  assert(groupPhoto.startsWith("data:image/png;base64,"));
  await page
    .getByRole("button", { name: "Ada Test ile sohbet", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Kişi bilgileri", exact: true })
    .click();
  await page
    .getByLabel("Profil fotoğrafı seç", { exact: true })
    .setInputFiles(path.join(base, "public/brand/icon-256.png"));
  await page.locator(".profile-photo-preview img").waitFor();
  await page
    .getByRole("button", { name: "Değişiklikleri Kaydet", exact: true })
    .click();
  const personPhoto = (
    await page.evaluate(() => window.agentalk.snapshot())
  ).characters.find((c) => c.id === a.id).photo;
  await page
    .getByRole("button", { name: "Ada Test ile sohbet", exact: true })
    .click({ button: "right" });
  assert.equal(
    await page
      .getByRole("menuitem", { name: /Yukarı taşı|Aşağı taşı/ })
      .count(),
    0,
  );
  await page.keyboard.press("Escape");
  const orderBeforeDrag = (
    await page.evaluate(() => window.agentalk.snapshot())
  ).sidebarOrder;
  const preview = await page.evaluate(async () => {
    const source = document
      .querySelector('[aria-label="Bora Test ile sohbet"]')
      .closest(".sortable-sidebar-row");
    const list = source.parentElement;
    const other = list.querySelector(".sortable-sidebar-row");
    const bounds = list.getBoundingClientRect();
    const dataTransfer = new DataTransfer();
    source.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, dataTransfer }),
    );
    await new Promise(requestAnimationFrame);
    const cross = document.querySelector(
      "#sidebar-groups .sortable-sidebar-list",
    );
    const crossEvent = new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientY: cross.getBoundingClientRect().top + 2,
    });
    cross.dispatchEvent(crossEvent);
    list.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientY: bounds.top + 2,
      }),
    );
    const frames = [];
    const start = performance.now();
    await new Promise((resolve) => {
      function frame() {
        frames.push(new DOMMatrix(getComputedStyle(other).transform).m42);
        if (performance.now() - start > 260) resolve();
        else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    const line = list.querySelector(".sidebar-drop-line");
    return {
      frames,
      crossAccepted: crossEvent.defaultPrevented,
      line: line && {
        top: parseFloat(line.style.top),
        height: line.getBoundingClientRect().height,
        color: getComputedStyle(line).backgroundColor,
      },
      order: Array.from(list.querySelectorAll(".sortable-sidebar-row")).map(
        (row) => row.dataset.sortId,
      ),
    };
  });
  assert.equal(preview.crossAccepted, false);
  assert(preview.line && preview.line.height > 30 && preview.line.top === 0);
  assert.deepEqual(preview.order, [a.id, b.id]); // Native source stays mounted in its original DOM slot.
  assert(preview.frames.at(-1) > 20);
  assert(
    preview.frames.some(
      (value) => value > 1 && value < preview.frames.at(-1) - 1,
    ),
    JSON.stringify(preview.frames),
  );
  assert.deepEqual(
    (await page.evaluate(() => window.agentalk.snapshot())).sidebarOrder,
    orderBeforeDrag,
  );
  await page.screenshot({
    path: path.join(artifacts, "19-sidebar-drag-preview.png"),
  });
  await page
    .locator('[aria-label="Bora Test ile sohbet"]')
    .evaluate((button) => {
      button
        .closest(".sortable-sidebar-row")
        .dispatchEvent(new DragEvent("dragend", { bubbles: true }));
    });
  await page.locator(".sidebar-drop-line").waitFor({ state: "detached" });
  assert.deepEqual(
    (await page.evaluate(() => window.agentalk.snapshot())).sidebarOrder,
    orderBeforeDrag,
  );
  await page
    .getByRole("button", { name: "Bora Test ile sohbet", exact: true })
    .dragTo(
      page.getByRole("button", { name: "Ada Test ile sohbet", exact: true }),
      { targetPosition: { x: 20, y: 4 } },
    );
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(".person-chat-button")
        ?.getAttribute("aria-label") === "Bora Test ile sohbet",
    b.id,
  );
  assert.deepEqual(
    (await page.evaluate(() => window.agentalk.snapshot())).sidebarOrder.people,
    [b.id, a.id],
  );
  await page.locator(".search-wrap input").fill("Sadece Ada için");
  await page.locator(".message-search-results button").first().click();
  await page.locator(".search-message-hit").waitFor();
  assert(
    (await page.locator(".search-message-hit").innerText()).includes(
      "Sadece Ada için",
    ),
  );
  await page.locator(".search-wrap input").fill("Bora için özel test notu");
  assert.equal(await page.locator(".message-search-results button").count(), 0);
  await page.locator(".search-wrap input").fill("");
  await page
    .getByRole("button", { name: "Ada Test ile sohbet", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Kişiyi arşivle", exact: true })
    .click();
  await page.locator(".person-archive summary").click();
  await page
    .locator(".person-archive .person-chat-button", { hasText: "Ada Test" })
    .click();
  await page
    .getByRole("button", { name: "Arşivden çıkar", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ada Test ile sohbet", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Ada Test ile sohbet", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Kişiyi çoğalt", exact: true })
    .click();
  const personCopy = (
    await page.evaluate(() => window.agentalk.snapshot())
  ).characters.find((c) => c.name === "Ada Test (Kopya)");
  assert(
    personCopy && personCopy.id !== a.id && personCopy.photo === personPhoto,
  );
  await page.evaluate(
    (id) => window.agentalk.command("character.delete", { id }),
    personCopy.id,
  );
  await page
    .locator(".chat-list .chat-item", { hasText: "Uçtan uca test masası" })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Grubu çoğalt", exact: true })
    .click();
  const groupCopy = (
    await page.evaluate(() => window.agentalk.snapshot())
  ).chats.find((c) => c.name === "Uçtan uca test masası (Kopya)");
  assert(groupCopy && groupCopy.photo === groupPhoto);
  await page
    .locator(".chat-list .chat-item", { hasText: "(Kopya)" })
    .click({ button: "right" });
  assert.equal(
    await page
      .getByRole("menuitem", { name: /Yukarı taşı|Aşağı taşı/ })
      .count(),
    0,
  );
  await page.keyboard.press("Escape");
  await page
    .locator(".chat-list .chat-item", { hasText: "(Kopya)" })
    .dragTo(
      page
        .locator(".chat-list .chat-item")
        .filter({ hasNotText: "(Kopya)" })
        .first(),
      { targetPosition: { x: 20, y: 4 } },
    );
  await page.waitForFunction(
    (id) =>
      document.querySelector(".chat-list .sortable-sidebar-row")?.dataset
        .sortId === id,
    groupCopy.id,
  );
  const orderBeforeRestart = (
    await page.evaluate(() => window.agentalk.snapshot())
  ).sidebarOrder;
  await page.evaluate(
    async ({ copy, original }) => {
      await window.agentalk.command("chat.delete", { id: copy });
      await window.agentalk.command("chat.select", { id: original });
    },
    { copy: groupCopy.id, original: originalGroupId },
  );
  await page.screenshot({
    path: path.join(artifacts, "17-sidebar-updates.png"),
    animations: "disabled",
  });
  await application.close();
  application = await electron.launch(launchOptions);
  await isolateTestVault(application);
  page = await application.firstWindow();
  await page
    .getByRole("heading", { name: "Uçtan uca test masası", exact: true })
    .waitFor();
  current = await page.evaluate(() => window.agentalk.snapshot());
  assert.equal(
    current.chats.find((c) => c.id === current.selectedChatId).waiting,
    false,
  );
  assert.equal(current.characters.filter((c) => !c.deleted).length, 2);
  assert.deepEqual(current.sidebarOrder, orderBeforeRestart);
  assert.equal(
    current.characters.find((c) => c.id === a.id).photo,
    personPhoto,
  );
  assert.equal(
    current.chats.find((c) => c.id === originalGroupId).photo,
    groupPhoto,
  );
  assert(!Object.hasOwn(current, "decisions"));
  assert(
    current.messages.some((m) =>
      m.attachments?.some((a) => a.id === imageMessage.attachments[0].id),
    ),
  );
  await page
    .locator(`#message-${imageMessage.id} .media-token`)
    .first()
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".media-detail-view img")?.naturalWidth === 128,
  );
  await page
    .locator(".media-detail-panel")
    .getByRole("button", { name: "Kapat", exact: true })
    .click();
  const restoredGroup = current.chats.find(
    (c) => c.id === current.selectedChatId,
  );
  assert.equal(restoredGroup.heartbeatSeconds, 0.5);
  assert.equal(restoredGroup.maxParallel, 2);
  assert.equal(restoredGroup.memberPreferences[a.id].replyStyle, "concise");
  const restoredTheme = await page.evaluate(() =>
    document.documentElement.getAttribute("data-theme"),
  );
  assert.equal(restoredTheme, "midnight");
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.appearance),
    "dark",
  );
  // Portrait/landscape layout, long tabs, dark appearance and a short narrow window.
  const portraitPath = await orientedJpeg(temporary),
    rotatedPath = await rotatedVideo(temporary);
  const widePath = path.join(temporary, "wide.png"),
    soundVideoPath = path.join(temporary, "sound.webm");
  await runMedia("ffmpeg", [
    "-v",
    "error",
    "-i",
    videoPath,
    "-i",
    tonePath,
    "-c:v",
    "copy",
    "-c:a",
    "libopus",
    "-shortest",
    "-y",
    soundVideoPath,
  ]);
  await runMedia("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=600x90:rate=1",
    "-frames:v",
    "1",
    "-y",
    widePath,
  ]);
  await page.getByLabel("Medya dosyası seç", { exact: true }).setInputFiles([
    {
      name: "portrait.jpg",
      mimeType: "image/jpeg",
      buffer: fs.readFileSync(portraitPath),
    },
    {
      name: "wide.png",
      mimeType: "image/png",
      buffer: fs.readFileSync(widePath),
    },
    {
      name: "portrait.mp4",
      mimeType: "video/mp4",
      buffer: fs.readFileSync(rotatedPath),
    },
    {
      name: "sound.webm",
      mimeType: "video/webm",
      buffer: fs.readFileSync(soundVideoPath),
    },
    {
      name: "a-very-long-filename-for-audio-layout-and-horizontal-tabs.wav",
      mimeType: "audio/wav",
      buffer: fs.readFileSync(tonePath),
    },
  ]);
  await checkPreviewLayout();
  assert.equal(
    await page.getByLabel("Görüntü biçimi", { exact: true }).inputValue(),
    "jpeg",
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".media-preview-stage img")?.naturalHeight === 160,
  );
  await page.screenshot({
    path: path.join(artifacts, "24-portrait-preview.png"),
  });
  await page
    .locator(".media-file-tabs button")
    .filter({ hasText: "wide.png" })
    .click();
  await checkPreviewLayout();
  await page.screenshot({ path: path.join(artifacts, "25-wide-preview.png") });
  const sourceAppearance = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    appearance: document.documentElement.dataset.appearance,
  }));
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "obsidian-light";
    document.documentElement.dataset.appearance = "light";
  });
  // Wait for the theme's color transitions to finish before visual QA.
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".media-preview-modal"))
        .backgroundColor ===
      getComputedStyle(
        document.querySelector(".media-preview-body > .modal-actions-footer"),
      ).backgroundColor,
  );
  await checkPreviewLayout();
  await page.screenshot({ path: path.join(artifacts, "30-preview-light.png") });
  await page.evaluate((prior) => {
    document.documentElement.dataset.theme = prior.theme;
    document.documentElement.dataset.appearance = prior.appearance;
  }, sourceAppearance);
  await page
    .locator(".media-file-tabs button")
    .filter({ hasText: "portrait.mp4" })
    .click();
  await page.waitForFunction(
    () => document.querySelector(".media-preview-stage video")?.readyState >= 1,
  );
  await checkPreviewLayout();
  const priorTheme = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    appearance: document.documentElement.dataset.appearance,
  }));
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "obsidian";
    document.documentElement.dataset.appearance = "dark";
  });
  await page.screenshot({
    path: path.join(artifacts, "26-video-preview-dark.png"),
  });
  const windowGeometry = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const prior = {
      size: window.getContentSize(),
      bounds: window.getBounds(),
      min: window.getMinimumSize(),
    };
    window.setMinimumSize(740, 580);
    window.setContentSize(780, 640);
    return prior;
  });
  await page.waitForFunction(() => window.innerWidth <= 820);
  assert.equal((await checkPreviewLayout()).columns, 1);
  await page.screenshot({
    path: path.join(artifacts, "27-preview-narrow-top.png"),
  });
  await page
    .getByLabel("VP9 sıkıştırma (CRF)", { exact: true })
    .scrollIntoViewIfNeeded();
  await checkPreviewLayout();
  await page.screenshot({
    path: path.join(artifacts, "27-preview-narrow.png"),
  });
  await application.evaluate(({ BrowserWindow }, prior) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setBounds(prior.bounds);
    window.setMinimumSize(...prior.min);
    window.focus();
  }, windowGeometry);
  await page.waitForFunction(
    (size) => window.innerWidth === size[0] && window.innerHeight === size[1],
    windowGeometry.size,
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.evaluate((prior) => {
    document.documentElement.dataset.theme = prior.theme;
    document.documentElement.dataset.appearance = prior.appearance;
  }, priorTheme);
  await page
    .locator(".media-file-tabs button")
    .filter({ hasText: "sound.webm" })
    .click();
  await checkPreviewLayout();
  assert.equal(
    await page.getByLabel("Videonun sesini kaldır", { exact: true }).count(),
    1,
  );
  await page.getByLabel("Videonun sesini kaldır", { exact: true }).check();
  assert.equal(
    await page.getByLabel("Ses bit hızı (kbps)", { exact: true }).count(),
    0,
  );
  await page
    .getByRole("button", { name: "Varsayılana dön", exact: true })
    .click();
  await checkPreviewLayout();
  assert.equal(
    await page
      .getByLabel("Videonun sesini kaldır", { exact: true })
      .isChecked(),
    false,
  );
  assert.equal(
    await page.getByLabel("Ses bit hızı (kbps)", { exact: true }).count(),
    1,
  );
  await page.screenshot({
    path: path.join(artifacts, "29-video-with-audio-preview.png"),
  });
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
  // A good first file must not hide the reason why a mixed import is disabled.
  await page.getByLabel("Medya dosyası seç", { exact: true }).setInputFiles([
    {
      name: "valid.png",
      mimeType: "image/png",
      buffer: fs.readFileSync(path.join(base, "public/brand/icon-256.png")),
    },
    { name: "empty.png", mimeType: "image/png", buffer: Buffer.alloc(0) },
  ]);
  await page.locator(".media-import-problems").waitFor();
  await page.waitForFunction(
    () => !document.querySelector(".media-preview-body .media-spinner"),
  );
  assert.equal(await page.locator(".media-file-tabs > .has-error").count(), 1);
  assert.equal(await page.locator(".media-file-error").count(), 0);
  assert(await page.getByRole("button", { name: /Mesaja ekle/ }).isDisabled());
  await page
    .getByRole("button", { name: "Sorunlu dosyayı aç", exact: true })
    .click();
  assert.equal(
    await page.locator(".media-file-error .error-summary").innerText(),
    "Dosya boş",
  );
  assert.doesNotMatch(
    await page.locator(".media-file-error").innerText(),
    /100 MB|küçült/,
  );
  assert.equal(await page.locator(".media-preview-stage").count(), 0);
  const emptyFileLayout = await page
    .locator(".media-file-error")
    .evaluate((el) => {
      const r = el.getBoundingClientRect(),
        view = el.closest(".media-preview-scroll").getBoundingClientRect();
      return r.top >= view.top && r.bottom <= view.bottom;
    });
  assert(emptyFileLayout);
  await page
    .locator(
      '.media-file-tabs > div.selected button[aria-label="Medyayı kaldır"]',
    )
    .click();
  assert.equal(await page.locator(".media-import-problems").count(), 0);
  assert(
    !(await page.getByRole("button", { name: /Mesaja ekle/ }).isDisabled()),
  );
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
  // Removing the final import closes it and leaves the confirmed draft untouched.
  const draftContents = () =>
    page.locator(".composer-rich-input").evaluate((el) => ({
      text: el.innerText,
      ids: [...el.querySelectorAll("[data-attachment-id]")].map(
        (node) => node.dataset.attachmentId,
      ),
    }));
  const beforeLastFileRemoval = await draftContents();
  await page.getByLabel("Medya dosyası seç", { exact: true }).setInputFiles({
    name: "last.png",
    mimeType: "image/png",
    buffer: fs.readFileSync(path.join(base, "public/brand/icon-256.png")),
  });
  await page.waitForFunction(
    () => !document.querySelector(".media-preview-body .media-spinner"),
  );
  await page
    .locator('.media-file-tabs button[aria-label="Medyayı kaldır"]')
    .click();
  await page.locator(".media-preview-body").waitFor({ state: "detached" });
  assert.deepEqual(await draftContents(), beforeLastFileRemoval);
  await page
    .getByLabel("Medya dosyası seç", { exact: true })
    .setInputFiles(await animatedWebP(temporary));
  await page.locator(".media-file-error").waitFor();
  assert.equal(
    await page.locator(".media-file-error .error-summary").innerText(),
    "Animasyonlu WebP desteklenmiyor",
  );
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
  const newlineEditor = page.locator(".composer-rich-input");
  await newlineEditor.fill("");
  await page.getByLabel("Medya dosyası seç", { exact: true }).setInputFiles({
    name: "newline.png",
    mimeType: "image/png",
    buffer: fs.readFileSync(path.join(base, "public/brand/icon-256.png")),
  });
  await page.waitForFunction(
    () => !document.querySelector(".media-preview-body .media-spinner"),
  );
  await page.getByRole("button", { name: /Mesaja ekle/ }).click();
  await newlineEditor.evaluate((el) => {
    el.focus();
    const r = document.createRange();
    r.setStartAfter(el.querySelector("[data-attachment-id]"));
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.insertText("Yeni satır doğrulaması");
  await page.getByRole("button", { name: "Mesaj gönder", exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector(".composer-media-chip"),
  );
  const newlineMessage = (
    await page.evaluate(() => window.agentalk.snapshot())
  ).messages.findLast((message) => message.from === "user");
  assert.equal(newlineMessage.content, "\nYeni satır doğrulaması");
  assert.equal(newlineMessage.attachments[0].placement.afterLine, 2);
  await page.locator(".settings-trigger").click();
  await page.locator(".language-setting select").selectOption("de");
  await page
    .getByRole("dialog", { name: "Einstellungen", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "API-Verbindungen", exact: false })
    .waitFor();
  await page.locator(".language-setting select").selectOption("en");
  await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor();
  assert(
    (await page
      .locator(".target-name")
      .filter({ hasText: /^Everyone$/ })
      .count()) > 0,
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.screenshot({ path: path.join(artifacts, "16-english.png") });
  await application.close();
  application = await electron.launch(launchOptions);
  await isolateTestVault(application);
  page = await application.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.lang), "en");
  // Delete only fixtures; history is preserved in the temporary journal.
  const beforeDelete = await page.evaluate(() => window.agentalk.snapshot());
  page.on("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Chat with Bora Test", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Delete person", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".person-chat-button").length === 1,
  );
  const afterPersonDelete = await page.evaluate(() =>
    window.agentalk.snapshot(),
  );
  assert(afterPersonDelete.characters.find((c) => c.id === b.id).deleted);
  const historyFields = (messages) =>
    messages.map(({ id, from, content }) => ({ id, from, content }));
  assert.deepEqual(
    historyFields(afterPersonDelete.messages),
    historyFields(beforeDelete.messages),
  );
  await page
    .locator(".chat-item", { hasText: "Uçtan uca test masası" })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Delete group", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".chat-list .chat-item").length === 0,
  );
  const afterGroupDelete = await page.evaluate(() =>
    window.agentalk.snapshot(),
  );
  assert(afterGroupDelete.chats.find((c) => c.id === restoredGroup.id).deleted);
  assert(afterGroupDelete.messages.length >= afterPersonDelete.messages.length);
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: Electron UI, masa/bağlantı/karakter oluşturma, anahtarsız HTTP yanıtı, hedefli teslim, gözlem ve bağlam izolasyonu, pano kaldırma, Genel ayarları ve lisanslar, durdurma, yazıyor animasyonu, okuma tikleri, sağ tık ve silme, dil/tema değiştirme, medya seç/drop/paste önizlemesi, gerçek fotoğraf/ses/video dönüşümü ve oynatma, medya dışa aktarımı, eski medya açıklaması, PDF/metin satır içi ekleme ve taşıma, hizalama/yükseklik ve yeniden açılış.",
  );
  console.log(`Ekran görüntüleri: ${artifacts}`);
} catch (error) {
  const page = await application?.firstWindow().catch(() => null);
  if (page) {
    await page
      .screenshot({ path: path.join(artifacts, "ui-failure.png") })
      .catch(() => {});
    console.log(
      await page
        .evaluate(() => ({
          alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(
            (element) => element.textContent,
          ),
          pendingMedia: Array.from(
            document.querySelectorAll(
              ".media-file-tabs button:has(.media-spinner)",
            ),
          ).map((element) => element.textContent),
        }))
        .catch(() => ({})),
    );
  }
  throw error;
} finally {
  stoppedReplyGate?.resolve();
  await application?.close().catch(() => {});
  server.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
