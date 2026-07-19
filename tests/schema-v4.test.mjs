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

context.projectSettings=fixture.settings;
context.projectList=[
  {id:'travel-old',name:'旧旅行',type:'travel',budgetCents:160000,startDate:'2025-01-01',endDate:'2025-01-02',people:2,status:'completed',updatedAt:'2025-01-03T00:00:00.000Z'},
  {id:'travel-reference',name:'杭州旅行',type:'travel',budgetCents:220000,startDate:'2026-05-01',endDate:'2026-05-03',people:4,status:'completed',updatedAt:'2026-05-04T00:00:00.000Z'},
  {id:'travel-empty',name:'空旅行',type:'travel',budgetCents:300000,startDate:'2026-06-01',endDate:'2026-06-03',people:3,status:'completed',updatedAt:'2026-06-04T00:00:00.000Z'},
  {id:'travel-active',name:'进行中旅行',type:'travel',budgetCents:400000,startDate:'2026-07-01',endDate:'2026-07-03',people:4,status:'active',updatedAt:'2026-07-04T00:00:00.000Z'},
];
context.projectRecords=[
  {projectId:'travel-old',categoryId:'transport-ticket',amountCents:120000},
  {projectId:'travel-reference',categoryId:'living-hotel',amountCents:120000},
  {projectId:'travel-reference',categoryId:'transport-ticket',amountCents:80000},
  {projectId:'travel-active',categoryId:'living-hotel',amountCents:500000},
];
const projectReference=vm.runInContext('recentProjectReference("travel",projectList,projectRecords,projectSettings.categories)',context);
assert.equal(projectReference.project.id,'travel-reference');
assert.equal(projectReference.metrics.actualCents,200000);
assert.equal(projectReference.metrics.perPersonCents,50000);
assert.equal(projectReference.metrics.perPersonDayCents,16667);
assert.equal(projectReference.topCategory.name,'居住生活');
assert.equal(projectReference.topCategory.amountCents,120000);
assert.equal(vm.runInContext('recentProjectReference("renovation",projectList,projectRecords,projectSettings.categories)',context),null);
const projectHistory=vm.runInContext('projectHistoryReferences("travel",projectList,projectRecords,projectSettings.categories,"travel-reference",5)',context);
assert.equal(projectHistory.map(item=>item.project.id).join(','),'travel-old');
assert.equal(projectHistory[0].metrics.actualCents,120000);
assert.equal(vm.runInContext('projectHistoryReferences("travel",projectList,projectRecords,projectSettings.categories,"",1).length',context),1);

context.beneficiaryRecords=[
  {beneficiaryId:'family',amountCents:10000},
  {beneficiaryId:'wife',amountCents:20000},
  {beneficiaryId:'family',amountCents:5000},
];
const beneficiarySummary=vm.runInContext('beneficiaryBreakdown(beneficiaryRecords,projectSettings.beneficiaries)',context);
assert.equal(beneficiarySummary.totalCents,35000);
assert.equal(beneficiarySummary.items.map(item=>item.id).join(','),'wife,family');
assert.equal(beneficiarySummary.items[0].amountCents,20000);
assert.equal(beneficiarySummary.items[1].percent.toFixed(1),'42.9');
assert.equal(vm.runInContext('beneficiaryBreakdown([],projectSettings.beneficiaries).items.length',context),0);

console.log('schema v4 converter and round-trip validation passed');
