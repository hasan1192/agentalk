# FFmpeg sources and licenses bundled with Agentalk

Agentalk runs the independent FFmpeg / FFprobe command-line executables as child processes. It does not link the Electron application to their libraries. The executables are FFmpeg **n8.0.3**, distributed under **LGPL-2.1-or-later**, with GPL, nonfree and version-3-only components disabled. Agentalk does not modify FFmpeg source code. Ad hoc macOS signing changes the binary signature, not its source.

The `MediaSources` directory is in `resources/` in Windows/Linux portable packages and `Agentalk.app/Contents/Resources` in the macOS preview. It contains:

- `ffmpeg-8.0.3.tar.xz`: complete corresponding FFmpeg source, including license texts.
- `rebuild-media-mac.sh`, `rebuild-media-portable.sh` and `MEDIA_BUILD.md`: Agentalk's independent native rebuild procedures and instructions.
- Source archives for the pinned zlib, libogg, libvorbis, libopus, libvpx, dav1d, libaom and libwebp versions. The native Windows/Linux build links zlib, libopus, libvpx and libwebp; the other archives are also retained for the macOS preview build. Their copyright, licenses and patent notices are in `licenses/` and in each source archive.
- Additional per-file FFmpeg/Opus notices, the Independent JPEG Group acknowledgment and license headers, dav1d's patent notice, and third-party notices from libaom/libvpx source archives. Optional tools, tests and architecture-specific code in those archives may not be compiled into the media executables.
- `runtime.json`: exact upstream URLs and SHA-256 values for binaries and sources.
- `ffmpeg-buildconf.txt` and `ffprobe-buildconf.txt`: configure options recorded directly from the included executables.

To rebuild the media executables, follow `MEDIA_BUILD.md` and run the appropriate script against the supplied archives in an empty working directory. Windows/Linux use Agentalk's native `rebuild-media-portable.sh`; macOS uses `rebuild-media-mac.sh`. Different compiler versions can change binary hashes. The legacy macOS preview binary builder is referenced in `runtime.json`; that mirror is no longer available and its unlicensed build scripts are not redistributed. Windows/Linux do not depend on that mirror.

During development, `npm run media:setup` downloads these exact archives and verifies their hashes. They are kept under ignored `vendor/media/`. Packaging refuses missing or mismatched source archives. The Hakkında/About screen opens this source directory; complete LGPL text is also shown there. `MediaLicenses/` holds another copy of the component license notices.

FFmpeg and its contributors retain their copyright. FFmpeg is a trademark of Fabrice Bellard. Agentalk makes no ownership claim over FFmpeg or its dependencies and places no restriction on inspecting or replacing these independent executables under their licenses.

This software is based in part on the work of the Independent JPEG Group. Agentalk does not change FFmpeg's `libavcodec/jfdctfst.c`, `libavcodec/jfdctint_template.c` or `libavcodec/jrevdct.c`; their upstream license headers and implementation notes are retained in the source archive and reproduced in `licenses/IJG-NOTICE.txt`.

References: [FFmpeg source releases](https://ffmpeg.org/releases/), [FFmpeg license information](https://ffmpeg.org/legal.html), [exact build source](https://github.com/AtlasYang/ffmpeg-static-builds/tree/ffmpeg-8.0.3-build4).
