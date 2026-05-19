import { statSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
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
await rewriteRelativeModuleSpecifiers(distDir);

async function rewriteRelativeModuleSpecifiers(root) {
  for (const filePath of await listJavaScriptFiles(root)) {
    const source = await readFile(filePath, 'utf8');
    const rewritten = source.replace(/(from\s+['"])(\.\.?\/[^'"]+)(['"])/g, (_match, prefix, specifier, suffix) => {
      return `${prefix}${resolveModuleSpecifier(filePath, specifier)}${suffix}`;
    });
    await writeFile(filePath, rewritten);
  }
}

async function listJavaScriptFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = join(root, entry.name);

    if (entry.isDirectory()) {
      return listJavaScriptFiles(entryPath);
    }

    return entry.isFile() && extname(entry.name) === '.js' ? [entryPath] : [];
  }));

  return files.flat();
}

function resolveModuleSpecifier(importerPath, specifier) {
  const targetPath = resolve(dirname(importerPath), specifier);
  const resolvedPath = resolveJavaScriptModule(targetPath);
  const relativePath = relative(dirname(importerPath), resolvedPath).split(sep).join('/');
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

function resolveJavaScriptModule(targetPath) {
  const candidates = [
    targetPath,
    `${targetPath}.js`,
    join(targetPath, 'index.js')
  ];

  for (const candidate of candidates) {
    if (isFileSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Could not resolve emitted module import: ${targetPath}`);
}

function isFileSync(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
