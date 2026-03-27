import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const distDir = resolve(root, 'dist');

const staticFiles = [
  'index.html',
  'app.js',
  'app-shared.js',
  'api-client.js',
  'utils.js',
  'panel-content.js',
  'chat-export.js',
  'styles.css'
];

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

for (const file of staticFiles) {
  await cp(resolve(root, file), resolve(distDir, file));
}

console.log(`Built ${staticFiles.length} static files into ${distDir}`);
