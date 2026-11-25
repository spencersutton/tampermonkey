import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { rawLot } from './raw-lot.mjs';
import { createTestServer } from './vite.mjs';

const server = await createTestServer();
after(() => server.close());

const { extractAttrs } = await server.ssrLoadModule('/src/shared/attrs.ts');

describe('extractAttrs', () => {
  it('extracts CFM values without throwing', () => {
    assert.deepEqual(extractAttrs(rawLot({ title: '40V 450 CFM Cordless Leaf Blower' }))['CFM'], [
      '450 CFM',
    ]);
    assert.deepEqual(extractAttrs(rawLot({ title: 'Shop Fan 1,200 CFM High Velocity' }))['CFM'], [
      '1200 CFM',
    ]);
  });
});
