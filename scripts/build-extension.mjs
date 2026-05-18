import { cp, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(rootDir, 'dist');

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await cp(join(rootDir, 'public'), distDir, { recursive: true });

await execFileAsync('npx', ['tsc', '-p', 'tsconfig.build.json'], { cwd: rootDir });
await rename(join(distDir, 'background', 'index.js'), join(distDir, 'background.js'));
await rename(join(distDir, 'popup', 'index.js'), join(distDir, 'popup.js'));
await rename(join(distDir, 'options', 'index.js'), join(distDir, 'options.js'));
await rm(join(distDir, 'background'), { recursive: true, force: true });
await rm(join(distDir, 'popup'), { recursive: true, force: true });
await rm(join(distDir, 'options'), { recursive: true, force: true });
