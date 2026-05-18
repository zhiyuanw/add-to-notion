import { describe, expect, it } from 'vitest';

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
});
