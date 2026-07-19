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
    keys:async()=>['cassie-account-v2','cassie-account-v3','cassie-account-v4','cassie-account-v4-20260719','cassie-account-v4-20260719-2','cassie-account-v4-20260719-3','cassie-account-v4-20260719-4','cassie-account-v4-20260719-5','cassie-account-v4-20260719-6'],
    delete:async name=>{deleted.push(name);return true;},
    match:async request=>request==='./index.html'?cachedIndex:String(request.url||request).endsWith('/styles.css')?cachedAsset:null,
  },
  fetch:(...args)=>fetchImpl(...args),
});
vm.runInContext(await readFile(new URL('../docs/sw.js',import.meta.url),'utf8'),context);
let installPromise;
listeners.install({waitUntil:promise=>{installPromise=promise;}});
await installPromise;
assert.deepEqual(opened,['cassie-account-v4-20260719-6']);
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
assert.deepEqual(deleted,['cassie-account-v2','cassie-account-v3','cassie-account-v4','cassie-account-v4-20260719','cassie-account-v4-20260719-2','cassie-account-v4-20260719-3','cassie-account-v4-20260719-4','cassie-account-v4-20260719-5']);

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
