import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Source only: no database, private configuration, environment variables or exports.
export async function developmentVersion(root) {
  const hash = createHash('sha256');
  async function include(relative) {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(relative, entry.name);
      if (entry.isDirectory()) await include(file);
      else if (/\.(?:js|mjs|css)$/.test(entry.name)) {
        hash.update(file.replaceAll('\\', '/'));
        hash.update(await readFile(path.join(root, file)));
      }
    }
  }
  for (const file of ['index.html', 'manifest.webmanifest', 'sw.js']) hash.update(await readFile(path.join(root, file)));
  for (const dir of ['assets', 'worker']) await include(dir);
  return hash.digest('hex').slice(0, 12);
}
