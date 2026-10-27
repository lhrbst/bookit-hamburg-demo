import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const checksums = {
  darwin_arm64: 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
  linux_amd64: '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8',
};
const platform = `${process.platform}_${process.arch === 'x64' ? 'amd64' : process.arch}`;
if (!checksums[platform]) throw new Error(`Unsupported actionlint platform: ${platform}`);
const directory = resolve('.local/tools');
const binary = resolve(directory, 'actionlint');
await mkdir(directory, { recursive: true });
const archive = resolve(directory, 'actionlint.tar.gz');
const response = await fetch(`https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_${platform}.tar.gz`);
if (!response.ok) throw new Error(`actionlint download failed: HTTP ${response.status}`);
await writeFile(archive, Buffer.from(await response.arrayBuffer()));
if (createHash('sha256').update(await readFile(archive)).digest('hex') !== checksums[platform]) {
  throw new Error('actionlint checksum mismatch');
}
const extracted = spawnSync('tar', ['-xzf', archive, '-C', directory, 'actionlint'], { stdio: 'inherit' });
if (extracted.status !== 0) throw new Error('actionlint extraction failed');
const result = spawnSync(binary, ['-color'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
