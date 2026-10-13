# Base label font

`helvetiker_bold.typeface.json` comes from Three.js 0.184.0's
`examples/fonts/helvetiker_bold.typeface.json`. Its font metadata and license are
retained here. Import this local asset so Vite embeds the data in the desktop and
browser bundles. Imports from `three/examples/fonts` are externalized by the
Electron build and cannot be loaded as bare JSON imports at runtime.

`noto-sans-armenian-bold.typeface.json` contains Armenian glyphs from
Noto Sans Armenian v2.008, `NotoSansArmenian/googlefonts/ttf/NotoSansArmenian-Bold.ttf`
in the [official release](https://github.com/notofonts/armenian/releases/tag/NotoSansArmenian-v2.008).
The font is licensed under the SIL Open Font License; its copyright and license
are in `OFL-NotoSansArmenian.txt`. Conversion retains the original name metadata
and records the source TTF SHA-256. Only Armenian U+0530–U+058F and presentation
ligatures U+FB13–U+FB17 are kept; Latin and Greek continue to use Helvetiker.
Both assets use 1000-unit resolution.

To regenerate, extract the static Bold TTF from the release ZIP and run:

```sh
node scripts/convert-armenian-font.mjs /path/to/NotoSansArmenian-Bold.ttf
```

The script uses Three.js's bundled TTF converter, so it needs no extra package.
