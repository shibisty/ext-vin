# VIN Decoder

A browser extension for Chrome and Firefox (Manifest V3) with a popup and a sidebar: VIN decoding from local tables, an offline copy of the NHTSA vPIC database, recall campaigns, a VIN generator and the "Guess the VIN" game. Written in TypeScript, built with Vite, tested with Vitest.

## Commands

```sh
npm install             # once
npm run build           # type check + build for Chrome and Firefox (without the Mitchell 1 reference)
npm run build:chrome    # Chrome only → dist/chrome
npm run build:firefox   # Firefox only → dist/firefox
npm run build:mitchell  # both builds with the Mitchell 1 reference
npm run dev             # rebuild dist/chrome on every change (with source maps, no zip)
npm run dev:firefox     # the same for dist/firefox
npm test                # all tests
npm run typecheck       # type check only
```

The build puts the unpacked extension into `dist/chrome` and `dist/firefox`, and next to them the store archives
`dist/vin-decoder-<version>-chrome.zip` and `dist/vin-decoder-<version>-firefox.zip` (with the reference, suffixed `-mitchell`).
The version comes from `package.json`. The `vite build --mode …` mode is made of parts joined with "-": `chrome` or `firefox`,
`mitchell`, `development` (for example, `--mode firefox-mitchell`).

Installing for testing:
- **Chrome**: `chrome://extensions` → "Developer mode" → "Load unpacked" → the `dist/chrome` folder. After `npm run dev`, just click "Reload" on the extension.
- **Firefox**: `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on…" → the `dist/firefox/manifest.json` file (until the browser restarts) or the zip archive. Requires Firefox 142+.

## Popup and sidebar

There is a single UI (`popup.html`); the build copies it to `sidebar.html` for the sidebar. `theme-init.js` sets the page view
from the file name (`<html data-view="popup|sidebar">`): the popup is 400 px wide, the sidebar follows the panel width.

- **Chrome** (116+): the popup has an "◨ Open in sidebar" button (`chrome.sidePanel.open`); the panel is also available from Chrome's side panel menu.
- **Firefox**: the same button (`browser.sidebarAction.open`); the panel is also listed under "View → Sidebar".
- Both APIs open the panel only on a user action, so `open()` is called directly in the click handler, with no `await` before it (`src/sidebar.ts`).
- The popup and the sidebar are pages of the same extension and share `localStorage`: a language or theme change in the popup is applied to an open sidebar right away.

## Per-browser builds

The manifest is not stored in the repository: `src/manifest.ts` builds it (common part plus browser-specific differences), and
`build/extension-plugin.ts` writes it into the build. The same plugin creates `sidebar.html`, checks that the build contains every file the manifest refers to,
and on a regular build (not `--watch`) writes the zip with its own writer `build/zip.ts` (forward-slash paths, fixed timestamps — the archive is reproducible).

| | Chrome | Firefox |
|---|---|---|
| Sidebar | `side_panel` + `sidePanel` permission | `sidebar_action` |
| Minimum version | 116 | 142 |
| Code | minified | not minified (AMO review without separate sources) |
| Other | — | `browser_specific_settings.gecko`: id `vin-decoder@shibisty`, `data_collection_permissions: none` |

About Firefox:
- **Gecko id** `vin-decoder@shibisty` is a placeholder (the `GECKO_ID` constant in `src/manifest.ts`). It can be changed before the first AMO release, not after.
- **Data collection** is declared as `none`: there are no own servers and no analytics. The entered VIN is sent only to the NHTSA API (recalls and decoding),
  and only the model name is sent to Wikipedia for the photo (can be turned off in settings). If AMO review treats sending the VIN as data collection, add the
  category to `data_collection_permissions` in `src/manifest.ts`.
- Site permissions (`host_permissions`) are granted at install time in Firefox 127+; if the user revokes them, recalls and photos stop loading.
- Checking the archive with the AMO linter: `npx addons-linter dist/vin-decoder-<version>-firefox.zip` (currently 0 errors, 0 warnings).

## Mitchell 1 reference — a separate package

All data from the commercial Mitchell 1 "2009 VIN Decoding" reference, and the decoders built only on it, live in `src/mitchell.ts`
(tables: `src/data/legacy-us.ts`, `legacy-trucks.ts`, `euro-tables.ts`, `mitchell-engines.ts`). The core (`decode.ts`) works without them, on open sources only.

- Extension: `npm run build` builds without the reference (the module is not included), `npm run build:mitchell` (or `VIN_MITCHELL=1`) builds with it, for both browsers.
- Library and website: the package is enabled explicitly — `import { useMitchell } from './decode'; import { MITCHELL } from './mitchell'; useMitchell(MITCHELL);`
- Tests enable the package in `tests/setup.ts` (the golden snapshot was taken with it); `tests/mitchell.test.ts` checks how things work without it.

Without the package, formats known only from the reference are not recognized: AMC 1974–1980, US trucks and Jeep 1974–1980, Colt/Champ,
VW chassis number tails, Volvo and Jaguar numbers, Porsche and VW engine numbers, Mazda chassis numbers 1979–1980; for the rest, the "per the Mitchell 1 reference" rows disappear.

## Structure

```
popup.html            UI entry point (Vite); copied to sidebar.html at build time
build/
  extension-plugin.ts manifest.json, sidebar.html, build check, zip
  zip.ts              ZIP writer for store archives
