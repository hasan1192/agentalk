Early alpha release of Agentalk, an Electron desktop app for conversations with independent AI characters.

## Downloads

- **Windows x64:** extract the entire ZIP and run `Agentalk.exe` inside the extracted folder.
- **Linux x64:** extract the `.tar.gz` and run `./agentalk` inside the extracted folder. A desktop session, Electron system libraries and Chromium sandbox support are required. The package is built and tested on Ubuntu 22.04; other distributions have not been validated.
- **macOS:** build the existing local preview from source using `npm run package:mac`. A downloadable macOS package is not included in this release.

Keep all extracted files together. Node.js and a separate FFmpeg installation are not required for the portable packages. SHA-256 checksum files accompany the archives.

## Validation

Windows and Linux packages are built on their respective GitHub-hosted runners. Core/media/document/vault tests, the UI build, license checks and the packaged Electron UI test must all pass before these downloads are published. UI tests use only synthetic messages, a temporary profile and a test-only vault; real provider accounts and user data are not used. Real-world provider/model quality and every desktop environment are not covered by these checks.

## Current limits

These are unsigned alpha packages without an installer or automatic updates. Linux API key storage requires a supported OS keyring; plaintext fallback is refused. External agents must be trusted: separate folders are not a process sandbox. Drafts do not survive quitting the app. Animated WebP, OCR and document image analysis are not implemented.

FFmpeg/FFprobe and their matching source archives, build information and license notices are included. Electron/Chromium and other third-party notices are included in the package and available from About.
