import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectRelease } from './prepare-release.mjs';

const digest = 'a'.repeat(64);
const initial = {
  api_image: `mcr.microsoft.com/k8se/quickstart@sha256:${digest}`,
  migration_image: null, application_enabled: false,
};
const released = {
  api_image: `ghcr.io/lhrbst/bookit-api@sha256:${digest}`,
  migration_image: `ghcr.io/lhrbst/bookit-migrations@sha256:${digest}`,
  application_enabled: true,
};
const state = { values: { outputs: { release_inputs: { value: released } } } };

test('ordinary infrastructure changes retain every deployed release input', () => {
  assert.deepEqual(selectRelease(state, initial), released);
});
test('job preparation changes migrations without changing the existing API', () => {
  const migration = `ghcr.io/lhrbst/bookit-migrations@sha256:${'b'.repeat(64)}`;
  assert.deepEqual(selectRelease(state, initial, { MIGRATION_IMAGE: migration }), {
    ...released, migration_image: migration,
  });
});
test('fresh and known placeholder state can use initial release inputs', () => {
  assert.deepEqual(selectRelease({}, initial), initial);
  assert.deepEqual(selectRelease({ values: { root_module: { resources: [{
    address: 'azurerm_container_app.api', values: { template: [{ container: [{
      name: 'api', image: 'mcr.microsoft.com/k8se/quickstart:latest',
    }] }] },
  }] } } }, initial), initial);
});
test('a real image without persisted inputs never silently resets to the placeholder', () => {
  assert.throws(() => selectRelease({ values: { root_module: { resources: [{
    address: 'azurerm_container_app.api', values: { template: [{ container: [{
      name: 'api', image: released.api_image,
    }] }] },
  }] } } }, initial), /operator recovery/);
});
test('invalid overrides and incomplete application activation are refused', () => {
  for (const overrides of [
    { APPLICATION_ENABLED: 'yes' }, { API_IMAGE: 'ghcr.io/lhrbst/bookit-api:latest' },
    { MIGRATION_IMAGE: '' }, { APPLICATION_ENABLED: 'true' },
  ]) assert.throws(() => selectRelease({}, initial, overrides));
});
