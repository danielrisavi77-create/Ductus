# Interface fonts: source, version, checksums, licences

The three interface font families of design v6 (D-89) are kept in this
directory and loaded with `next/font/local` (`index.ts`), so `pnpm build` needs
no network access (DAN-121) and the browser gets them from our own origin.

## Files

Downloaded unchanged from Google Fonts on 10 October 2026. They are the same
bytes that `next/font/google` fetched at build time before DAN-121: variable
fonts (weight axis), WOFF2, subsets `latin` and `latin-ext` only. The
`cyrillic`, `greek` and `vietnamese` subsets that Google also offers are not
kept, because the interface is Croatian (English to follow).

| File | Bytes | SHA-256 | Google Fonts URL |
| --- | ---: | --- | --- |
| `InstrumentSans-latin.woff2` | 29904 | `6219bc4bfdfc5d9b2201dcdf046218b122a758f932e25ed5f168f929b7ca2311` | `https://fonts.gstatic.com/s/instrumentsans/v4/pxiTypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr0SZe1ZuWi3g.woff2` |
| `InstrumentSans-latin-ext.woff2` | 11092 | `21fac8da552a915e7a9fb84c5afaeb85d35507b2616346d592e78128c1cfe3e0` | `https://fonts.gstatic.com/s/instrumentsans/v4/pxiTypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr0She1ZuWi3hKpA.woff2` |
| `Newsreader-latin.woff2` | 58152 | `2a69ec1c0fb79a464de0e19957cdb3a65b5f626d85fffd164f9de557d3a64878` | `https://fonts.gstatic.com/s/newsreader/v26/cY9VfjOCX1hbuyalUrK49dLac06G1ZGsZBtoBAbNJYQ5ayZC.woff2` |
| `Newsreader-latin-ext.woff2` | 36328 | `fe52554ab1cd7dd9704db81572f45ef0eb122679c35bbbbc728baf701033b727` | `https://fonts.gstatic.com/s/newsreader/v26/cY9VfjOCX1hbuyalUrK49dLac06G1ZGsZBtoBAbDJYQ5ayZCzn4.woff2` |
| `JetBrainsMono-latin.woff2` | 31340 | `2c32b9b3ee358c119e210f6f5195f9bd34894d78a785ff2e95d60e718e400af4` | `https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwgknk-4.woff2` |
| `JetBrainsMono-latin-ext.woff2` | 11596 | `9c38cb2d0d2d93c1ee6e21fa78db76f13ea7e15e15cc64214c7ca89b6aaa35c4` | `https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx7cwgknk-6nFg.woff2` |

Font files: 178412 bytes in total.

The file URLs come from the style sheets below, requested with a current
desktop Chrome `User-Agent` (that is what selects WOFF2). The `unicode-range`
values in `index.ts` are copied from the same style sheets.

| Family | Google Fonts version | Style sheet | Upstream repository and commit (google/fonts `METADATA.pb`) |
| --- | --- | --- | --- |
| Instrument Sans | v4 | `https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&display=swap` | `https://github.com/Instrument/instrument-sans` at `7fa22308a3d0c94ee2b3cd537a1196b65db34a3e` |
| Newsreader | v26 | `https://fonts.googleapis.com/css2?family=Newsreader:wght@400;500&display=swap` | `https://github.com/productiontype/NewsReader` at `1ece6a8bfe5db1a2b90c76cc1fe5d3b2eed5dcf3` |
| JetBrains Mono | v24 | `https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap` | `https://github.com/JetBrains/JetBrainsMono` at `19371302b95d218af43299bce79ddbddd0bc364d` |

As served for these requests, Newsreader has its optical-size axis fixed at the
default and Instrument Sans its width axis fixed at 100 %. Keep that when
updating: a file with a free optical-size axis would change how headings look.

## Licences

All three families are under the SIL Open Font License, Version 1.1, with no
Reserved Font Name. The licence texts are copied unchanged from
`https://github.com/google/fonts` at commit
`bd8f81ddb5c74d5c8897b36ad88b440266245103`.

| Family | Licence file | From | SHA-256 |
| --- | --- | --- | --- |
| Instrument Sans | `OFL-InstrumentSans.txt` | `ofl/instrumentsans/OFL.txt` | `9e27a72ed30eb49a08678f6a5d6ed98ec7ba5368f541637ee0683ec9134ef966` |
| Newsreader | `OFL-Newsreader.txt` | `ofl/newsreader/OFL.txt` | `fdfad38143ec470553cae82a1e45320bdd1b9ec70415d37bd0171051d8a4ded8` |
| JetBrains Mono | `OFL-JetBrainsMono.txt` | `ofl/jetbrainsmono/OFL.txt` | `b2fe5e8987594e9ffd1d2ca52a2f5d73eb8335243893c5d6254b5ad69269591d` |

## Updating

Replace a file only together with its row above. The test
`src/components/fonts/local-fonts.test.ts` fails when a checksum does not match
this table, when a Croatian letter is missing from a family, or when a file
here is not loaded by `index.ts`.
