import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from './router.js';

const h = () => {};
const match = createRouter({
  'GET /a': h,
  'GET /a/:id/b': h,
  'DELETE /a/:id': h,
  'GET /gw/*': h,
});

describe('createRouter', () => {
  it('matches method and path exactly', () => {
    assert.ok(match('GET', '/a'));
    assert.equal(match('POST', '/a'), null);
    assert.equal(match('GET', '/a/1'), null);
    assert.equal(match('GET', '/a/1/b/c'), null);
    assert.equal(match('GET', '/nope'), null);
  });

  it('captures parameters and the rest of a wildcard', () => {
    assert.deepEqual(match('GET', '/a/42/b')?.params, { id: '42' });
    assert.deepEqual(match('DELETE', '/a/42')?.params, { id: '42' });
    assert.deepEqual(match('GET', '/gw/x/y')?.params, { rest: 'x/y' });
    assert.equal(match('GET', '/gw'), null);
  });
});
