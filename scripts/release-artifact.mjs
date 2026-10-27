import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

export async function inventory(directory, current = directory) {
  const files = [];
  for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const path = resolve(current, entry.name);
    if (path === resolve(directory, 'manifest.json')) continue;
    if (entry.isDirectory()) files.push(...await inventory(directory, path));
    else {
      assert.ok(entry.isFile(), 'Release artifacts must not contain symlinks or special files');
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      files.push({ path: relative(directory, path).split('\\').join('/'), sha256: hash.digest('hex') });
    }
  }
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, directory] = process.argv.slice(2);
  assert.match(process.env.SOURCE_SHA, /^[0-9a-f]{40}$/);
  const files = await inventory(resolve(directory));
  assert.ok(files.length, 'Release artifact is empty');
  const manifest = { source_sha: process.env.SOURCE_SHA, files };
  if (command === 'create') {
    await writeFile(resolve(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  } else if (command === 'verify') {
    const expected = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest, expected, 'Artifact source or file hashes do not match');
  } else throw new Error('Expected create or verify');
}
