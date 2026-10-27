import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateRuntimeConfig } from '../runtime-config.mjs';

if (!process.env.API_BASE_URL || !process.argv[2]) {
  throw new Error('Set API_BASE_URL and pass an output directory for the runtime configuration overlay.');
}
const config = validateRuntimeConfig({ apiBaseUrl: process.env.API_BASE_URL });
const directory = resolve(process.argv[2]);
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, { flag: 'w' });
console.log('Public runtime configuration generated; frontend JavaScript unchanged.');
