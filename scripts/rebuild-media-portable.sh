#!/usr/bin/env bash
# Native Linux / MSYS2-MINGW64 build from the checksum-verified source archives.
set -euo pipefail
mediaSourceDirectory="${1:?Pass the verified sources directory.}"
mediaBuildDirectory="${2:?Pass an empty build directory.}"
mediaOutputDirectory="${3:?Pass the output bin directory.}"
mkdir -p "$mediaBuildDirectory" "$mediaOutputDirectory"
if [ -n "$(ls -A "$mediaBuildDirectory")" ]; then
  echo 'The media build directory must be empty.' >&2
  exit 1
fi
mediaSourceDirectory="$(cd "$mediaSourceDirectory" && pwd)"
mediaBuildDirectory="$(cd "$mediaBuildDirectory" && pwd)"
mediaOutputDirectory="$(cd "$mediaOutputDirectory" && pwd)"
mediaPrefix="$mediaBuildDirectory/prefix"
mediaJobs="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)"
mediaTarget=x86_64-linux-gcc
mediaSuffix=
mediaStaticFlags=
case "$(uname -s)" in
  Linux) ;;
  MINGW64*|MSYS*)
    mediaTarget=x86_64-win64-gcc
    mediaSuffix=.exe
    mediaStaticFlags=-static
    ;;
  *) echo 'Use Linux x64 or an MSYS2 MINGW64 shell.' >&2; exit 1 ;;
esac
for mediaCommand in gcc g++ make cmake ninja pkg-config nasm tar; do
  command -v "$mediaCommand" >/dev/null
done
mkdir -p "$mediaPrefix" "$mediaBuildDirectory/src"
export PKG_CONFIG_PATH="$mediaPrefix/lib/pkgconfig"
export CFLAGS="-O2 -I$mediaPrefix/include"
export CXXFLAGS="$CFLAGS"
export LDFLAGS="-L$mediaPrefix/lib $mediaStaticFlags"
for mediaName in zlib opus vpx webp ffmpeg; do
  mkdir "$mediaBuildDirectory/src/$mediaName"
  mediaArchive="$mediaSourceDirectory/$mediaName.tar.gz"
  if [ "$mediaName" = ffmpeg ]; then mediaArchive="$mediaSourceDirectory/ffmpeg-8.0.3.tar.xz"; fi
  tar -xf "$mediaArchive" --strip-components=1 -C "$mediaBuildDirectory/src/$mediaName"
done
cmake -G Ninja -S "$mediaBuildDirectory/src/zlib" -B "$mediaBuildDirectory/zlib-build" \
  -DCMAKE_INSTALL_PREFIX="$mediaPrefix" -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF -DZLIB_BUILD_EXAMPLES=OFF -DCMAKE_POLICY_VERSION_MINIMUM=3.5
cmake --build "$mediaBuildDirectory/zlib-build" --parallel "$mediaJobs"
cmake --install "$mediaBuildDirectory/zlib-build"
if [ -n "$mediaSuffix" ]; then
  # zlib's CMake target has a different static library name on MinGW,
  # while its pkg-config file still requests -lz.
  cp "$mediaPrefix/lib/libzlibstatic.a" "$mediaPrefix/lib/libz.a"
fi
cmake -G Ninja -S "$mediaBuildDirectory/src/opus" -B "$mediaBuildDirectory/opus-build" \
  -DCMAKE_INSTALL_PREFIX="$mediaPrefix" -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_BUILD_TYPE=Release \
  -DOPUS_BUILD_SHARED_LIBRARY=OFF -DOPUS_BUILD_PROGRAMS=OFF -DOPUS_BUILD_TESTING=OFF
cmake --build "$mediaBuildDirectory/opus-build" --parallel "$mediaJobs"
cmake --install "$mediaBuildDirectory/opus-build"
cd "$mediaBuildDirectory/src/vpx"
./configure --target="$mediaTarget" --prefix="$mediaPrefix" --enable-static --disable-shared \
  --enable-vp8 --enable-vp9 --enable-vp9-highbitdepth --enable-pic --as=nasm \
  --disable-examples --disable-tools --disable-docs --disable-unit-tests
make -j"$mediaJobs"
make install
cmake -G Ninja -S "$mediaBuildDirectory/src/webp" -B "$mediaBuildDirectory/webp-build" \
  -DCMAKE_INSTALL_PREFIX="$mediaPrefix" -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF -DWEBP_BUILD_LIBWEBPMUX=ON -DWEBP_BUILD_ANIM_UTILS=OFF \
  -DWEBP_BUILD_CWEBP=OFF -DWEBP_BUILD_DWEBP=OFF -DWEBP_BUILD_GIF2WEBP=OFF \
  -DWEBP_BUILD_IMG2WEBP=OFF -DWEBP_BUILD_VWEBP=OFF -DWEBP_BUILD_WEBPINFO=OFF \
  -DWEBP_BUILD_WEBPMUX=OFF -DWEBP_BUILD_EXTRAS=OFF
cmake --build "$mediaBuildDirectory/webp-build" --parallel "$mediaJobs"
cmake --install "$mediaBuildDirectory/webp-build"
cd "$mediaBuildDirectory/src/ffmpeg"
./configure --prefix="$mediaPrefix" --disable-gpl --disable-nonfree --disable-version3 --disable-autodetect \
  --enable-static --disable-shared --enable-ffmpeg --enable-ffprobe --disable-ffplay --disable-doc --disable-debug \
  --enable-zlib --enable-libopus --enable-libvpx --enable-libwebp --enable-pthreads \
  --pkg-config-flags=--static --extra-cflags="-I$mediaPrefix/include" --extra-ldflags="-L$mediaPrefix/lib $mediaStaticFlags"
make -j"$mediaJobs"
for mediaName in ffmpeg ffprobe; do
  cp "$mediaName$mediaSuffix" "$mediaOutputDirectory/$mediaName$mediaSuffix"
  "$mediaOutputDirectory/$mediaName$mediaSuffix" -buildconf > "$mediaOutputDirectory/$mediaName-buildconf.txt" 2>&1
  "$mediaOutputDirectory/$mediaName$mediaSuffix" -L > "$mediaOutputDirectory/$mediaName-license.txt" 2>&1
done
echo "Native media tools ready: $mediaOutputDirectory"
