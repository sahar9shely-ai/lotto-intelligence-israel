/* Ownership and ID checks for notification document viewing; no browser or network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const result = {exports: {}};
const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/utils/topupFocus.ts'), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText;
vm.runInNewContext(code, {module: result, exports: result.exports});
const {parseTopupFocusId, ownedTopupFocus, matchesTopupDetail} = result.exports;
const user = {id: 2, investor_id: 12, is_manager: false};
const own = {id: 7, investor_id: 12, status: 'contract'};
const foreign = {id: 8, investor_id: 13, status: 'contract'};
assert.equal(parseTopupFocusId('7'), 7);
for (const value of [null, '', '0', '-1', '7.5', '7x', '1e2', '9007199254740992']) {
  assert.equal(parseTopupFocusId(value), null, `Reject ambiguous/unsafe ID ${value}`);
}
assert.equal(ownedTopupFocus([own, foreign], 7, user), own);
assert.equal(ownedTopupFocus([own, foreign], 8, user), null, 'Foreign ID must not select or fetch a contract');
assert.equal(ownedTopupFocus([own], 7, {...user, investor_id: 99}), null, 'Account switch invalidates old selection');
assert.equal(ownedTopupFocus([own], 7, {...user, is_manager: true}), null, 'Investor notification cannot select manager actions');
for (const status of ['pending', 'cancelled', 'rejected', 'reversed']) {
  assert.equal(ownedTopupFocus([{...own, status}], 7, user), null);
}
assert.equal(ownedTopupFocus([{...own, status: 'executed'}], 7, user).id, 7, 'A completed document remains readable');
assert.equal(matchesTopupDetail(own, own, user), true);
assert.equal(matchesTopupDetail(foreign, own, user), false, 'Fresh response must match requested ID and owner');
assert.equal(matchesTopupDetail({...own, investor_id: 13}, own, user), false);
assert.equal(matchesTopupDetail(own, own, {...user, investor_id: 13}), false, 'Late old-account detail is rejected');
console.log('PASS: topup notification IDs select only owned existing contracts; foreign, stale-account and mismatched detail are rejected. No mutation, browser or network.');
