# Rebuilding the media commands

## Windows and Linux

Windows/Linux portable releases build FFmpeg 8.0.3 directly from the checksum-pinned source archives. The native build links static zlib, libopus, libvpx and libwebp. FFmpeg's built-in decoders/encoders are also available; GPL, nonfree, version3 components and automatic dependency discovery are disabled. Additional source archives remain available for the macOS preview build. No external binary mirror is used on Windows/Linux.

On Linux x64, install GCC/G++, make, CMake, Ninja, pkg-config and NASM. On Ubuntu 22.04 these are provided by `build-essential cmake ninja-build pkg-config nasm`. On Windows x64 use an MSYS2 MINGW64 shell with `base-devel mingw-w64-x86_64-gcc mingw-w64-x86_64-cmake mingw-w64-x86_64-ninja mingw-w64-x86_64-pkgconf mingw-w64-x86_64-nasm`, with Node.js on `PATH`.

In a source checkout, `npm run media:setup` downloads and verifies the source archives, then builds into `vendor/media/bin`. To use already supplied source archives independently:

```sh
bash /path/to/MediaSources/rebuild-media-portable.sh /path/to/MediaSources /path/to/empty-build /path/to/output-bin
```

The script preserves the original source files. Its exact configure output is recorded with the package. Native Windows/Linux media compilation is checked in the release workflow before packaging.

## macOS

`rebuild-media-mac.sh` is Agentalk's independent rebuild procedure. It uses the complete pinned FFmpeg and codec source archives next to this document and does not download code or change the installed application. These archives and their upstream build files retain their original licenses.

Prerequisites: Xcode command line tools (Apple clang and SDK), make, CMake, Meson, Ninja, pkg-config, autoconf, automake and GNU libtool (`glibtoolize` on macOS). Intel builds also need NASM. Make sure these tools are on `PATH`. The selected deployment target is macOS 11.0 for arm64 or 10.15 for x86_64. Build on the architecture you want to use.

Run from Terminal, using an empty working directory outside the application bundle:

```sh
bash /path/to/MediaSources/rebuild-media-mac.sh /path/to/MediaSources /path/to/empty-media-build
```

For development, the source directory is `vendor/media/sources` after `npm run media:setup`; the script is `scripts/rebuild-media-mac.sh`. The archive URLs and SHA-256 hashes are in `runtime.json` (development: `docs/media-runtime.json`). Setup and packaging verify their hashes.

The script builds static zlib, libogg, libvorbis, libopus, libvpx, dav1d, libaom and libwebp in a private prefix, then builds the independent FFmpeg and FFprobe commands with GPL, nonfree, version3 and automatic library discovery disabled. All selected libraries and the exact configuration of the shipped executable are recorded in `ffmpeg-buildconf.txt` and `ffprobe-buildconf.txt`. The generated legacy Vorbis configure file loses the unsupported Apple `-force_cpusubtype_ALL` linker flag; codec source files and FFmpeg source are unchanged.

Outputs are in the working directory's `bin/`. Compiler/tool versions can change byte hashes. This independent procedure is provided for rebuilding and replacing the media commands; a full rebuild with this procedure has not been run as part of the license audit. For the configuration of the actual shipped executable, use the included build configuration records. The original binary build repository is linked in `runtime.json`; its scripts archive is not redistributed because that archive does not include a license for those scripts.

Agentalk's development media commands are `vendor/media/bin/ffmpeg` and `ffprobe`. In the macOS application they are `Contents/Resources/app/electron/bin/ffmpeg` and `ffprobe`. Replacing commands inside a signed app requires re-signing the changed executable and local app bundle. The media tools remain separate commands, and Agentalk imposes no restriction on replacement or inspection under their original licenses. Retain all license/source notices when redistributing them.
