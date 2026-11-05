# Unpacker

Opens compressed files picked in Husky Eye View's file boxes (My files, the
Stata/R/SPSS/Excel boxes, Merge & Export, Curated Flights' *Your data*, scene
import and scene data packs): `.zip`, `.gz`, `.bz2`, `.xz`, `.zst`, `.tar` and
the tar combinations (`.tar.gz`/`.tgz`, `.tar.bz2`, `.tar.xz`, `.tar.zst`).
Everything is unpacked in the browser; nothing is sent anywhere.

| File | What it does |
| --- | --- |
| `unpack.js` | Tells the kind from the first bytes and opens it; zip (stored, deflate, bzip2, Zstandard and xz entries, Zip64), gzip, tar. Every checksum is checked; damaged, password-protected, 7-Zip and RAR files are refused with plain messages. |
| `bunzip.js`, `unxz.js`, `unzstd.js`, `crc32.js` | bzip2, xz (LZMA2) and Zstandard decoders and CRC-32, written from the published format descriptions. Gzip and deflate use the browser's own `DecompressionStream`. |
| `names.js` | Which names count as compressed, and the extensions to add to accept lists (loaded at boot; the decoders load with the first compressed file). |
| `openArchive.js` | Husky Eye View's rules: a zip holding a shapefile stays whole for the shapefile readers (a tar of shapefile parts is put in one zip); KMZ and Excel files inside an archive stay whole; names such as `.rds` or `.zsav`, compressed inside, are never opened. |

`src/ui/openCompressed.js` puts it in front of each box and asks which file
to use when an archive holds several.

## Origin and license

`unpack.js`, `bunzip.js`, `unxz.js`, `unzstd.js`, `crc32.js`, the tests and
the `fixtures/` files come from Husky Explorer (nu-stats/husky-explorer,
`app/web/lib/`), by the same authors, under MIT OR Apache-2.0; here they are
used under this repository's [MIT License](../../../LICENSE). They are
reformatted to this repository's Prettier style; `unpack.test.mjs` builds its
test zips with `node:zlib` instead of the `fflate` package. They have no
dependencies.

The fixtures were made with XZ Utils 5.8.3 and the Zstandard CLI 1.5.7 (see
the comment at the top of `unxz-unzstd.test.mjs`).
