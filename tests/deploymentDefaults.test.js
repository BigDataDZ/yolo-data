import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('compose defaults to session auth on the loopback interface', () => {
  const compose = fs.readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');

  assert.match(compose, /AUTH_MODE:\s*\$\{AUTH_MODE:-session\}/);
  assert.match(compose, /HOST_BIND:-127\.0\.0\.1/);
  assert.doesNotMatch(compose, /AUTH_MODE:\s*dev/);
});
