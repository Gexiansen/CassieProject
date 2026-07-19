import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';
import vm from 'node:vm';

const listeners={},deleted=[],opened=[],cachedShell=[];
const context=vm.createContext({
  URL,
  self:{
    addEventListener:(type,handler)=>{listeners[type]=handler;},
    skipWaiting:async()=>{},
    clients:{claim:async()=>{}},
  },
  caches:{
    open:async name=>{opened.push(name);return {addAll:async files=>cachedShell.push(...files),put:async()=>{}};},
    keys:async()=>['cassie-account-v3','cassie-account-v4'],
    delete:async name=>{deleted.push(name);return true;},
    match:async()=>null,
  },
  fetch:async()=>({ok:true,clone(){return this;}}),
});
vm.runInContext(await readFile(new URL('../docs/sw.js',import.meta.url),'utf8'),context);
let installPromise;
listeners.install({waitUntil:promise=>{installPromise=promise;}});
await installPromise;
assert.deepEqual(opened,['cassie-account-v4']);
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
assert.deepEqual(deleted,['cassie-account-v3']);
console.log('PWA shell validation passed');
