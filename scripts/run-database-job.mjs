import { fileURLToPath } from 'node:url';
import { azureClient } from './azure.mjs';

export async function executeJob(jobUrl, { request = azureClient(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), attempts = 180 } = {}) {
  const version = 'api-version=2025-01-01';
  let response = await request(`${jobUrl}/start?${version}`, { method: 'POST' });
  let execution;
  let location;
  for (let count = 0; count < attempts; count += 1) {
    if (response.status === 202) {
      location = response.headers.get('location') ?? location;
      if (!location || !location.startsWith('https://management.azure.com/')) throw new Error('Invalid job start polling location');
      await sleep(5000);
      response = await request(location);
      continue;
    }
    const body = await response.json();
    execution = body.name;
    if (!execution || !/^[\w.-]+$/.test(execution)) throw new Error('Job start did not identify an execution; start is never retried');
    break;
  }
  if (!execution) throw new Error('Job start operation timed out; inspect Azure before retrying');
  for (let count = 0; count < attempts; count += 1) {
    const result = await request(`${jobUrl}/executions/${execution}?${version}`, { allowNotFound: true });
    if (result.status !== 404) {
      const status = (await result.json()).properties?.status;
      if (status === 'Succeeded') {
        console.log(`Database execution ${execution}: Succeeded`);
        return;
      }
      if (!['Running', 'Processing', 'Pending', 'Queued'].includes(status)) {
        throw new Error(`Database execution ${execution}: ${status}; API rollout blocked`);
      }
    }
    await sleep(5000);
  }
  throw new Error(`Database execution ${execution} timed out; API rollout blocked`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const job = process.argv[2];
  if (!/^job-bookit-(release|provision)-dev$/.test(job)) throw new Error('Unexpected database job');
  const subscription = encodeURIComponent(process.env.AZURE_SUBSCRIPTION_ID);
  const group = encodeURIComponent(process.env.AZURE_RESOURCE_GROUP);
  await executeJob(`https://management.azure.com/subscriptions/${subscription}/resourceGroups/${group}/providers/Microsoft.App/jobs/${job}`);
}
