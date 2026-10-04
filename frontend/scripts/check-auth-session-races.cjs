/* Synthetic interleavings only; no browser, network, live tokens, or account changes. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const jsx = require('react/jsx-runtime');
const root = path.resolve(__dirname, '../src');
const deferred = () => {let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick = async () => {for(let n=0;n<8;n++) await Promise.resolve();};

function load(source,imports,globals={}) {
  const module={exports:{}};
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require(name){return Object.hasOwn(imports,name)?imports[name]:require(name);},console,...globals});
  return module.exports;
}
async function main() {
  let token='synthetic-A';const effects=[],state=[],handlers={};let hook=0;
  const refs=[];let ref=0;const cleanups=[],logins=[],me=[];
  const fakeReact={createContext:()=>({Provider:'provider'}),useState(initial){const index=hook++;state[index]=initial;return [initial,value=>{state[index]=value;}];},useRef(initial){const value={current:initial};refs[ref++]=value;return value;},useCallback:fn=>fn,useMemo:fn=>fn(),useEffect:fn=>effects.push(fn)};
  const apiModule={AUTH_EXPIRED_EVENT:'expired',getToken:()=>token,setToken:value=>{token=value;},api:{me(){const request=deferred();me.push(request);return request.promise;},login(username){const request=deferred();logins.push({username,...request});return request.promise;}}};
  const push={detachBrowserPush(options){const request=deferred();cleanups.push({token,options,...request});return request.promise;}};
  const module=load(fs.readFileSync(path.join(root,'context/AuthContext.tsx'),'utf8'),{'react':fakeReact,'react/jsx-runtime':jsx,'../services/api':apiModule,'../services/pushNotifications':push,'../utils/welcomeSplash':{resetWelcomeSeen(){}}},{window:{addEventListener(name,fn){handlers[name]=fn;},removeEventListener(){}}});
  const auth=module.AuthProvider({children:null}).props.value;
  effects[1](); // Register the expiry handler without starting the automatic mount refresh.
  const oldRefresh=auth.refresh();await tick();
  const loginB=auth.login('B','synthetic');await tick();
  assert.equal(cleanups.length,1);assert.equal(cleanups[0].token,'synthetic-A');
  me[0].resolve({id:1,username:'A'});await oldRefresh;assert.equal(state[0],null,'Old refresh must not restore an account during login transition');
  cleanups[0].resolve();await tick();assert.equal(token,null);assert.equal(logins[0].username,'B');
  logins[0].resolve({access_token:'synthetic-B',user:{id:2,username:'B'}});await loginB;assert.equal(token,'synthetic-B');assert.equal(state[0].username,'B');

  const oldLogout=auth.logout();await tick();
  assert.equal(cleanups[1].options.preserveSubscription,true,'Ordinary logout must retain device opt-in');assert.equal(cleanups[1].options.serverCleanup,false,'Logout suspends private navigation without erasing enrollment');
  const loginC=auth.login('C','synthetic');await tick();assert.equal(cleanups.length,2,'New login waits for the already running browser cleanup');
  cleanups[1].resolve();await tick();assert.equal(cleanups.length,3);assert.equal(cleanups[2].token,'synthetic-B');
  assert.equal(cleanups[2].options.preserveSubscription,false,'Replacing an authenticated account still removes its old endpoint');
  cleanups[2].resolve();await tick();logins[1].resolve({access_token:'synthetic-C',user:{id:3,username:'C'}});await Promise.all([oldLogout,loginC]);
  assert.equal(token,'synthetic-C','Older logout must not clear the next login');assert.equal(state[0].username,'C');

  const expiredRefresh=auth.refresh();await tick();
  handlers.expired();await tick();assert.equal(token,null);assert.equal(cleanups[3].options.serverCleanup,false);
  assert.equal(cleanups[3].options.preserveSubscription,true,'An expired session must not erase the investor device enrollment');
  const loginD=auth.login('D','synthetic');await tick();assert.equal(logins.length,2,'Login must wait for delayed auth-expiry cleanup');
  me[1].reject(Error('expired old request'));await expiredRefresh;
  cleanups[3].resolve();await tick();assert.equal(cleanups.length,5);cleanups[4].resolve();await tick();
  assert.equal(cleanups[4].options.preserveSubscription,true,'Login without a prior token retains an endpoint for authenticated ownership verification');
  logins[2].resolve({access_token:'synthetic-D',user:{id:4,username:'D'}});await loginD;assert.equal(token,'synthetic-D');assert.equal(state[0].username,'D');

  const loginE=auth.login('E','synthetic');await tick();
  handlers.expired();assert.equal(token,null,'Expiry during old-session cleanup clears only the previous token');
  cleanups[5].resolve();await tick();assert.equal(logins[3].username,'E','New explicit login survives an old session expiry during cleanup');
  logins[3].resolve({access_token:'synthetic-E',user:{id:5,username:'E'}});await loginE;assert.equal(token,'synthetic-E');

  let storedToken='synthetic-old';const requests=[],expired=[];
  const apiSource=fs.readFileSync(path.join(root,'services/api.ts'),'utf8').replace('import.meta.env.VITE_API_BASE_URL','""');
  const transport=load(apiSource,{}, {localStorage:{getItem:()=>storedToken,setItem:(key,value)=>{storedToken=value;},removeItem:()=>{storedToken=null;}},fetch(url,init){const request=deferred();requests.push({url,init,...request});return request.promise;},window:{dispatchEvent:event=>expired.push(event.type)},CustomEvent:class {constructor(type){this.type=type;}},URLSearchParams});
  const staleRequest=transport.api.me().catch(error=>error);storedToken='synthetic-new';requests[0].resolve({status:401,ok:false,statusText:'expired',json:async()=>({detail:'expired'})});await staleRequest;
  assert.equal(storedToken,'synthetic-new','An old-token 401 must not log out the current session');assert.equal(expired.length,0);
  const cleanup=transport.api.pushUnsubscribe({endpoint:'https://push.example.test/device'},'synthetic-old').catch(error=>error);
  assert.equal(requests[1].init.headers.Authorization,'Bearer synthetic-old');requests[1].resolve({status:401,ok:false,statusText:'expired',json:async()=>({detail:'expired'})});await cleanup;assert.equal(storedToken,'synthetic-new');assert.equal(expired.length,0,'Cleanup 401 must not expire a new or pending login');
  const currentRequest=transport.api.me().catch(error=>error);requests[2].resolve({status:401,ok:false,statusText:'expired',json:async()=>({detail:'expired'})});await currentRequest;assert.equal(storedToken,null);assert.equal(expired.length,1,'The current session 401 still expires normally');

  let mediaToken='synthetic-old-media';const mediaRequests=[],mediaExpiry=[];
  const mediaSource=fs.readFileSync(path.join(root,'services/tutorialMedia.ts'),'utf8').replace('import.meta.env.VITE_API_BASE_URL','""');
  const media=load(mediaSource,{'./api':{AUTH_EXPIRED_EVENT:'expired',getToken:()=>mediaToken,setToken:value=>{mediaToken=value;}}},{fetch(url,init){const request=deferred();mediaRequests.push({url,init,...request});return request.promise;},window:{dispatchEvent:event=>mediaExpiry.push(event.type)},CustomEvent:class {constructor(type){this.type=type;}},URL:{createObjectURL(){throw Error('Failed media must not allocate object URLs');}}});
  const oldMedia=media.loadTutorialMedia('08-notifications',{throwIfAborted(){}}).catch(error=>error);mediaToken='synthetic-new-media';
  for(const request of mediaRequests) request.resolve({status:401,ok:false});await oldMedia;
  assert.equal(mediaToken,'synthetic-new-media');assert.equal(mediaExpiry.length,0,'Late tutorial asset 401 must not expire a newer account');
  const currentMedia=media.loadTutorialMedia('08-notifications',{throwIfAborted(){}}).catch(error=>error);
  for(const request of mediaRequests.slice(3)) request.resolve({status:401,ok:false});await currentMedia;
  assert.equal(mediaToken,null);assert.equal(mediaExpiry.length,1,'Current tutorial session expires once for three concurrent asset failures');
  console.log('PASS: stale refresh/logout guards, serialized expiry cleanup, login recovery after old expiry, captured cleanup token, and old/current API/media 401 isolation. No browser or network used.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
