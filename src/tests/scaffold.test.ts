import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import manifest from '../../public/manifest.json';
import { extensionAreas } from '../shared/domain/extensionAreas';

describe('extension scaffold', () => {
  it('defines the expected source areas', () => {
    expect(extensionAreas).toEqual([
      'popup',
      'options',
      'background',
      'shared',
      'confluence',
      'notion',
      'converter',
      'assets'
    ]);
  });

  it('keeps packaged entry scripts at their emitted import depth', () => {
    expect(manifest.background.service_worker).toBe('background/index.js');

    const publicRoot = join(process.cwd(), 'public');
    const popupHtml = readFileSync(join(publicRoot, 'popup.html'), 'utf8');
    const optionsHtml = readFileSync(join(publicRoot, 'options.html'), 'utf8');

    expect(popupHtml).toContain('src="popup/index.js"');
    expect(optionsHtml).toContain('src="options/index.js"');
    expect(existsSync(join(process.cwd(), 'scripts', 'build-extension.mjs'))).toBe(true);
  });
});
