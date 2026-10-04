/* Execute the real reminder component with synthetic props, auth and requests.
 * No browser, network, real reminder, contract, or financial mutation is used. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const jsx = require('react/jsx-runtime');
const sourceRoot = path.resolve(__dirname, '../src');
const tick = async () => { for (let n = 0; n < 24; n++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function load(relative, imports = {}, globals = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(sourceRoot, relative), 'utf8').replace('import.meta.env.VITE_API_BASE_URL', '""');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => imports[name] || require(name), Error, AbortController, console, ...globals });
  return module.exports;
}
const admin = { id: 1, username: 'admin', is_manager: true };
const agreement = () => ({ id: 42, investor_id: 9, kind: 'open', status: 'pending', document_hash: 'a'.repeat(64), expires_at: '2100-01-01T00:00:00Z', snapshot: { title: 'הסכם פתיחת מסלול', investor_name: 'משקיע לדוגמה' } });
const signing = load('utils/agreementSigning.ts');
const pushTypes = load('types/push.ts');
const allNodes = node => !node || typeof node !== 'object' ? [] : [node, ...[].concat(node.props?.children || []).flatMap(allNodes)];
const text = node => Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' ? text(node.props?.children) : node == null || typeof node === 'boolean' ? '' : String(node);

function fixture(user = admin, row = agreement()) {
  let currentUser = user, props = { agreement: row, recipientName: 'משקיע לדוגמה' }, instance = null, renderer = null, tree = null, clock = 0, timerId = 0;
  const requests = [], timers = new Map();
  const window = { setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: clock + delay }); return id; }, clearTimeout(id) { timers.delete(id); } };
  const fakeReact = { useState(initial) { return renderer.useState(initial); }, useRef(initial) { return renderer.useRef(initial); }, useEffect(fn) { renderer.useEffect(fn); } };
  const module = load('components/AgreementReminderAction.tsx', {
    react: fakeReact, 'react/jsx-runtime': jsx,
    '../context/AuthContext': { useAuth: () => ({ user: currentUser }) },
    '../services/api': { api: { remindAgreement(id, body, signal) { const request = { id, body, signal, ...deferred() }; requests.push(request); return request.promise; } } },
    '../types/push': pushTypes, '../utils/agreementSigning': signing, './agreementReminderAction.css': {},
  }, { window });
  function render() {
    const element = module.AgreementReminderAction(props);
    if (!element) { instance?.unmount(); instance = null; tree = null; return; }
    if (instance?.key !== element.key) {
      instance?.unmount();
      const hooks = [], effects = [];
      let cursor = 0, mounted = true, scheduled = false;
      instance = {
        key: element.key,
        element,
        useState(initial) { const owner = this; const index = cursor++; if (!hooks[index]) hooks[index] = { state: initial }; return [hooks[index].state, value => {
          if (!mounted || Object.is(hooks[index].state, value)) return;
          hooks[index].state = value;
          if (!scheduled) { scheduled = true; queueMicrotask(() => { scheduled = false; if (mounted) tree = owner.render(owner.element); }); }
        }]; },
        useRef(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { current: initial }; return hooks[index]; },
        useEffect(fn) { const index = cursor++; if (!hooks[index]) { hooks[index] = {}; effects.push({ fn, cleanup: fn() }); } },
        render(element) { renderer = this; cursor = 0; return element.type(element.props); },
        unmount() { mounted = false; effects.forEach(effect => effect.cleanup?.()); },
      };
    }
    instance.element = element;
    tree = instance.render(element);
  }
  render();
  return { module, requests, get tree() { return tree; }, get props() { return props; }, update(nextProps) { props = nextProps; render(); }, user(value) { currentUser = value; render(); },
    button(label) { return allNodes(tree).find(node => node.type === 'button' && text(node) === label); },
    click(label) { const button = this.button(label); assert(button, `Missing action ${label}`); assert(!button.props.disabled, `Disabled action ${label}`); button.props.onClick(); },
    advance(ms) { clock += ms; for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.fn(); } },
    unmount() { instance?.unmount(); tree = null; },
  };
}

async function main() {
  for (const user of [null, { id: 2, username: 'investor', is_manager: false }, { id: 3, username: 'manager', is_manager: true, investor_name: 'מנהל מערכת' }, { ...admin, is_manager: false }, { ...admin, is_active: false }]) {
    const f = fixture(user); assert.equal(f.tree, null, 'Only the exact active administrator has the reminder action'); assert.equal(f.requests.length, 0);
  }
  for (const row of [{ ...agreement(), status: 'signed' }, { ...agreement(), status: 'cancelled' }, { ...agreement(), expires_at: '2020-01-01' }, { ...agreement(), expires_at: 'invalid' }, { ...agreement(), document_hash: '' }]) {
    const f = fixture(admin, row); assert.equal(f.tree, null, 'Only a current pending, unexpired serialized document can be reminded');
  }

  const f = fixture(); assert(f.button('שליחת תזכורת לחתימה')); assert.equal(f.requests.length, 0);
  f.click('שליחת תזכורת לחתימה'); await tick();
  assert(text(f.tree).includes('משקיע לדוגמה')); assert(text(f.tree).replace(/\s+/g, ' ').replace(/#\s+/g, '#').includes('הסכם פתיחת מסלול · הסכם #42'));
  assert.equal(f.requests.length, 0, 'Opening recipient/document review must not enqueue a reminder');
  f.click('ביטול'); await tick(); assert.equal(f.requests.length, 0);
  f.click('שליחת תזכורת לחתימה'); await tick();
  const confirm = f.button('אישור ושליחת תזכורת'); confirm.props.onClick(); confirm.props.onClick(); await tick();
  assert.equal(f.requests.length, 1, 'Concurrent duplicate clicks share one request');
  assert.equal(f.requests[0].id, 42); assert.equal(f.requests[0].body.document_hash, 'a'.repeat(64));
  assert(f.button('מכניסים תזכורת לשליחה…').props.disabled);
  f.requests[0].resolve({ queued: true, devices: 1, reason: 'queued', next_eligible_at: null }); await tick();
  assert(text(f.tree).includes('נוספה לתור השליחה')); assert(!text(f.tree).includes('נשלחה לטלפון'), 'Queuing must not claim device delivery');
  assert(!f.button('שליחת תזכורת לחתימה').props.disabled, 'A long-open page can review a later attempt; server cooldown remains authoritative');

  for (const [reason, expected] of [['already_pending', 'לא נוספה תזכורת נוספת'], ['recently_sent', 'הוכנה לאחרונה'], ['no_devices', 'אין מכשיר רשום להתראות']]) {
    f.click('שליחת תזכורת לחתימה'); await tick(); f.click('אישור ושליחת תזכורת'); await tick();
    f.requests.at(-1).resolve({ queued: false, devices: 0, reason, next_eligible_at: reason === 'recently_sent' ? '2100-01-01T10:00:00Z' : null }); await tick();
    assert(text(f.tree).includes(expected), `${reason} needs honest, distinct feedback`);
  }
  f.unmount();

  const change = fixture(); change.click('שליחת תזכורת לחתימה'); await tick();
  const replacement = { ...agreement(), document_hash: 'b'.repeat(64) };
  change.update({ agreement: replacement, recipientName: 'משקיע לדוגמה' }); await tick();
  assert.equal(change.button('אישור ושליחת תזכורת'), undefined, 'Changing document hash invalidates previous review');
  assert.equal(change.requests.length, 0); change.unmount();

  const mutation = fixture(); mutation.click('שליחת תזכורת לחתימה'); await tick();
  mutation.props.agreement.document_hash = 'c'.repeat(64);
  mutation.click('אישור ושליחת תזכורת'); await tick();
  assert.equal(mutation.requests.length, 0, 'Even a mutation before React re-render cannot send an unreviewed revision');
  mutation.unmount();

  const expiry = fixture(); expiry.click('שליחת תזכורת לחתימה'); await tick();
  expiry.props.agreement.expires_at = '2020-01-01T00:00:00Z'; expiry.click('אישור ושליחת תזכורת'); await tick();
  assert.equal(expiry.requests.length, 0, 'Expiration after review must block final submission');
  assert(text(expiry.tree).includes('ההסכם כבר אינו זמין לחתימה'), 'An expired review must explain why the action stopped');
  assert(text(expiry.tree).includes('יש לרענן את הרשימה')); assert.equal(expiry.button('אישור ושליחת תזכורת'), undefined, 'Expiration closes the unusable review');
  expiry.unmount();

  const oldAccount = fixture(); oldAccount.click('שליחת תזכורת לחתימה'); await tick(); oldAccount.click('אישור ושליחת תזכורת'); await tick();
  oldAccount.user({ id: 8, username: 'investor', is_manager: false });
  assert(oldAccount.requests[0].signal.aborted, 'Changing account aborts the pending UI request');
  oldAccount.requests[0].resolve({ queued: true, devices: 1, reason: 'queued' }); await tick();
  assert.equal(oldAccount.tree, null, 'Late administrator response never appears for the next account');

  const timeout = fixture(); timeout.click('שליחת תזכורת לחתימה'); await tick(); timeout.click('אישור ושליחת תזכורת'); await tick();
  timeout.advance(20001); assert(timeout.requests[0].signal.aborted); timeout.requests[0].reject(Error('aborted')); await tick();
  assert(text(timeout.tree).includes('לא ניתן לאמת כרגע את השליחה'), 'A timeout must not falsely claim no notification was queued'); timeout.unmount();

  const transportCalls = [];
  const transport = load('services/api.ts', {}, { localStorage: { getItem: () => 'synthetic-admin-token' }, fetch: async (url, init) => { transportCalls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ queued: true, devices: 1, reason: 'queued' }) }; } });
  await transport.api.remindAgreement(42, { document_hash: 'a'.repeat(64) });
  assert.equal(transportCalls[0].url, '/api/v1/push/agreements/42/reminder'); assert.equal(transportCalls[0].init.method, 'POST');
  assert.equal(JSON.parse(transportCalls[0].init.body).document_hash, 'a'.repeat(64)); assert.equal(transportCalls[0].init.headers.Authorization, 'Bearer synthetic-admin-token');
  console.log('PASS: exact-admin-only pending reminder action, recipient/document review, explicit confirmation, duplicate click guard, stale revision/expiry checks, honest queue/cooldown/no-device feedback, timeout, account isolation, and authenticated API serialization. No browser or network used.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
