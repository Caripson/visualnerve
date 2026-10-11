import { createServer } from '../frontend/node_modules/vite/dist/node/index.js';
import { chromium } from '../frontend/node_modules/playwright-core/index.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const output = `${root}/tmp/collaboration-workflow-review`;
const origin = 'http://127.0.0.1:5184';
const relay = 'http://127.0.0.1:4360';
await mkdir(output, { recursive: true });
await writeFile(`${output}/empty.env`, '# Disposable local capture. No deployment credentials.\n');
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
for (const key of Object.keys(env)) if (/^(CLOUDFLARE_|CF_API_|WRANGLER_API_)/.test(key)) delete env[key];
const worker = spawn(process.execPath, [
  'node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--env-file', `${output}/empty.env`,
  '--port', '4360', '--ip', '127.0.0.1', '--var', 'ENABLED:true', '--var', `ALLOWED_ORIGINS:${origin}`,
], { cwd: `${root}/collaboration-worker`, env, stdio: ['ignore', 'pipe', 'pipe'] });
const workerLog = [];
for (const stream of [worker.stdout, worker.stderr]) stream.on('data', chunk => workerLog.push(chunk.toString()));
const vite = await createServer({
  root: `${root}/frontend`, configFile: `${root}/frontend/vite.config.ts`, envFile: false,
  cacheDir: `${output}/vite-cache`,
  plugins: [{ name: 'local-collaboration-review', transformIndexHtml(html) {
    return html.replace('</head>', `<meta name="visualnerve-vault-required" content="true"><meta name="visual-nerve-collaboration-relay" content="${relay}"></head>`);
  } }],
  optimizeDeps: { noDiscovery: true, include: ['react','react/jsx-runtime','react-dom/client','zustand','lucide-react','yjs','papaparse','dexie','@xyflow/react','elkjs/lib/elk-api.js','zustand/middleware','zustand/react/shallow'] },
  server: { host: '127.0.0.1', port: 5184, strictPort: true, hmr: false },
});
let browser;
const errors = [];
const captures = [];
const deadline = setTimeout(() => { console.error('Capture deadline exceeded'); worker.kill('SIGTERM'); process.exit(1); }, 420000);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function shot(page, name, dialog = true) {
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
  const path = `${output}/${name}.png`;
  if (dialog) await page.getByRole('dialog', {name:'Live collaboration', exact:true}).screenshot({path});
  else await page.screenshot({path});
  captures.push(name);
  console.log(`Captured ${name}`);
}
async function pairedShot(page, name, dialog = true) {
  await shot(page, name, dialog);
  await page.evaluate(() => {document.documentElement.dataset.theme='dark';});
  await shot(page, `${name}-dark`, dialog);
  await page.evaluate(() => {document.documentElement.dataset.theme='light';});
}
async function assertControlsClear(page) {
  const presence = await page.locator('.collaboration-presence').boundingBox();
  assert.ok(presence, 'Live participant dock is visible');
  for (const box of await page.locator('.react-flow__controls button').evaluateAll(elements => elements.map(element => {
    const rect=element.getBoundingClientRect(); return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};
  }))) assert.ok(presence.x+presence.width <= box.x || box.x+box.width <= presence.x || presence.y+presence.height <= box.y || box.y+box.height <= presence.y, 'Live dock does not cover a canvas control');
}
async function detail(locator, name) {
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({path:`${output}/${name}.png`});
  captures.push(name);
  console.log(`Captured ${name}`);
}
async function setup(page, url = origin) {
  await page.goto(url);
  await page.getByRole('dialog', {name:'Protect your local workspace', exact:true}).waitFor();
  const password = 'Local screenshot review ephemeral workspace password';
  await page.getByLabel('New workspace password', {exact:true}).fill(password);
  await page.getByLabel('Confirm new password', {exact:true}).fill(password);
  await page.getByRole('button', {name:'Create encrypted workspace', exact:true}).click();
  await page.getByLabel('I have saved my recovery key in a protected location.', {exact:true}).check();
  await page.getByRole('button', {name:'Continue', exact:true}).click();
  await page.getByLabel('I accept local storage and offline caching', {exact:true}).check();
  await page.getByRole('button', {name:'Accept and continue', exact:true}).click();
}
async function snapshot(page) {
  return page.evaluate(async () => (await import('/src/collaboration/runtime.ts')).collaborationRuntime.inspect());
}
async function status(page, value) {
  await page.waitForFunction(async value => (await import('/src/collaboration/runtime.ts')).collaborationRuntime.inspect()?.status === value, value);
}
async function panel(page) {
  const dialog = page.getByRole('dialog',{name:'Live collaboration',exact:true});
  if (!await dialog.isVisible()) {
    const live = page.locator('.collaboration-presence');
    if (await live.isVisible()) await live.click();
    else await page.getByRole('button',{name:'Open collaboration and participants',exact:true}).click();
  }
  await dialog.waitFor();
  return dialog;
}
try {
  for (let i = 0; i < 120; i++) {
    try { if ((await (await fetch(`${relay}/health`)).json()).enabled) break; } catch {}
    if (i === 119) throw new Error('Local relay did not start');
    await sleep(250);
  }
  await vite.listen();
  browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {}),args:['--no-sandbox']});
  const contexts = await Promise.all([0,1].map(() => browser.newContext({viewport:{width:1440,height:1120},colorScheme:'light'})));
  for(const context of contexts) await context.grantPermissions(['local-network-access','clipboard-read','clipboard-write'],{origin});
  const owner = await contexts[0].newPage(), guest = await contexts[1].newPage();
  for(const page of [owner,guest]) {
    page.setDefaultTimeout(45000);
    page.on('pageerror', error => {errors.push(error.message);console.error(`Page error: ${error.message}`);});
    page.on('console', async message => { if(message.type() === 'error') { console.error('Browser console:', message.text()); for(const arg of message.args()) { const details=await arg.evaluate(value=>value instanceof Error ? value.stack : undefined).catch(()=>undefined); if(details) console.error(details); } } });
  }
  await setup(owner);
  await owner.getByRole('button',{name:'Create a diagram',exact:true}).click();
  await owner.getByLabel('New diagram name').fill('Delivery review');
  await owner.getByRole('button',{name:/Flowchart/}).click();
  await owner.getByRole('button',{name:'Create diagram',exact:true}).click();
  await owner.getByRole('heading',{name:'Delivery review',exact:true,level:1}).waitFor();
  await shot(owner,'00-editor-entry',false);
  await panel(owner);
  await owner.getByLabel('Your display name',{exact:true}).fill('Alex');
  await shot(owner,'01-create-room');
  await owner.evaluate(() => {document.documentElement.dataset.theme='dark';});
  await shot(owner,'01-create-room-dark');
  await owner.evaluate(() => {document.documentElement.dataset.theme='light';});
  await owner.getByLabel('I have reviewed the diagram and am allowed to share this information.',{exact:true}).check();
  await owner.getByRole('button',{name:'Start private room',exact:true}).click();
  await status(owner,'live');
  await owner.getByRole('button',{name:'Create one-use invitation',exact:true}).click();
  const invitation = await owner.getByRole('textbox',{name:'Private invitation link',exact:true}).inputValue();
  await shot(owner,'02-private-invitation');
  await detail(owner.locator('section[aria-label="Private invitation link"]'),'02-invitation-controls');
  await setup(guest,invitation);
  await guest.getByRole('dialog',{name:'Live collaboration',exact:true}).waitFor();
  await guest.getByLabel('Your display name',{exact:true}).fill('Jamie');
  await shot(guest,'03-request-to-join');
  await guest.getByRole('button',{name:'Request to join',exact:true}).click();
  await status(guest,'awaiting-approval');
  await shot(guest,'04-waiting-approval');
  await owner.getByRole('button',{name:'Approve device',exact:true}).waitFor();
  await owner.getByRole('heading',{name:'Waiting for your approval',exact:true}).scrollIntoViewIfNeeded();
  await owner.locator('.collaboration-request select').first().selectOption('editor');
  await owner.getByRole('textbox',{name:'New profile name',exact:true}).fill('Jamie');
  await shot(owner,'05-owner-approval');
  await detail(owner.locator('.collaboration-request'),'05-approval-controls');
  const pending = await snapshot(guest), request = (await snapshot(owner)).pendingJoins[0];
  assert.equal(pending.selfCredentialId,request.credentialId);
  await owner.getByRole('button',{name:'Approve device',exact:true}).click();
  await status(guest,'live');
  await owner.getByText('Jamie',{exact:true}).waitFor();
  await owner.getByRole('heading',{name:'People in this room',exact:true}).scrollIntoViewIfNeeded();
  await shot(owner,'06-participants-and-roles');
  await owner.getByRole('button',{name:'Close dialog',exact:true}).click();
  await guest.getByRole('button',{name:'Close dialog',exact:true}).click();
  await guest.getByRole('heading',{name:'Delivery review',exact:true,level:1}).waitFor();
  await owner.locator('.canvas-shell .node-title').filter({hasText:'Evaluate'}).click();
  await owner.getByLabel('Node title',{exact:true}).fill('Review delivery');
  await guest.locator('.canvas-shell .node-title').filter({hasText:'Review delivery'}).waitFor();
  await panel(owner);
  await owner.getByRole('button',{name:'Document work',exact:true}).click();
  await owner.getByRole('tab',{name:'Comments',exact:true}).click();
  await owner.getByLabel('Comment text',{exact:true}).fill('Validate package demand with the store team.');
  await owner.getByRole('button',{name:'Add comment',exact:true}).click();
  await owner.getByText('Validate package demand with the store team.',{exact:true}).waitFor();
  await panel(guest);
  await guest.getByRole('button',{name:'Document work',exact:true}).click();
  await guest.getByRole('tab',{name:'Comments',exact:true}).click();
  await guest.getByText('Validate package demand with the store team.',{exact:true}).waitFor();
  await guest.getByLabel('Reply',{exact:true}).fill('Confirmed with operations.');
  await guest.getByRole('button',{name:'Reply',exact:true}).click();
  await owner.getByText('Confirmed with operations.',{exact:true}).waitFor();
  await pairedShot(owner,'13-shared-comments');
  await owner.getByRole('button',{name:'Resolve thread',exact:true}).click();
  await guest.getByText('Resolved',{exact:true}).waitFor();
  await owner.getByRole('tab',{name:'Tasks',exact:true}).click();
  await owner.getByRole('button',{name:'Create task',exact:true}).click();
  await owner.getByLabel('Task title',{exact:true}).fill('Measure queue capacity');
  await owner.getByLabel('Assigned profile',{exact:true}).selectOption({label:'Jamie'});
  await owner.getByRole('dialog',{name:'Live collaboration',exact:true}).getByLabel('Due date',{exact:true}).fill('2026-11-01');
  await owner.getByRole('button',{name:'Save',exact:true}).click();
  await owner.getByText('Measure queue capacity',{exact:true}).waitFor();
  await guest.getByRole('tab',{name:'Tasks',exact:true}).click();
  await guest.getByText('Measure queue capacity',{exact:true}).waitFor();
  await guest.getByRole('button',{name:'Edit',exact:true}).click();
  await guest.getByRole('dialog',{name:'Live collaboration',exact:true}).getByLabel('Status',{exact:true}).selectOption('done');
  await guest.getByRole('button',{name:'Save',exact:true}).click();
  await owner.getByRole('dialog',{name:'Live collaboration',exact:true}).getByText('Done',{exact:true}).filter({visible:true}).waitFor();
  await pairedShot(owner,'14-shared-tasks');
  await owner.getByRole('tab',{name:'Activity',exact:true}).click();
  await pairedShot(owner,'15-shared-activity');
  await owner.getByRole('tab',{name:'Profiles',exact:true}).click();
  await pairedShot(owner,'16-profiles');
  await owner.getByRole('button',{name:'Close dialog',exact:true}).click();
  await guest.getByRole('button',{name:'Close dialog',exact:true}).click();
  await owner.setViewportSize({width:1440,height:980});
  await assertControlsClear(owner);
  await pairedShot(owner,'07-live-diagram',false);
  await guest.setViewportSize({width:390,height:844});
  await assertControlsClear(guest);
  await pairedShot(guest,'08-live-mobile',false);
  await panel(guest);
  await guest.getByRole('button',{name:'Document work',exact:true}).click();
  await guest.getByRole('tab',{name:'Tasks',exact:true}).click();
  await pairedShot(guest,'17-mobile-tasks');
  await guest.getByRole('tab',{name:'Comments',exact:true}).click();
  await pairedShot(guest,'18-mobile-comments');
  await guest.getByRole('button',{name:'Live room',exact:true}).click();
  await shot(guest,'09-mobile-panel');
  await guest.getByRole('heading',{name:'People in this room',exact:true}).scrollIntoViewIfNeeded();
  await shot(guest,'10-mobile-participants');
  await guest.evaluate(() => {document.documentElement.dataset.theme='dark';});
  await shot(guest,'11-mobile-dark');
  await panel(owner);
  await owner.getByRole('button',{name:'Close room for everyone',exact:true}).click();
  await owner.getByRole('alertdialog').scrollIntoViewIfNeeded();
  await shot(owner,'12-close-room');
  await owner.getByRole('button',{name:'Confirm change',exact:true}).click();
  await status(owner,'idle');
  assert.equal((await snapshot(owner)).participants.length,0);
  assert.deepEqual(errors,[]);
  await writeFile(`${output}/captures.json`,JSON.stringify({application:'Actual Visual Nerve App',localOnly:true,uiEditSynced:true,commentsSynced:true,replySynced:true,taskAssignmentSynced:true,taskStatusSynced:true,roomClosed:true,errors,captures},null,2));
  console.log(JSON.stringify({captured:captures.length,roomClosed:true,output},null,2));
} catch (error) {
  console.error(error);
  if(browser) for(const [i,context] of browser.contexts().entries()) for(const page of context.pages()) {
    await page.screenshot({path:`${output}/failure-${i}.png`}).catch(()=>{});
    console.error((await page.locator('body').innerText().catch(()=>'' )).slice(0,6000));
  }
  process.exitCode=1;
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await vite.close();
  worker.kill('SIGTERM');
}
