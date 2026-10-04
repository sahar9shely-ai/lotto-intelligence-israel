/* Worker notice copy, ownership and navigation checks; no network or browser. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

async function main() {
  const endpoint = 'https://push.example.test/own-device';
  let binding = { user_id: 1, endpoint };
  let currentEndpoint = endpoint;
  const handlers = {};
  const notices = [];
  const navigations = [];
  const indexedDB = { open() {
    const request = { result: { close() {}, transaction() {
      const transaction = { objectStore() { return { get() {
        const read = {};
        queueMicrotask(() => { read.result = binding; read.onsuccess?.(); transaction.oncomplete?.(); });
        return read;
      } }; } };
      return transaction;
    } } };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  } };
  const self = {
    location: { origin: 'https://tazrim.test' },
    registration: {
      pushManager: { getSubscription: async () => currentEndpoint ? { endpoint: currentEndpoint } : null },
      showNotification: async (title, options) => notices.push({ title, options }),
    },
    clients: { matchAll: async () => [], openWindow: async url => navigations.push(url), claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener(name, handler) { handlers[name] = handler; },
  };
  const context = vm.createContext({ self, indexedDB, URL, Promise, Number });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../public/push-sw.js'), 'utf8'), context);
  assert.equal(handlers.fetch, undefined, 'Push worker must never cache private application pages');
  const emit = async (name, event) => {
    let completion;
    handlers[name]({ ...event, waitUntil(promise) { completion = promise; } });
    await completion;
  };
  const push = async (kind, href, owner = 1) => {
    await emit('push', { data: { json: () => ({
      kind, title: 'PRIVATE NAME', body: 'PRIVATE AMOUNT', tag: 'tazrim-push-123',
      data: { owner_user_id: owner, href },
    }) } });
    return notices.at(-1).options;
  };
  const click = options => emit('notificationclick', { notification: { data: options.data, close() {} } });
  const admin = await push('admin_login', '/activity?token=secret#name');
  assert.equal(admin.body, 'משקיע התחבר לתזרים. אפשר לפתוח את המעקב לפרטים.');
  assert.equal(admin.data.url, 'https://tazrim.test/activity');
  await click(admin);
  assert.equal(navigations.at(-1), 'https://tazrim.test/activity');
  const reminder = await push('agreement_reminder', '/agreements/42/sign?token=secret');
  assert.equal(reminder.body, 'ממתין לך הסכם לחתימה. אפשר לפתוח את תזרים ולחתום.');
  assert.equal(reminder.data.url, 'https://tazrim.test/agreements/42/sign');
  const topupReminder = await push('topup_reminder', '/investors?section=documents&topup_request_id=7');
  assert.equal(topupReminder.body, reminder.body);
  assert.equal(new URL(topupReminder.data.url).searchParams.get('section'), 'documents');
  const test = await push('test', '/account');
  assert.equal(test.body, 'זו התראת בדיקה מתזרים.');
  assert.equal(test.data.url, 'https://tazrim.test/account');
  for (const kind of ['payment', 'agreement', 'topup', 'UNKNOWN PRIVATE COPY']) {
    const options = await push(kind, '/payments?payment_id=7&amount=999');
    assert(!options.body.includes('PRIVATE'), 'Only reviewed notification copy can appear on lock screen');
    assert.equal(new URL(options.data.url).searchParams.has('amount'), false);
  }
  const mismatched = await push('admin_login', '/activity', 2);
  assert.equal(mismatched.body, 'פתחו את תזרים כדי לבדוק אם ממתינה בקשת אישור.');
  assert.equal(Object.keys(mismatched.data).length, 0);
  const before = navigations.length;
  await click(mismatched);
  binding = null;
  await click(admin);
  binding = { user_id: 1, endpoint };
  currentEndpoint = 'https://push.example.test/replaced';
  await click(reminder);
  assert.equal(navigations.length, before, 'Account/logout/endpoint changes must disable private navigation');
  const stale = await push('agreement_reminder', '/agreements/42/sign');
  assert.equal(Object.keys(stale.data).length, 0);
  console.log('PASS: reviewed login/reminder/test copy, private lock-screen data rejection, allowed destinations, token stripping, and stale-account navigation protection.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
