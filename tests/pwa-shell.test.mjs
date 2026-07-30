import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';
import vm from 'node:vm';

const listeners={},deleted=[],opened=[],cachedShell=[],cachePuts=[];
const cachedIndex={source:'cached-index'},cachedAsset={source:'cached-asset'};
let fetchImpl=async()=>({ok:true,clone(){return this;}});
const context=vm.createContext({
  URL,
  self:{
    addEventListener:(type,handler)=>{listeners[type]=handler;},
    skipWaiting:async()=>{},
    clients:{claim:async()=>{}},
    location:{origin:'https://example.test'},
  },
  caches:{
    open:async name=>{opened.push(name);return {addAll:async files=>cachedShell.push(...files),put:async(key,value)=>{cachePuts.push({key,value});}};},
    keys:async()=>['cassie-account-v2','cassie-account-v3','cassie-account-v4-20260719-6','cassie-account-v5-20260722-1','cassie-account-v5-20260724-1','cassie-account-v5-20260725-1','cassie-account-v5-20260729-1','cassie-account-v5-20260729-2'],
    delete:async name=>{deleted.push(name);return true;},
    match:async request=>request==='./index.html'?cachedIndex:String(request.url||request).endsWith('/styles.css')?cachedAsset:null,
  },
  fetch:(...args)=>fetchImpl(...args),
});
vm.runInContext(await readFile(new URL('../docs/sw.js',import.meta.url),'utf8'),context);
let installPromise;
listeners.install({waitUntil:promise=>{installPromise=promise;}});
await installPromise;
assert.deepEqual(opened,['cassie-account-v5-20260730-1']);
assert.equal(cachedShell.includes('./styles.css'),true);
assert.equal(cachedShell.includes('./js/model.js'),true);
assert.equal(cachedShell.includes('./js/storage.js'),true);
assert.equal(cachedShell.includes('./js/app.js'),true);
for(const entry of cachedShell){
  const relative=entry==='./'?'index.html':entry.replace(/^\.\//,'');
  await access(new URL('../docs/'+relative,import.meta.url));
}
let activatePromise;
listeners.activate({waitUntil:promise=>{activatePromise=promise;}});
await activatePromise;
assert.deepEqual(deleted,['cassie-account-v2','cassie-account-v3','cassie-account-v4-20260719-6','cassie-account-v5-20260722-1','cassie-account-v5-20260724-1','cassie-account-v5-20260725-1','cassie-account-v5-20260729-1','cassie-account-v5-20260729-2']);

const appSource=await readFile(new URL('../docs/js/app.js',import.meta.url),'utf8');
const stylesSource=await readFile(new URL('../docs/styles.css',import.meta.url),'utf8');
assert.match(appSource,/record-overlay/);
assert.match(appSource,/setRecordNoteSearchMode/);
assert.match(appSource,/visualViewport/);
assert.match(appSource,/enterkeyhint="done"/);
assert.match(appSource,/RECORD_KEYBOARD_OPEN_GAP=140,RECORD_KEYBOARD_CLOSE_GAP=80/);
assert.match(appSource,/note===document\.activeElement\)note\.blur\(\)/);
assert.match(appSource,/aria-current="page"/);
assert.match(appSource,/showPlanningPeriod=state\.tab==='planning'&&\(state\.planningView==='budget'\|\|state\.planningView==='summary'\)/);
assert.doesNotMatch(appSource,/data-action="set-view"/);
assert.match(appSource,/REVIEW_DRAFTS_KEY='cassie_review_drafts_v1'/);
assert.match(appSource,/function requestCloseModals/);
assert.match(appSource,/function openBackupSavedConfirmation/);
assert.match(appSource,/aria-pressed=/);
assert.doesNotMatch(appSource,/☁️/);
assert.match(stylesSource,/\.record-sheet\.note-search-mode/);
assert.match(stylesSource,/\.tabs\{position:fixed/);
assert.doesNotMatch(stylesSource,/\.fab\{/);
assert.match(stylesSource,/\.custom-date-field\.hidden\{display:none;\}/);
assert.doesNotMatch(stylesSource,/color:#94a3b8/);
const keyboardHelper=appSource.slice(appSource.indexOf('function recordKeyboardViewportState'),appSource.indexOf('function syncRecordViewport'));
const keyboardContext=vm.createContext({});
vm.runInContext(`const RECORD_KEYBOARD_OPEN_GAP=140,RECORD_KEYBOARD_CLOSE_GAP=80;${keyboardHelper}`,keyboardContext);
assert.deepEqual({...vm.runInContext('recordKeyboardViewportState(844,540,false)',keyboardContext)},{keyboardSeen:true,keyboardClosed:false});
assert.deepEqual({...vm.runInContext('recordKeyboardViewportState(844,720,true)',keyboardContext)},{keyboardSeen:true,keyboardClosed:false});
assert.deepEqual({...vm.runInContext('recordKeyboardViewportState(844,790,true)',keyboardContext)},{keyboardSeen:true,keyboardClosed:true});
assert.deepEqual({...vm.runInContext('recordKeyboardViewportState(844,800,false)',keyboardContext)},{keyboardSeen:false,keyboardClosed:false});

fetchImpl=async()=>{throw new Error('offline');};
let navigationResponse;
listeners.fetch({
  request:{method:'GET',url:'https://example.test/',mode:'navigate'},
  respondWith:promise=>{navigationResponse=promise;},
});
assert.equal(await navigationResponse,cachedIndex);

let assetResponse;
listeners.fetch({
  request:{method:'GET',url:'https://example.test/styles.css',mode:'no-cors'},
  respondWith:promise=>{assetResponse=promise;},
});
assert.equal(await assetResponse,cachedAsset);

const freshIndex={ok:true,clone(){return this;}};
fetchImpl=async()=>freshIndex;
listeners.fetch({
  request:{method:'GET',url:'https://example.test/',mode:'navigate'},
  respondWith:promise=>{navigationResponse=promise;},
});
assert.equal(await navigationResponse,freshIndex);
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(cachePuts.some(item=>item.key==='./index.html'&&item.value===freshIndex),true);
console.log('PWA shell validation passed');
