/* Execute the actual push hook through synthetic React lifecycle interleavings.
 * No browser permission, network request, account, or notification is touched. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const jsx = require('react/jsx-runtime');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = async () => { for (let n = 0; n < 40; n++) await Promise.resolve(); };
const investor = id => ({ id, is_manager: false });

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    dispatch(name) { for (const fn of [...(listeners.get(name) || [])]) fn(); },
  };
}

function fixture({ user = investor(2), owner = user && !user.is_manager ? { user_id: user.id, endpoint: 'https://push.example.test/device' } : null, permission = 'granted', subscribed = true, config = { enabled: true, public_key: 'AQIDBA', require_notifications: true } } = {}) {
  let currentUser = user;
  const runtime = { owner, binding: owner, writes: [], states: [], subscriptions: 0, unsubscribes: 0, serverDeletes: [], registrations: 0, permissionPrompts: 0, requestedPermission: 'granted', subscribePosts: 0, statusCalls: 0, configCalls: 0, statusInFlight: 0, maxStatusInFlight: 0, statusImpl: null, configImpl: null, postImpl: null, testCalls: [], deliveryChecks: [], testImpl: null, deliveryImpl: null, support: 'supported' };
  const notification = { permission, async requestPermission() { runtime.permissionPrompts++; notification.permission = runtime.requestedPermission; return notification.permission; } };
  const makeSubscription = endpoint => ({ endpoint, options: { applicationServerKey: new ArrayBuffer(4) }, toJSON: () => ({ keys: { p256dh: 'synthetic-key', auth: 'synthetic-auth' } }), async unsubscribe() { runtime.unsubscribes++; if (runtime.subscription?.endpoint === endpoint) runtime.subscription = null; return true; } });
  runtime.subscription = makeSubscription(owner?.endpoint || 'https://push.example.test/device');
  const registration = { pushManager: {
    async getSubscription() { return runtime.subscription; },
    async subscribe() { runtime.subscriptions++; runtime.subscription = makeSubscription('https://push.example.test/replacement'); return runtime.subscription; },
  } };
  const api = {
    async pushConfig() { runtime.configCalls++; return runtime.configImpl ? runtime.configImpl() : config; },
    async pushSubscriptionStatus(endpoint) {
      runtime.statusCalls++; runtime.statusInFlight++; runtime.maxStatusInFlight = Math.max(runtime.maxStatusInFlight, runtime.statusInFlight);
      try { return runtime.statusImpl ? await runtime.statusImpl(endpoint) : { subscribed }; }
      finally { runtime.statusInFlight--; }
    },
    async pushSubscribe(body) { runtime.subscribePosts++; return runtime.postImpl ? runtime.postImpl(body) : {}; },
    async pushUnsubscribe(body, token) { assert.equal(token, 'synthetic-current-token'); runtime.serverDeletes.push(body.endpoint); },
    async pushTest(body, signal) { runtime.testCalls.push(body); return runtime.testImpl ? runtime.testImpl(body, signal) : { queued: true, delivery_id: 42 }; },
    async pushDeliveryStatus(body, signal) { runtime.deliveryChecks.push(body); return runtime.deliveryImpl ? runtime.deliveryImpl(body, signal) : { subscribed: true, pending: 0, last_delivery: { status: 'sent', error: null, sent_at: 'synthetic-time' } }; },
  };
  const service = {
    PUSH_DETACHING_EVENT: 'detaching',
    async getBrowserPushOwner() { return runtime.owner; },
    async clearBrowserPushOwner(endpoint) { if (!endpoint || runtime.owner?.endpoint === endpoint) runtime.owner = null; },
    async setBrowserPushBinding(value) { runtime.binding = value; runtime.writes.push(value); if (value) runtime.owner = value; },
    pushSupport() { return runtime.support; },
    async getPushRegistration() { return registration; },
    async registerPushWorker() { runtime.registrations++; return registration; },
    decodePushPublicKey() { return new ArrayBuffer(4); },
  };
  let clock = 0, timerId = 0;
  const timers = new Map();
  const window = { ...eventTarget(), setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: clock + delay }); return id; }, clearTimeout(id) { timers.delete(id); } };
  const document = { ...eventTarget(), visibilityState: 'visible' };
  const permissionStatus = eventTarget();
  const navigator = { permissions: { query: async () => permissionStatus } };
  let renderer = null;
  const fakeReact = {
    createContext: () => ({ Provider: 'provider' }),
    useState(initial) { return renderer.useState(initial); },
    useRef(initial) { return renderer.useRef(initial); },
    useCallback(fn, deps) { return renderer.useCallback(fn, deps); },
    useEffect(fn, deps) { renderer.useEffect(fn, deps); },
  };
  const module = { exports: {} };
  const pushTypes = { exports: {} };
  const pushTypesCode = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/types/push.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(pushTypesCode, { module: pushTypes, exports: pushTypes.exports });
  const source = fs.readFileSync(path.resolve(__dirname, '../src/context/PushNotificationsContext.tsx'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  const imports = { react: fakeReact, 'react/jsx-runtime': jsx, './AuthContext': { useAuth: () => ({ user: currentUser }) }, '../services/api': { api, getToken: () => 'synthetic-current-token' }, '../services/pushNotifications': service, '../types/push': pushTypes.exports };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => imports[name] || require(name), window, document, navigator, Notification: notification, Promise, Error, ArrayBuffer, AbortController });

  const sameDeps = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  function mount(nextUser = currentUser) {
    currentUser = nextUser;
    const element = module.exports.PushNotificationsProvider({ children: null });
    const hooks = [], effects = [];
    let cursor = 0, mounted = true, scheduled = false, pendingEffects = [], value;
    const instance = {
      useState(initial) {
        const index = cursor++;
        if (!hooks[index]) hooks[index] = { state: typeof initial === 'function' ? initial() : initial };
        return [hooks[index].state, next => {
          if (!mounted) return;
          const resolved = typeof next === 'function' ? next(hooks[index].state) : next;
          if (Object.is(hooks[index].state, resolved)) return;
          hooks[index].state = resolved;
          if (!scheduled) { scheduled = true; queueMicrotask(() => { scheduled = false; if (mounted) render(); }); }
        }];
      },
      useRef(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { current: initial }; return hooks[index]; },
      useCallback(fn, deps) { const index = cursor++; if (!hooks[index] || !sameDeps(hooks[index].deps, deps)) hooks[index] = { fn, deps }; return hooks[index].fn; },
      useEffect(fn, deps) { const index = cursor++; if (!hooks[index] || !sameDeps(hooks[index].deps, deps)) { hooks[index] = { fn, deps }; pendingEffects.push(index); } },
      get value() { return value; },
      strictReplay() { for (const effect of effects) if (effect) { effect.cleanup?.(); effect.cleanup = effect.fn(); } },
      unmount() { mounted = false; for (const effect of effects) effect?.cleanup?.(); },
    };
    function render() {
      renderer = instance;
      cursor = 0;
      value = element.type(element.props).props.value;
      runtime.states.push(value.state);
      const commit = pendingEffects; pendingEffects = [];
      for (const index of commit) { effects[index]?.cleanup?.(); effects[index] = { fn: hooks[index].fn, cleanup: hooks[index].fn() }; }
    }
    render();
    return instance;
  }
  return { runtime, notification, window, document, permissionStatus, mount, advance(ms) { clock += ms; for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.fn(); } } };
}

async function main() {
  const f = fixture();
  const session = f.mount();
  await tick();
  assert.equal(session.value.state, 'ready');
  assert.equal(f.runtime.subscribePosts, 1, 'A restored, ownership-verified device repairs pending deliveries once');
  const status = deferred(); f.runtime.statusImpl = () => status.promise;
  const start = f.runtime.states.length;
  f.window.dispatch('focus'); f.document.dispatch('visibilitychange');
  const manual = session.value.refresh();
  await tick();
  assert.equal(session.value.state, 'ready', 'Focus must not unmount the verified portfolio while checking');
  assert.equal(f.runtime.maxStatusInFlight, 1, 'Focus, visibility, and manual checks share one operation');
  assert(f.runtime.states.slice(start).every(state => state === 'ready'), 'No activation/loading frame during background verification');
  status.resolve({ subscribed: true }); await manual; await tick();
  assert.equal(f.runtime.subscribePosts, 1, 'Returning to the app must not enqueue another catch-up notification');

  f.runtime.statusImpl = async () => { throw Error('synthetic network outage'); };
  await session.value.refresh(); await tick();
  assert.equal(session.value.state, 'ready');
  assert.equal(f.runtime.binding.user_id, 2, 'Temporary network failure must retain the verified delivery marker');
  assert(session.value.error, 'Connection status remains visible in notification settings');

  const hanging = deferred(); f.runtime.statusImpl = () => hanging.promise;
  const timedCheck = session.value.refresh(); await tick(); f.advance(15001); await timedCheck; await tick();
  assert.equal(session.value.state, 'ready', 'A timed-out recheck does not revoke a verified device');
  f.runtime.statusImpl = async () => ({ subscribed: true });
  await session.value.refresh(); await tick();
  hanging.resolve({ subscribed: false }); await tick();
  assert.equal(session.value.state, 'ready', 'Completion of a timed-out operation cannot replace the newer verification');

  const delayed = deferred(); f.runtime.statusImpl = () => delayed.promise;
  void session.value.refresh(); await tick();
  f.notification.permission = 'denied'; f.permissionStatus.dispatch('change'); await tick();
  assert.notEqual(session.value.state, 'ready', 'Permission revocation blocks while an old server request is pending');
  assert.equal(f.runtime.binding, null);
  delayed.resolve({ subscribed: true }); await tick();
  assert.equal(session.value.state, 'denied', 'Late status success cannot restore revoked permission');
  session.unmount();

  const strict = fixture();
  const strictSession = strict.mount(); strictSession.strictReplay(); await tick();
  assert.equal(strictSession.value.state, 'ready');
  assert.equal(strict.runtime.writes.some(binding => binding === null), false, 'StrictMode cleanup/remount must preserve same-account dormant delivery');
  strictSession.unmount();
  assert.equal(strict.runtime.binding.user_id, 2, 'Closing a page is not a logout');
  const newSession = strict.mount(investor(3)); await tick();
  assert.equal(newSession.value.state, 'needs_permission');
  assert.equal(strict.runtime.binding, null, 'A different account must lose the previous delivery marker');
  assert.equal(strict.runtime.unsubscribes, 1, 'A different account retires the previous endpoint instead of reassigning it');
  assert.equal(strict.runtime.serverDeletes.length, 0, 'A new account must not delete a previous account server record');
  assert.equal(strict.runtime.subscribePosts, 1, 'The new account must not automatically claim a previous account endpoint');
  newSession.unmount();

  const oldRequest = fixture(); const pendingConfig = deferred(); oldRequest.runtime.configImpl = () => pendingConfig.promise;
  const previous = oldRequest.mount(); await tick(); previous.unmount();
  oldRequest.runtime.owner = { user_id: 3, endpoint: 'https://push.example.test/new-owner' };
  oldRequest.runtime.binding = oldRequest.runtime.owner;
  oldRequest.runtime.subscription.endpoint = oldRequest.runtime.owner.endpoint;
  oldRequest.runtime.configImpl = null;
  const replacement = oldRequest.mount(investor(3)); await tick();
  pendingConfig.resolve({ enabled: false, public_key: null, require_notifications: true }); await tick();
  assert.equal(oldRequest.runtime.binding.user_id, 3, 'Late old-account checks/cleanup must not erase the new-account binding');
  assert.equal(replacement.value.state, 'ready'); replacement.unmount();

  const rotate = fixture(); rotate.runtime.subscription = null;
  const rotated = rotate.mount(); await tick();
  assert.equal(rotated.value.state, 'ready'); assert.equal(rotate.runtime.subscriptions, 1);
  assert.equal(rotate.runtime.permissionPrompts, 0, 'An expired same-owner endpoint restores existing permission without another prompt');
  assert.equal(rotate.runtime.binding.endpoint, 'https://push.example.test/replacement'); rotated.unmount();

  const repair = fixture({ subscribed: false });
  repair.runtime.statusImpl = async () => ({ subscribed: repair.runtime.subscribePosts > 0 });
  const repaired = repair.mount(); await tick();
  assert.equal(repaired.value.state, 'ready'); assert.equal(repair.runtime.subscribePosts, 1);
  assert.equal(repair.runtime.unsubscribes, 1, 'A provider-rejected endpoint must be replaced, rather than re-posted');
  assert.equal(repair.runtime.serverDeletes.length, 0, 'An absent server registration needs no old-owner delete');
  assert.equal(repair.runtime.binding.endpoint, 'https://push.example.test/replacement'); repaired.unmount();

  for (const key of [null, new Uint8Array([1, 2, 3, 4]).buffer]) {
    const changedKey = fixture(); changedKey.runtime.subscription.options.applicationServerKey = key;
    const renewed = changedKey.mount(); await tick();
    assert.equal(renewed.value.state, 'ready'); assert.equal(changedKey.runtime.unsubscribes, 1);
    assert.deepEqual(changedKey.runtime.serverDeletes, ['https://push.example.test/device'], 'Renewal retires its authenticated old server registration to avoid device-cap accumulation');
    assert.equal(changedKey.runtime.binding.endpoint, 'https://push.example.test/replacement', 'An old/missing VAPID binding must renew before delivery is restored');
    assert.equal(changedKey.runtime.permissionPrompts, 0); renewed.unmount();
  }

  const reloadFailure = fixture(); reloadFailure.runtime.configImpl = async () => { throw Error('offline'); };
  const offlineReload = reloadFailure.mount(); await tick();
  assert.equal(offlineReload.value.state, 'error', 'A reload still needs ownership validation before portfolio access');
  assert.equal(reloadFailure.runtime.binding.user_id, 2, 'A transient startup error must not erase dormant same-owner delivery'); offlineReload.unmount();

  const optional = fixture({ permission: 'denied', config: { enabled: true, public_key: 'AQIDBA', require_notifications: false } });
  const optionalSession = optional.mount(); await tick();
  assert.equal(optionalSession.value.required, false); assert.equal(optionalSession.value.state, 'denied');
  assert.equal(optionalSession.value.canEnable, true); optionalSession.unmount();
  const manager = fixture({ user: { id: 1, is_manager: true } }); const managerSession = manager.mount(); await tick();
  assert.equal(managerSession.value.state, 'ready'); assert.equal(manager.runtime.configCalls, 0); managerSession.unmount();

  const adminUser = { id: 1, is_manager: true, username: 'admin' };
  const admin = fixture({ user: adminUser, permission: 'default' }); const adminSession = admin.mount(); await tick();
  assert.equal(adminSession.value.state, 'needs_permission'); assert.equal(adminSession.value.required, false, 'Admin notification enrollment is optional');
  assert.equal(adminSession.value.canEnable, true, 'Only the exact administrator can enroll manager-device notifications');
  assert.equal(admin.runtime.testCalls.length, 0, 'The test never sends automatically');
  await adminSession.value.testDelivery(); assert.equal(admin.runtime.testCalls.length, 0, 'An unverified device cannot request a push test');
  await adminSession.value.enable(); await tick();
  assert.equal(adminSession.value.state, 'ready'); assert.equal(admin.runtime.permissionPrompts, 1);
  await adminSession.value.testDelivery(); await tick();
  assert.equal(admin.runtime.testCalls[0].endpoint, admin.runtime.binding.endpoint, 'Tests target only this verified own-device endpoint');
  assert.equal(admin.runtime.deliveryChecks[0].delivery_id, 42);
  assert.equal(adminSession.value.testResult.status, 'sent');
  assert(adminSession.value.testResult.message.includes('שירות ההתראות קיבל'), 'Provider acceptance must not claim phone delivery');
  assert.equal(adminSession.value.testBusy, false);

  admin.runtime.deliveryImpl = async () => ({ subscribed: true, pending: 0, last_delivery: { status: 'failed', error: 'provider_rejected', sent_at: null } });
  await adminSession.value.testDelivery(); await tick();
  assert.equal(adminSession.value.testResult.status, 'failed');
  assert(adminSession.value.testResult.message.includes('דחה'), 'A rejected push must not display a success result');
  admin.runtime.deliveryImpl = (body, signal) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('timeout')), { once: true }));
  const boundedTest = adminSession.value.testDelivery(); await tick(); admin.advance(30001); await boundedTest; await tick();
  assert.equal(adminSession.value.testResult.status, 'queued'); assert.equal(adminSession.value.testBusy, false, 'Phone-test polling must end within its thirty-second bound');
  adminSession.unmount();

  const otherManager = fixture({ user: { id: 9, is_manager: true, username: 'manager', investor_name: 'מנהל מערכת' } });
  const otherManagerSession = otherManager.mount(); await tick();
  assert.equal(otherManagerSession.value.canEnable, false, 'Display name does not grant administrator enrollment');
  await otherManagerSession.value.enable(); await otherManagerSession.value.testDelivery();
  assert.equal(otherManager.runtime.subscribePosts, 0); assert.equal(otherManager.runtime.testCalls.length, 0); otherManagerSession.unmount();

  const investorTest = fixture(); const investorTestSession = investorTest.mount(); await tick();
  const lateDelivery = deferred(); investorTest.runtime.deliveryImpl = () => lateDelivery.promise;
  const oldTest = investorTestSession.value.testDelivery(); await tick();
  investorTest.window.dispatch('focus'); await tick();
  assert.equal(investorTestSession.value.testBusy, true, 'An ordinary focus check must not cancel an own-device test');
  investorTestSession.unmount();
  investorTest.runtime.owner = { user_id: 3, endpoint: 'https://push.example.test/next-owner' };
  investorTest.runtime.binding = investorTest.runtime.owner; investorTest.runtime.subscription.endpoint = investorTest.runtime.owner.endpoint;
  const nextOwner = investorTest.mount(investor(3)); await tick();
  lateDelivery.resolve({ subscribed: true, pending: 0, last_delivery: { status: 'sent', error: null, sent_at: 'synthetic-time' } });
  await oldTest; await tick();
  assert.equal(nextOwner.value.testResult, null, 'Late prior-account test responses must not appear in the next account');
  assert.equal(investorTest.runtime.binding.user_id, 3); nextOwner.unmount();

  console.log('PASS: actual hook rerenders, background checks, StrictMode persistence, account isolation, endpoint/key repair, once-per-session recovery, optional exact-admin activation, own-device test targeting, provider acceptance/failure, bounded polling, and stale test isolation. No browser or network used.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
