# License notice sources

The complete texts displayed in About are in `src/legal-notices.json` and `THIRD_PARTY_NOTICES.md`. This directory contains their media and runtime-helper source texts. Both `MediaLicenses/` and `MediaSources/licenses/` in the macOS application contain an unchanged copy of this directory. Electron's complete version-specific runtime inventory is separately preserved as `Contents/Resources/LICENSES.chromium.html`.

Primary media licenses, authors and patent notices come from the exact source archives listed with URLs and SHA-256 hashes in `docs/media-runtime.json`. Additional notices:

| File                           | Original source                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IJG-NOTICE.txt`               | The acknowledgment and original leading comments in FFmpeg n8.0.3's `libavcodec/jfdctfst.c`, `jfdctint_template.c`, `jrevdct.c`                                |
| `FFmpeg-EXTRA-NOTICES.txt`     | Verbatim leading copyright/permission comments in the supplied FFmpeg source's libraries, compatibility code and command-line tools, including x86inc          |
| `opus-EXTRA-NOTICES.txt`       | Verbatim leading BSD/permission comments in the supplied Opus 1.6.1 source, including SILK and KISS FFT copyright holders                                      |
| `opus-LICENSE_PLEASE_READ.txt` | Opus 1.6.1's root `LICENSE_PLEASE_READ.txt`                                                                                                                    |
| `dav1d-PATENTS.txt`            | dav1d 1.5.4's `doc/PATENTS`                                                                                                                                    |
| `aom-THIRD-PARTY-NOTICES.txt`  | License, copying and patent files under `third_party/` in the supplied libaom 3.15.0 archive                                                                   |
| `vpx-THIRD-PARTY-NOTICES.txt`  | License, copying and patent files under `third_party/` in the supplied libvpx 1.17.0 archive                                                                   |
| `Feather-LICENSE.txt`          | [Feather v4.29.2 MIT license](https://github.com/feathericons/feather/blob/v4.29.2/LICENSE), supplementary to Lucide's ISC notice referring to Feather origins |
| `Vite-runtime-LICENSE.txt`     | Installed Vite's core MIT license; the renderer includes its module-preload helper                                                                             |
| `Rolldown-runtime-LICENSE.txt` | Installed Rolldown's `LICENSE` and `THIRD-PARTY-LICENSE`, retaining Rollup and esbuild credits for generated helpers                                           |

Source comments are deduplicated only when identical after whitespace/comment-decoration normalization; the displayed original notice is retained. Optional tools, tests and platform-specific source code in the supplied archives may not be compiled into FFmpeg. Including their notices does not change the selected executable's LGPL license. Full source archives retain every original per-file license, including files not used in this build.

`npm run licenses:check` checks runtime dependency coverage, the dependency code found in renderer source maps, installed license changes, media source version URLs, and consistency between this directory, About and the notices document. It also runs after each build and before packaging. Changing dependencies or media versions requires reviewing the new original texts and updating this inventory.

Document parsing adds PDF.js 6.4.299 (Apache-2.0), fflate 0.8.3 (MIT), saxes 6.0.0 (ISC) and xmlchars 2.2.0 (MIT). PDF.js, fflate and xmlchars texts come from the installed pinned npm packages. The saxes npm archive omits its license file; `saxes-LICENSE.txt` is the complete [v6.0.0 upstream license](https://raw.githubusercontent.com/lddubeau/saxes/v6.0.0/LICENSE), including the original sax and historical permission notices. Its SHA-256 is checked by the license checker. The macOS package ships only the PDF.js JavaScript modules used for text extraction, without optional native canvas, image-decoding WASM or extra fonts.
