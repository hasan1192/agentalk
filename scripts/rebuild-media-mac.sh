#!/bin/bash
# Agentalk's independent macOS rebuild procedure for the bundled source archives.
# This does not download or modify the installed application.
set -euo pipefail
if [ "$(uname -s)" != Darwin ]; then
  echo 'This rebuild procedure requires macOS.' >&2
  exit 1
fi
mediaSourceDirectory="${1:?Pass the MediaSources directory as the first argument.}"
mediaBuildDirectory="${2:?Pass an empty build directory as the second argument.}"
mkdir -p "$mediaBuildDirectory"
if [ -n "$(ls -A "$mediaBuildDirectory")" ]; then
  echo 'The build directory must be empty.' >&2
  exit 1
fi
mediaSourceDirectory="$(cd "$mediaSourceDirectory" && pwd)"
mediaBuildDirectory="$(cd "$mediaBuildDirectory" && pwd)"
mediaPrefix="$mediaBuildDirectory/prefix"
mediaJobs="$(sysctl -n hw.ncpu)"
mediaTarget=11.0
if [ "$(uname -m)" = x86_64 ]; then mediaTarget=10.15; fi
for command in clang make cmake meson ninja pkg-config autoconf automake tar; do
  command -v "$command" >/dev/null
 done
mkdir -p "$mediaPrefix" "$mediaBuildDirectory/src" "$mediaBuildDirectory/bin"
export MACOSX_DEPLOYMENT_TARGET="$mediaTarget"
export PKG_CONFIG_PATH="$mediaPrefix/lib/pkgconfig"
export CFLAGS="-mmacosx-version-min=$mediaTarget -I$mediaPrefix/include"
export CXXFLAGS="$CFLAGS"
export CPPFLAGS="-I$mediaPrefix/include"
export LDFLAGS="-mmacosx-version-min=$mediaTarget -L$mediaPrefix/lib"

# Every archive is pinned by runtime.json. libaom's archive has no root directory.
for name in zlib ogg vorbis opus vpx dav1d aom webp ffmpeg; do
  mkdir "$mediaBuildDirectory/src/$name"
  archive="$mediaSourceDirectory/$name.tar.gz"
  strip=1
  if [ "$name" = ffmpeg ]; then archive="$mediaSourceDirectory/ffmpeg-8.0.3.tar.xz"; fi
  if [ "$name" = aom ]; then strip=0; fi
  tar -xf "$archive" --strip-components="$strip" -C "$mediaBuildDirectory/src/$name"
done

cd "$mediaBuildDirectory/src/zlib"
./configure --static --prefix="$mediaPrefix"
make -j"$mediaJobs"
make install

for name in ogg vorbis; do
  cd "$mediaBuildDirectory/src/$name"
  ./autogen.sh
  # Current Apple linkers reject this obsolete generated Vorbis configure flag.
  if [ "$name" = vorbis ]; then sed -i '' 's/-force_cpusubtype_ALL//g' configure; fi
  ./configure --prefix="$mediaPrefix" --enable-static --disable-shared
  make -j"$mediaJobs"
  make install
done

cmake -S "$mediaBuildDirectory/src/opus" -B "$mediaBuildDirectory/opus-build" \
  -DCMAKE_INSTALL_PREFIX="$mediaPrefix" -DCMAKE_BUILD_TYPE=Release \
  -DOPUS_BUILD_SHARED_LIBRARY=OFF -DOPUS_BUILD_PROGRAMS=OFF -DOPUS_BUILD_TESTING=OFF
cmake --build "$mediaBuildDirectory/opus-build" --parallel "$mediaJobs"
cmake --install "$mediaBuildDirectory/opus-build"

cd "$mediaBuildDirectory/src/vpx"
vpxOptions=(--prefix="$mediaPrefix" --enable-static --disable-shared --enable-vp8 --enable-vp9 --enable-vp9-highbitdepth --enable-pic --disable-examples --disable-tools --disable-docs --disable-unit-tests)
if [ "$(uname -m)" = x86_64 ]; then vpxOptions+=(--as=nasm); fi
./configure "${vpxOptions[@]}"
make -j"$mediaJobs"
make install

meson setup "$mediaBuildDirectory/dav1d-build" "$mediaBuildDirectory/src/dav1d" \
  --prefix="$mediaPrefix" --libdir=lib --buildtype=release --default-library=static \
  -Denable_tools=false -Denable_tests=false
meson compile -C "$mediaBuildDirectory/dav1d-build" -j "$mediaJobs"
meson install -C "$mediaBuildDirectory/dav1d-build"

cmake -S "$mediaBuildDirectory/src/aom" -B "$mediaBuildDirectory/aom-build" \
  -DCMAKE_INSTALL_PREFIX="$mediaPrefix" -DCMAKE_BUILD_TYPE=Release \
  -DENABLE_SHARED=0 -DENABLE_EXAMPLES=0 -DENABLE_TESTS=0 -DENABLE_TOOLS=0 -DENABLE_DOCS=0 -DENABLE_NASM=1
cmake --build "$mediaBuildDirectory/aom-build" --parallel "$mediaJobs"
cmake --install "$mediaBuildDirectory/aom-build"

cmake -S "$mediaBuildDirectory/src/webp" -B "$mediaBuildDirectory/webp-build" \
  -DCMAKE_INSTALL_PREFIX="$mediaPrefix" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  -DWEBP_BUILD_LIBWEBPMUX=ON -DWEBP_BUILD_ANIM_UTILS=OFF -DWEBP_BUILD_CWEBP=OFF \
  -DWEBP_BUILD_DWEBP=OFF -DWEBP_BUILD_GIF2WEBP=OFF -DWEBP_BUILD_IMG2WEBP=OFF \
  -DWEBP_BUILD_VWEBP=OFF -DWEBP_BUILD_WEBPINFO=OFF -DWEBP_BUILD_WEBPMUX=OFF -DWEBP_BUILD_EXTRAS=OFF
cmake --build "$mediaBuildDirectory/webp-build" --parallel "$mediaJobs"
cmake --install "$mediaBuildDirectory/webp-build"

cd "$mediaBuildDirectory/src/ffmpeg"
./configure --prefix="$mediaPrefix" --disable-gpl --disable-nonfree --disable-version3 --disable-autodetect \
  --enable-static --disable-shared --enable-ffmpeg --enable-ffprobe --disable-ffplay --disable-doc --disable-debug \
  --enable-runtime-cpudetect --enable-zlib --enable-libopus --enable-libvorbis --enable-libvpx \
  --enable-libdav1d --enable-libaom --enable-libwebp --disable-libx264 --disable-libx265 \
  --disable-libxvid --disable-libfdk-aac --pkg-config-flags=--static --enable-pthreads --enable-videotoolbox \
  --extra-cflags="-I$mediaPrefix/include -mmacosx-version-min=$mediaTarget" \
  --extra-ldflags="-L$mediaPrefix/lib -mmacosx-version-min=$mediaTarget"
make -j"$mediaJobs"
for name in ffmpeg ffprobe; do
  cp "$name" "$mediaBuildDirectory/bin/$name"
  "$mediaBuildDirectory/bin/$name" -buildconf > "$mediaBuildDirectory/bin/$name-buildconf.txt" 2>&1
  "$mediaBuildDirectory/bin/$name" -L > "$mediaBuildDirectory/bin/$name-license.txt" 2>&1
done
printf 'Rebuilt media commands: %s/bin\n' "$mediaBuildDirectory"
