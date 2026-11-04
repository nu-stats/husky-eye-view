/**
 * Which picked files Husky Eye View opens before reading them, by name: .zip,
 * .gz, .bz2, .xz, .zst, .tar and the tar combinations. Small on purpose, so
 * file boxes can widen their accept lists at boot while the decoders
 * (./openArchive.js) load only with the first compressed file.
 */

/** The extensions to add to a file box's accept list. */
export const COMPRESSED_ACCEPT =
  '.zip,.gz,.tgz,.bz2,.tbz2,.tbz,.xz,.txz,.zst,.zstd,.tzst,.tar';

const COMPRESSED_NAME = /\.(zip|gz|tgz|bz2|tbz2?|xz|txz|zstd?|tzst|tar)$/i;

/** Whether a file's name says it is compressed or an archive. */
export function isCompressedName(name) {
  return COMPRESSED_NAME.test(String(name || ''));
}

/** A box's accept list with the compressed extensions added once. */
export function withCompressed(accept) {
  const list = String(accept || '')
    .split(',')
    .map((ext) => ext.trim())
    .filter(Boolean);
  for (const ext of COMPRESSED_ACCEPT.split(','))
    if (!list.some((have) => have.toLowerCase() === ext)) list.push(ext);
  return list.join(',');
}

/** The extensions in an accept list (`.csv,.json` → ['.csv', '.json']). */
export function acceptExtensions(accept) {
  return String(accept || '')
    .split(',')
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => ext.startsWith('.'));
}
