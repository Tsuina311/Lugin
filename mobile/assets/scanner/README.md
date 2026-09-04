# Optional bundled card-name seed for offline-first mobile installs.
#
# Produce a production seed (not committed by default — large):
#
#   yarn scan:index --out mobile/assets/scanner/card-names.json
#   # or copy from dist-web/card-names.json after Pages build
#
# Without this file the app still works: first launch loads from GitHub Pages
# (or disk cache) and persists under documentDirectory/lugin-scanner/.
# Title identification never calls Scryfall per scan.
