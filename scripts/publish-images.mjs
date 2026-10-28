import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const directory = await mkdtemp(join(tmpdir(), 'bookit-ghcr-'));
const env = { ...process.env, DOCKER_CONFIG: directory };
function docker(args, input) {
  const result = spawnSync('docker', args, { env, input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Docker ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}
try {
  assert.match(process.env.SOURCE_SHA, /^[0-9a-f]{40}$/);
  assert.match(process.env.VALIDATION_RUN_ID, /^\d+$/);
  docker(['load', '-i', '.local/backend-images/images.tar']);
  docker(['login', 'ghcr.io', '-u', process.env.GITHUB_ACTOR, '--password-stdin'], process.env.GH_TOKEN);
  const anonymous = join(directory, 'anonymous');
  await mkdir(anonymous);
  const published = [];
  for (const [target, repository] of [['api', process.env.GHCR_API_IMAGE], ['migrations', process.env.GHCR_MIGRATION_IMAGE]]) {
    assert.match(repository, /^ghcr\.io\/[a-z0-9._/-]+$/);
    const tag = `${repository}:sha-${process.env.SOURCE_SHA}-${process.env.VALIDATION_RUN_ID}`;
    docker(['tag', `bookit-${target}:validated`, tag]);
    docker(['push', tag]);
    const digests = JSON.parse(docker(['image', 'inspect', tag, '--format', '{{json .RepoDigests}}']));
    const image = digests.find((digest) => digest.startsWith(`${repository}@sha256:`));
    assert.ok(image && /@sha256:[0-9a-f]{64}$/.test(image), 'Published image digest missing');
    published.push([target, image]);
  }
  for (const [target, image] of published) {
    // An empty Docker config proves Container Apps can pull without a registry credential.
    docker(['--config', anonymous, 'pull', image]);
    await appendFile(process.env.GITHUB_OUTPUT, `${target === 'api' ? 'api_image' : 'migration_image'}=${image}\n`);
    console.log(`Published and anonymously verified ${image}`);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
