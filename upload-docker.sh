#!/bin/bash
# ELAVULT: a kiadás mostantól GitHub Actions-ből megy (.github/workflows/release.yml).
# A régi csakaszamok/rododentron Docker Hub image-ek változatlanul maradnak.

cat >&2 <<'MSG'
upload-docker.sh elavult, nem buildel és nem pushol semmit.

Új kiadás:
  1. VERSION fájl emelése (pl. 0.3.2), commit, push
  2. git tag v0.3.2 && git push origin v0.3.2
  3. a GitHub Actions felteszi: ghcr.io/p7y-dev/rododentron:0.3.2
MSG
exit 1
