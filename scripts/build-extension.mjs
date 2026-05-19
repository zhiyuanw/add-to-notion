import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(rootDir, 'dist');
const notionOAuthClientId = process.env.NOTION_OAUTH_CLIENT_ID?.trim() ?? '';

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await cp(join(rootDir, 'public'), distDir, { recursive: true });

await execFileAsync('npx', ['tsc', '-p', 'tsconfig.build.json'], { cwd: rootDir });
await injectNotionOAuthClientId(join(distDir, 'notion', 'oauthClientConfig.js'));
await rename(join(distDir, 'background', 'index.js'), join(distDir, 'background.js'));
await rename(join(distDir, 'popup', 'index.js'), join(distDir, 'popup.js'));
await rename(join(distDir, 'options', 'index.js'), join(distDir, 'options.js'));
await rm(join(distDir, 'background'), { recursive: true, force: true });
await rm(join(distDir, 'popup'), { recursive: true, force: true });
await rm(join(distDir, 'options'), { recursive: true, force: true });

async function injectNotionOAuthClientId(configPath) {
  const source = await readFile(configPath, 'utf8');
  await writeFile(
    configPath,
    source.replace("const BUILD_TIME_NOTION_OAUTH_CLIENT_ID = '';", `const BUILD_TIME_NOTION_OAUTH_CLIENT_ID = ${JSON.stringify(notionOAuthClientId)};`)
  );
}
