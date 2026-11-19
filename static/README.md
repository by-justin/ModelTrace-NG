# static

These two files are inputs of the Codex plugin (`codex-plugin/build-plugin.mjs` bundles them, and
its tests check their hashes), so they stay here unchanged:

- `fingerprint-core.js` — the plugin's JavaScript scorer for the frozen bank `data/unified_bank.json`
- `styles.css` — the plugin dashboard's shared theme

The public site is `web/`; its scorer is the Go core in `core/`.
