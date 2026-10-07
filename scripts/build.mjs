import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const dist = path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'server'), { recursive: true });
await mkdir(path.join(dist, 'client'), { recursive: true });
await mkdir(path.join(dist, '.openai'), { recursive: true });
await cp(path.join(root, 'index.html'), path.join(dist, 'client', 'index.html'));
await cp(path.join(root, 'assets'), path.join(dist, 'client', 'assets'), { recursive: true });
await build({
  entryPoints: [path.join(root, 'worker', 'index.js')],
  outfile: path.join(dist, 'server', 'index.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
});
await cp(path.join(root, '.openai', 'hosting.json'), path.join(dist, '.openai', 'hosting.json'));
// Carry migrations with both local and hosted builds.
await cp(path.join(root, 'drizzle'), path.join(dist, '.openai', 'drizzle'), { recursive: true });

const hostingPath = path.join(dist, '.openai', 'hosting.json');
const hosting = JSON.parse(await readFile(hostingPath, 'utf8'));
delete hosting.static;
await writeFile(hostingPath, JSON.stringify(hosting, null, 2) + '\n');
