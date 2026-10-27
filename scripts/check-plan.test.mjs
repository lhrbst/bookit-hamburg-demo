import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

function check(plan) {
  const directory = mkdtempSync(join(tmpdir(), 'bookit-plan-test-'));
  try {
    const path = join(directory, 'plan.json');
    writeFileSync(path, JSON.stringify(plan), { mode: 0o600 });
    return spawnSync(process.execPath, [fileURLToPath(new URL('./check-plan.mjs', import.meta.url)), path],
      { encoding: 'utf8' });
  } finally {
    rmSync(directory, { recursive: true });
  }
}

test('create/update/no-op plans pass without exposing values', () => {
  const result = check({ resource_changes: ['create', 'update', 'no-op'].map((action) => ({
    address: `example.${action}`, change: { actions: [action], after: { secret: 'must-not-log' } },
  })) });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /create example.create/);
  assert.doesNotMatch(result.stdout + result.stderr, /must-not-log|no-op/);
});

for (const actions of [['delete'], ['delete', 'create'], ['create', 'delete']]) {
  test(`${actions.join('/')} requires explicit destructive approval`, () => {
    const result = check({ resource_changes: [{ address: 'example.resource', change: { actions } }] });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /dev-destructive/);
  });
}

for (const plan of [{}, { resource_changes: [], errored: true }, { resource_changes: [], complete: false }]) {
  test(`invalid or incomplete plan fails closed: ${JSON.stringify(plan)}`, () => {
    assert.equal(check(plan).status, 1);
  });
}
