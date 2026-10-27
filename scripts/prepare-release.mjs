import { spawnSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);

export function selectRelease(state, initial, environment = {}) {
  let release = state.values?.outputs?.release_inputs?.value;
  if (!release) {
    const app = state.values?.root_module?.resources?.find((resource) => resource.address === 'azurerm_container_app.api');
    const image = app?.values?.template?.[0]?.container?.find((container) => container.name === 'api')?.image;
    if (image && image !== initial.api_image &&
        image !== 'mcr.microsoft.com/k8se/quickstart:latest' &&
        image !== 'mcr.microsoft.com/k8se/quickstart') {
      throw new Error('Existing application has no persisted release inputs; operator recovery is required. Refusing placeholder fallback.');
    }
    release = initial;
  }
  const selected = {
    api_image: environment.API_IMAGE ?? release.api_image,
    migration_image: environment.MIGRATION_IMAGE ?? release.migration_image,
    application_enabled: release.application_enabled,
  };
  if (environment.APPLICATION_ENABLED !== undefined) {
    if (!['true', 'false'].includes(environment.APPLICATION_ENABLED)) {
      throw new Error('APPLICATION_ENABLED must be true or false');
    }
    selected.application_enabled = environment.APPLICATION_ENABLED === 'true';
  }
  if (typeof selected.api_image !== 'string' || !/@sha256:[0-9a-f]{64}$/.test(selected.api_image) ||
      typeof selected.application_enabled !== 'boolean' ||
      (selected.migration_image !== null && !/^ghcr\.io\/.+@sha256:[0-9a-f]{64}$/.test(selected.migration_image))) {
    throw new Error('Invalid persisted or requested immutable release inputs');
  }
  if (selected.application_enabled &&
      (!selected.api_image.startsWith('ghcr.io/') || selected.migration_image === null)) {
    throw new Error('An enabled application requires public GHCR API and migration digests');
  }
  return selected;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = spawnSync('tofu', ['-chdir=infra', 'show', '-json'], {
    cwd: fileURLToPath(root), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    console.error(result.stderr);
    throw new Error('Cannot read current release from OpenTofu state');
  }
  const initial = JSON.parse(await readFile(new URL('infra/environments/dev.release.tfvars.json', root), 'utf8'));
  const selected = selectRelease(JSON.parse(result.stdout), initial, process.env);
  await mkdir(new URL('.local/', root), { recursive: true, mode: 0o700 });
  await writeFile(new URL('.local/dev.release.tfvars.json', root), `${JSON.stringify(selected, null, 2)}\n`, { mode: 0o600 });
  console.log('Prepared .local/dev.release.tfvars.json from persisted state with explicit release overrides.');
}
