# Agentalk

**Alpha · 0.1.0-alpha.3**

An Electron desktop app for conversations with independent AI characters. Connect cloud APIs or local model servers, create characters, and bring them together in direct or group chats. Each character has its own identity, inbox and conversation context, even when characters share a connection or model.

This is an early development release. This repository contains source code, tests, build scripts, application icons and third-party license notices. macOS has local development validation; Windows and Linux releases require native CI checks before publication.

## Downloads

Portable Windows x64 ZIP and Linux x64 `.tar.gz` packages are published to [GitHub Releases](https://github.com/hasan1192/agentalk/releases) after the native build and packaged UI tests pass. Extract the entire archive and run `Agentalk.exe` on Windows or `./agentalk` on Linux. Keep all extracted files together. These packages include FFmpeg/FFprobe and do not require Node.js.

The Linux build targets Ubuntu 22.04 and requires a desktop session, Electron system libraries and working Chromium sandbox support. Other Linux distributions are not validated. Packages are unsigned alpha previews without installers or automatic updates.

## Features

- Direct and group conversations, targeted messages, replies, search and archives.
- Ollama, LM Studio / OpenAI Chat Completions-compatible endpoints, Anthropic Messages and Gemini generateContent adapters.
- Independent character contexts, connection queues, persistent waiting and cancellation of stale responses.
- Read-only group observation and JSON export with associated media.
- Image, audio, video and document attachments with local conversion and preview.
- Text extraction from PDF, modern Office/OpenDocument files and supported text formats.
- Token-authenticated local bridge and folder outbox for trusted external agents.
- Turkish, English and German interfaces, with light and dark themes.

Model output requires a working model server or API connection. The app does not install or download AI models.

Agentalk sends its built-in model instructions in English and includes character instructions and chat rules in the language they were written in.

## Run from source

Use Node.js 22.13 or later, npm, and a supported desktop environment. Run these commands from the repository directory:

```sh
npm ci
node node_modules/electron/install.js
npm run media:setup
npm run build
npm start
```

The explicit Electron install step also works when npm lifecycle scripts are disabled. Media setup verifies pinned source archive hashes. On Windows/Linux it builds FFmpeg/FFprobe from those sources, so the native build tools listed in [docs/MEDIA_BUILD.md](docs/MEDIA_BUILD.md) are required. The macOS path uses the pinned preview binary when available; its legacy mirror is currently unavailable, so a fresh macOS setup needs the documented source rebuild. Internet access is required for dependency and media setup.

For development, run `npm run dev` after setup.

Add an API connection in Settings, test the connection, then create a person using that connection and a model identifier. Local server authentication is optional depending on the server. Create a group from saved people or open a direct conversation.

## Checks

```sh
npm test
npm run build
npm run test:ui
```

UI checks use a separate temporary application profile, a local test server and a test-only key vault. They do not use a real provider account or the user's application data. Test messages are synthetic. Generated screenshots are written to the ignored `artifacts/` directory.

## Data and current limits

- API keys are encrypted using Electron `safeStorage`. Saving a key is rejected if encryption is unavailable. Keys are excluded from conversation logs, character folders and exports.
- Application data is stored in the application profile, outside the source tree by default.
- External-agent folders and bridge tokens are not an operating-system process sandbox. Use the external bridge only with trusted processes; the app does not start those processes automatically.
- Context limits currently count characters rather than model tokens. Oversized context stops the call rather than silently truncating history. Automatic summarization is not implemented.
- Drafts survive chat switching during the current app session, but are not restored after quitting the app.
- Animated WebP input, OCR and analysis of embedded document images are not implemented.
- Media capabilities depend on the provider and model. The app does not silently fall back to another model or cloud service.
- Multi-device synchronization and signed/notarized distribution are not available.

## Local macOS package

`npm run package:mac` builds an ad hoc signed local preview in `release/Agentalk.app`. It is not a Developer ID-signed or notarized distribution.

## Windows and Linux release builds

After source setup, run `npm run package:desktop` on Windows or Linux to create a portable folder in `release/`. `npm run test:package` runs the full UI check against that packaged executable using a temporary profile. On a headless Linux builder, run it under Xvfb. `npm run release:archive` creates the ZIP/`.tar.gz` and a SHA-256 checksum.

The `Desktop alpha release` GitHub Actions workflow builds Windows x64 and Linux x64 on separate native runners. A version tag matching `package.json` starts the release: tests, build, license inventory and the packaged UI check must pass on both platforms before the prerelease is published. Manual workflow runs build test artifacts by default; selecting `publish_release` also publishes the checked version and creates its tag at the exact tested commit. The existing macOS local packager remains a separate command.

## Source layout

- `electron/`: storage, provider adapters, runtime, local bridge, media processing and IPC.
- `src/`: React/TypeScript interface, translations, themes and shared helpers.
- `test/`: automated checks and synthetic fixtures.
- `scripts/`: setup, development, packaging and test tools.
- `public/brand/`: application icon assets.
- `docs/`: media build/source information and third-party license texts.

## Third-party notices

Dependency notices are included in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and in the app's About screen. FFmpeg source and rebuild information is in [docs/MEDIA_SOURCES.md](docs/MEDIA_SOURCES.md) and [docs/MEDIA_BUILD.md](docs/MEDIA_BUILD.md). These third-party notices do not assign a license to Agentalk's own source code.
