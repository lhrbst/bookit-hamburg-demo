import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';

const api = new URL(process.env.API_BASE_URL);
const web = new URL(process.env.WEB_URL);
assert.equal(api.protocol, 'https:');
assert.equal(web.protocol, 'https:');
async function get(path) {
  const response = await fetch(new URL(path, api), { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, `GET ${path} failed`);
  return response.json();
}
for (let attempt = 0; ; attempt += 1) {
  try { await get('/ready'); break; } catch (error) {
    if (attempt === 11) throw error;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
await get('/health');
const resources = await get('/api/resources');
const me = await get('/api/me');
assert.ok(resources.length, 'Demo resource seed missing');
const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' })
  .format(new Date(Date.now() + (180 + randomInt(180)) * 86400000));
const body = {
  resourceId: resources[0].id, bookedForId: me.id, purposeId: 'Meeting',
  start: `${day}T12:00`, end: `${day}T12:05`,
};
const post = () => fetch(new URL('/api/bookings', api), {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
});
let booking;
try {
  const created = await post();
  assert.equal(created.status, 201, 'Synthetic smoke booking failed');
  booking = (await created.json()).booking;
  assert.equal((await post()).status, 409, 'Overlapping booking was not refused');
} finally {
  if (booking) {
    const deleted = await fetch(new URL(`/api/bookings/${booking.id}`, api), {
      method: 'DELETE', signal: AbortSignal.timeout(30_000),
    });
    assert.equal(deleted.status, 204, `Smoke fixture cleanup failed: ${booking.id}`);
  }
}
const configResponse = await fetch(new URL('/config.json', web), { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
assert.equal(configResponse.status, 200);
assert.equal((await configResponse.json()).apiBaseUrl, api.origin);
assert.match(configResponse.headers.get('cache-control') ?? '', /no-store/i);
const page = await fetch(new URL('/resources', web), { signal: AbortSignal.timeout(30_000) });
assert.equal(page.status, 200);
assert.match(await page.text(), /id="root"/);
console.log('Dev readiness, catalog, current person, create/clash/cancel, runtime config and deep link verified.');