src/
  manifest.ts         manifest for Chrome and Firefox
  sidebar.ts          opening the sidebar (sidePanel / sidebarAction)
  popup.ts            UI: tabs, decoding, recalls, generator, game, settings
  decode.ts           local decoder: ISO 3779, partial VINs, pre-1981 formats, JDM
  mitchell.ts         separate Mitchell 1 reference package (enabled via useMitchell)
  nhtsa.ts            offline vPIC decoder (spVinDecode algorithm) and VIN generator
  explain.ts          per-position rules and data sources
  game.ts             "Guess the VIN" game
  carimage.ts         model photo from Wikipedia / Wikimedia Commons
  i18n.ts             Russian UI with English translation
  theme-init.ts       theme and language before first paint (built as a separate classic script)
  types.ts            decoding result types
  data/               reference tables (vininfo, Wikibooks, Mitchell 1 and others, see NOTICE.txt)
public/               copied to dist/<browser> as is
  nhtsa/              vPIC database: index, lookup, shards, specs (generated by tools/build_nhtsa.py)
tests/                Vitest; popup.test.ts and carimage.test.ts run in happy-dom
tools/build_nhtsa.py  builds public/nhtsa from a vPIC dump
tools/build_wmi_wiki.py   WMI dictionary (src/data/wmi-wiki.ts) from the Wikipedia article saved in tools/sources
tools/build_plants_us.py  GM/Ford/Chrysler plants (src/data/plants-us-wb.ts) from Wikibooks pages in tools/sources
tools/build_jdm_wiki.py   Japanese model chassis codes (src/data/jdm-wiki.ts) from Japanese Wikipedia infoboxes in tools/sources
tools/build_ussr.py       former USSR plant WMIs and model indices (src/data/ussr.ts) from the Russian Wikipedia export in tools/sources
tools/build_tpocr.py      Ford/Mercury/Lincoln, GM, AMC and Chrysler 1965–1975: series, body, engine (src/data/legacy-tp.ts) from the tpocr.com export in tools/sources
tools/build_bmw02.py      BMW 02 US number ranges (src/data/bmw02.ts) from the table in tools/sources
tools/build_p356.py       Porsche 356 chassis numbers (src/data/p356.ts) from the text of Porsche Classic catalogues KAT071/KAT072 (paths as arguments)
tools/build_mitchell_engines.py  Porsche/VW/Mercedes engine numbers and Mazda 1979–1980 (src/data/mitchell-engines.ts) from the Mitchell 1 PDF (path as argument)
```

## Tests

- `golden.test.ts` — comparison with a golden snapshot taken from the original JS version: 124 numbers of all kinds plus 60 generated ones and 4 game rounds. Catches any change in behavior. If behavior changes on purpose, update the snapshot: `UPDATE_GOLDEN=1 npm test` (in PowerShell: `$env:UPDATE_GOLDEN=1; npm test`) and review the diff of `tests/fixtures/golden.json`.
- `decode`, `nhtsa`, `explain-i18n-game`, `carimage` — per-module rules; the network is stubbed, the NHTSA database is read from disk.
- `nhtsa-api.test.ts` — compares the offline decoder with the live vPIC API on 16 numbers (cars, trucks, trailers, buses, a motorcycle); API responses are in `tests/fixtures/vpic-api.json`.
- `popup.test.ts` — popup scenarios in the DOM: input, tabs, recalls, generator, game, language and theme switching.
- `extension.test.ts` — manifest for both browsers, the ZIP writer (read-back, CRC, reproducibility), opening the sidebar with fake APIs.

Model-year rules depend on the current date, so the golden tests fix the date.

## Updating the NHTSA database

1. Download the latest "vPIC List Lite (plain SQL)" dump from https://vpic.nhtsa.dot.gov/downloads and unpack the `.sql` (about 340 MB).
2. `cd tools && python3 build_nhtsa.py path/to/vPICList_lite_YYYY_MM.sql ../public/nhtsa` — takes about two minutes. Repeated builds are faster with a cache:
   `VPIC_CACHE=tables.pickle python3 build_nhtsa.py dump.sql x` (saves the parsed tables), then `VPIC_CACHE=tables.pickle python3 build_nhtsa.py - ../public/nhtsa`.
3. `npm test`: the golden snapshot and the API comparison show what changed. If NHTSA adds elements, put their new labels in `src/data/nhtsa-elements.ts`.
