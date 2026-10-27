import { readFile } from 'node:fs/promises';

if (!process.argv[2]) throw new Error('Pass the private JSON export of the saved OpenTofu plan');
const plan = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (!Array.isArray(plan.resource_changes)) throw new Error('Invalid plan: missing resource_changes');
if (plan.errored || plan.complete === false) throw new Error('Cannot deploy an errored or incomplete plan');
const destructive = plan.resource_changes.filter((resource) => resource.change.actions.includes('delete'));
for (const resource of plan.resource_changes) {
  if (resource.change.actions.join() !== 'no-op') console.log(`${resource.change.actions.join('/')} ${resource.address}`);
}
if (destructive.length) {
  console.error(`${destructive.length} destructive changes require the dev-destructive approval gate; apply only this saved plan after approval.`);
  process.exitCode = 2;
}
