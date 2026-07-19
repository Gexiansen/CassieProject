import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {convertBackup} from '../tools/convert-v3-to-v4.mjs';

const source=JSON.parse(await readFile(new URL('../test-data/account-book-demo-v2.json',import.meta.url),'utf8'));
const fixture=JSON.parse(await readFile(new URL('../test-data/account-book-demo-v4.json',import.meta.url),'utf8'));
const rejected=convertBackup(source);
assert.equal(rejected.ok,false);
assert.equal(rejected.report.unmappedBeneficiaries.length,34);

const converted=convertBackup(source,{unassignedBeneficiaryId:'family'});
assert.equal(converted.ok,true);
assert.equal(converted.report.originalRecordCount,45);
assert.equal(converted.report.expenseCount,34);
assert.equal(converted.report.excludedIncomeCount,11);
assert.equal(converted.backup.summary.recordCount,34);
assert.equal(converted.backup.summary.expenseCents,1886980);
assert.equal(converted.backup.records.records.every(record=>!('type' in record)&&!('cat' in record)&&!('sub' in record)),true);

const storage=new Map();
const context=vm.createContext({
  console,
  crypto:webcrypto,
  localStorage:{
    getItem:key=>storage.has(key)?storage.get(key):null,
    setItem:(key,value)=>storage.set(key,String(value)),
    removeItem:key=>storage.delete(key),
  },
});
vm.runInContext(await readFile(new URL('../docs/js/model.js',import.meta.url),'utf8'),context);
vm.runInContext(await readFile(new URL('../docs/js/storage.js',import.meta.url),'utf8'),context);
context.backupInput=converted.backup;
const checked=vm.runInContext('(()=>{const settings=normalizeSettings(backupInput.settings),plans=normalizePlans(backupInput.plans),result=normalizeRecords(backupInput.records.records,settings,plans);return {settings,plans,records:result.records,errors:result.errors,envelope:backupEnvelope(result.records,settings,plans)};})()',context);
assert.equal(checked.errors.length,0);
assert.equal(checked.records.length,34);
assert.equal(checked.envelope.summary.expenseCents,1886980);
assert.equal(new Set(checked.settings.categories.flatMap(group=>group.items.map(item=>item.id))).size,checked.settings.categories.flatMap(group=>group.items).length);
assert.equal(checked.settings.defaultBeneficiaryId,'family');
context.settingsInput=structuredClone(converted.backup.settings);
context.settingsInput.defaultBeneficiaryId='missing';
assert.equal(vm.runInContext('normalizeSettings(settingsInput).defaultBeneficiaryId',context),'family');
context.settingsInput=structuredClone(converted.backup.settings);
context.settingsInput.beneficiaries.push({id:'member-5',name:'成员五',kind:'member',active:true},{id:'member-6',name:'成员六',kind:'member',active:true},{id:'member-7',name:'成员七',kind:'member',active:true},{id:'member-8',name:'成员八',kind:'member',active:true},{id:'member-9',name:'成员九',kind:'member',active:true});
assert.throws(()=>vm.runInContext('normalizeSettings(settingsInput)',context),/不能超过 8 个/);
context.backupInput=fixture;
const fixtureChecked=vm.runInContext('(()=>{const settings=normalizeSettings(backupInput.settings),plans=normalizePlans(backupInput.plans),result=normalizeRecords(backupInput.records.records,settings,plans);return {errors:result.errors,summary:backupEnvelope(result.records,settings,plans).summary};})()',context);
assert.equal(fixtureChecked.errors.length,0);
assert.equal(fixtureChecked.summary.recordCount,34);
assert.equal(fixtureChecked.summary.expenseCents,1886980);

console.log('schema v4 converter and round-trip validation passed');
