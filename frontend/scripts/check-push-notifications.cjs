/* Pure component/service-worker checks. No browser, network, permission grant, or live account. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const sourceRoot = path.resolve(__dirname, '../src');

function fakeIndexedDB(record, events = []) {
  return {open() {
    const request = {};
    request.result = {createObjectStore() {},close() {},transaction() {
      let pending=0;
      const transaction = {objectStore() {return {
        put(value,key) {record[key]=value;if(key==='current') events.push(value ? 'bind:'+value.user_id : 'clear');pending++;queueMicrotask(()=>{if(--pending===0)transaction.oncomplete?.();});},
        get(key) {const read={};pending++;queueMicrotask(()=>{read.result=record[key];read.onsuccess?.();if(--pending===0)transaction.oncomplete?.();});return read;},
      };}};
      return transaction;
    }};
    queueMicrotask(()=>request.onsuccess?.());
    return request;
  }};
}
function loadTs(relative, imports, globals = {}) {
  const result={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(path.join(sourceRoot,relative),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
  const context=vm.createContext({module:result,exports:result.exports,require(name){return Object.hasOwn(imports,name)?imports[name]:require(name);},console,setTimeout,clearTimeout,queueMicrotask,...globals});
  vm.runInContext(code,context,{filename:relative});
  return result.exports;
}

async function main() {
  const record={current:null};
  const events=[];
  let token='synthetic-old-session';
  const endpoint='https://push.example.test/device-1';
  const subscription={endpoint,unsubscribe:async()=>{events.push('unsubscribe');return true;}};
  const registration={active:{scriptURL:'https://tazrim.test/push-sw.js'},getNotifications:async()=>[{close(){events.push('close');}}],pushManager:{getSubscription:async()=>subscription}};
  const pageWindow={isSecureContext:true,Notification:{},PushManager:{},matchMedia:()=>({matches:false}),setTimeout,clearTimeout,dispatchEvent(){}};
  const navigator={userAgent:'Android',platform:'Linux',maxTouchPoints:0,serviceWorker:{getRegistrations:async()=>[registration]}};
  const service=loadTs('services/pushNotifications.ts',{'./api':{getToken:()=>token,api:{pushUnsubscribe:async (body,cleanupToken)=>{assert.equal(body.endpoint,endpoint);assert.equal(cleanupToken,'synthetic-old-session','Cleanup must use the session captured before asynchronous browser access');events.push('server-delete');}}}},{window:pageWindow,navigator,indexedDB:fakeIndexedDB(record,events),atob:base64=>Buffer.from(base64,'base64').toString('binary'),URL,Event});
  assert.equal(service.pushSupport(),'supported');
  navigator.userAgent='iPhone';assert.equal(service.pushSupport(),'install_required');
  pageWindow.matchMedia=()=>({matches:true});assert.equal(service.pushSupport(),'supported');
  pageWindow.isSecureContext=false;assert.equal(service.pushSupport(),'unsupported');pageWindow.isSecureContext=true;
  assert.deepEqual([...new Uint8Array(service.decodePushPublicKey('AQIDBA'))],[1,2,3,4]);
  await Promise.all([service.setBrowserPushBinding({user_id:1,endpoint}),service.setBrowserPushBinding(null),service.setBrowserPushBinding({user_id:2,endpoint})]);
  assert.equal(record.current.user_id,2,'Serialized writes must keep latest account binding');
  assert.equal((await service.getBrowserPushOwner()).user_id,2,'The persisted hint records only the confirmed endpoint owner');
  events.length=0;await service.detachBrowserPush({serverCleanup:false,preserveSubscription:true});
  assert.deepEqual(events,['clear','close'],'Ordinary logout/expiry clears delivery and existing notices while retaining opt-in enrollment');
  assert.equal(record.current,null);assert.equal((await service.getBrowserPushOwner()).user_id,2,'Returning investor keeps an ownership hint without an active delivery marker');
  events.length=0;const oldCleanup=service.detachBrowserPush();token='synthetic-new-session';await oldCleanup;
  assert.equal(record.current,null);assert.deepEqual(events,['clear','close','server-delete','unsubscribe'],'Clear marker and server binding before local unsubscribe');
  assert.equal(await service.getBrowserPushOwner(),null,'Explicit account replacement forgets the removed endpoint owner');
  events.length=0;await service.detachBrowserPush({serverCleanup:false});
  assert.deepEqual(events,['clear','close','unsubscribe'],'Auth expiry must not recursively call authenticated server cleanup');
  const replacementEndpoint='https://push.example.test/device-2';
  await service.setBrowserPushBinding({user_id:3,endpoint:replacementEndpoint});
  await service.clearBrowserPushOwner(endpoint);
  assert.equal((await service.getBrowserPushOwner()).user_id,3,'Delayed cleanup for another endpoint cannot erase a new owner');
  delete record.owner;record.current={user_id:3,endpoint:replacementEndpoint};
  assert.equal((await service.getBrowserPushOwner()).user_id,3,'Older installations recover the owner hint from their existing active marker');

  const handlers={};const displayed=[];const navigation=[];
  const swRecord={current:{user_id:2,endpoint}};
  const self={location:{origin:'https://tazrim.test'},registration:{pushManager:{getSubscription:async()=>subscription},showNotification:async(title,options)=>displayed.push({title,options})},clients:{claim:async()=>{},matchAll:async()=>[],openWindow:async url=>navigation.push(url)},skipWaiting:async()=>{},addEventListener(name,handler){handlers[name]=handler;}};
  const swContext=vm.createContext({self,indexedDB:fakeIndexedDB(swRecord),URL,Promise,Number});
  const swSource=fs.readFileSync(path.resolve(__dirname,'../public/push-sw.js'),'utf8');
  vm.runInContext(swSource,swContext);
  assert.equal(handlers.fetch,undefined,'Worker must never cache/intercept API or account pages');
  const safe=href=>vm.runInContext(`safeNotificationUrl(${JSON.stringify(href)})`,swContext);
  assert.equal(safe('https://evil.test/payments'),'https://tazrim.test/');
  assert.equal(safe('javascript:alert(1)'),'https://tazrim.test/');
  assert.equal(safe('/api/v1/auth/me'),'https://tazrim.test/');
  assert.equal(safe('/sign?token=secret'),'https://tazrim.test/');
  assert.equal(safe('/agreements/42/sign?token=secret'),'https://tazrim.test/agreements/42/sign');
  assert.equal(safe('/agreements/other/sign'),'https://tazrim.test/');
  const target=new URL(safe('/payments?payment_id=7&year=2026&month=2026-11&token=secret&amount=999#private'));
  assert.equal(target.pathname,'/payments');assert.equal(target.searchParams.get('payment_id'),'7');assert.equal(target.searchParams.get('month'),'2026-11');assert.equal(target.searchParams.has('token'),false);assert.equal(target.searchParams.has('amount'),false);assert.equal(target.hash,'');
  const emit=async(name,event)=>{let waiting;handlers[name]({...event,waitUntil(promise){waiting=promise;}});await waiting;};
  await emit('push',{data:{json:()=>({title:'PRIVATE NAME',body:'PRIVATE AMOUNT',tag:'tazrim-push-42',data:{owner_user_id:2,href:'/payments?payment_id=7'}})}});
  assert.equal(displayed.length,1);assert.equal(displayed[0].title,'תזרים');assert.equal(displayed[0].options.body.includes('PRIVATE'),false);assert.equal(displayed[0].options.data.user_id,2);
  assert.equal(displayed[0].options.tag,'tazrim-push-42','Verified notices must keep distinct notification tags');
  await emit('push',{data:{json:()=>({data:{owner_user_id:1,href:'/payments?payment_id=77'}})}});
  assert.equal(displayed.length,2);assert.equal(Object.keys(displayed[1].options.data).length,0,'Wrong-account push must carry no navigation target or account identifier');
  await emit('notificationclick',{notification:{data:displayed[1].options.data,close(){}}});assert.equal(navigation.length,0);
  swRecord.current=null;
  swRecord.owner={user_id:2,endpoint};
  await emit('notificationclick',{notification:{data:displayed[0].options.data,close(){}}});assert.equal(navigation.length,0,'Logout must disable clicks on previously displayed notifications');
  await emit('push',{data:{json:()=>({data:{owner_user_id:2,href:'/payments?payment_id=7'}})}});
  assert.equal(Object.keys(displayed[2].options.data).length,0,'Retained owner hint alone must never authorize a private notification destination');
  swRecord.current={user_id:2,endpoint};
  await emit('notificationclick',{notification:{data:displayed[0].options.data,close(){}}});assert.deepEqual(navigation,['https://tazrim.test/payments?payment_id=7']);
  await emit('push',{data:{json(){throw Error('invalid json');}}});assert.equal(Object.keys(displayed[3].options.data).length,0,'Malformed pushes still use a generic visible notification without navigation');

  let user={id:2,is_manager:false};let push={state:'needs_permission',busy:false,error:null,canEnable:true,enabled:true,testBusy:false,testResult:null,testDelivery:async()=>{},enable:async()=>{},refresh:async()=>{}};
  const pushTypes=loadTs('types/push.ts',{});
  const component=loadTs('components/PushNotificationAccess.tsx',{'../context/AuthContext':{useAuth:()=>({user,logout:async()=>{}})},'../context/PushNotificationsContext':{usePushNotifications:()=>push},'../services/tutorialMedia':{loadTutorialMedia:async()=>{}},'../types/push':pushTypes,'./pushNotificationAccess.css':{}});
  const render=()=>renderToStaticMarkup(React.createElement(component.PushNotificationAccess,null,React.createElement('div',null,'PRIVATE_LEDGER')));
  for(const state of ['checking','needs_permission','denied','install_required','unsupported','unavailable','error']){
    push.state=state;const html=render();assert.equal(html.includes('PRIVATE_LEDGER'),false,`${state} must not mount financial contents`);assert(html.includes('יציאה מהחשבון'));assert(html.includes('סרטון 8: הפעלת התראות'));
  }
  push.state='ready';assert(render().includes('PRIVATE_LEDGER'));
  user={id:1,is_manager:true};push.state='unavailable';assert(render().includes('PRIVATE_LEDGER'),'Manager must remain accessible');
  user={id:1,is_manager:true,username:'admin'};push.state='needs_permission';assert(render().includes('PRIVATE_LEDGER'),'Administrator activation must never gate administration');
  const renderSettings=()=>renderToStaticMarkup(React.createElement(component.PushNotificationSettings));
  assert(renderSettings().includes('הפעל התראות במכשיר הזה'),'Administrator has an explicit activation control');
  push.state='ready';push.testResult={status:'sent',message:'שירות ההתראות קיבל את התראת הבדיקה'};
  assert(renderSettings().includes('שליחת התראת בדיקה למכשיר הזה'));assert(renderSettings().includes('שירות ההתראות קיבל'));
  user={id:9,is_manager:true,username:'manager',investor_name:'מנהל מערכת'};assert.equal(renderSettings(),'','A matching display name must not expose administrator settings');
  console.log('PASS: persistent opt-in ownership, logout suspension, cleanup order, legacy hints, secure worker destinations, generic logged-out delivery, stale-account click protection, permission support, and 9 access gate states. No browser or network used.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
