#!/bin/zsh
set -e
cd -- "${0:A:h}"
if [[ -d release/Agentalk.app ]]; then
  open "$PWD/release/Agentalk.app"
  exit 0
fi
if [[ ! -d node_modules || ! -f node_modules/electron/path.txt ]]; then
  print 'Bağımlılıklar eksik. README.md içindeki kurulum adımlarını uygula.'
  exit 1
fi
if [[ ! -f dist/index.html ]]; then
  npm run build
fi
npm start
