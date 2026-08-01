import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {convertBackup} from '../tools/convert-v4-to-v5.mjs';

const source=JSON.parse(await readFile(new URL('../test-data/account-book-demo-v4.json',import.meta.url),'utf8'));
const fixture=JSON.parse(await readFile(new URL('../test-data/account-book-demo-v5.json',import.meta.url),'utf8'));
const converted=convertBackup(source);
assert.equal(converted.ok,true);
assert.equal(converted.report.originalRecordCount,34);
assert.equal(converted.report.convertedRecordCount,34);
assert.equal(converted.report.originalExpenseCents,1886980);
assert.equal(converted.report.convertedExpenseCents,1886980);
assert.equal(converted.report.typeCounts.fixed,1);
assert.equal(converted.report.typeCounts.flexible,19);
assert.equal(converted.report.typeCounts.discretionary,10);
assert.equal(converted.report.typeCounts.exceptional,4);
assert.equal(converted.backup.records.records.every(record=>!('categoryId' in record)&&['fixed','flexible','discretionary','exceptional'].includes(record.spendingType)),true);

const custom=structuredClone(source);custom.records.records[0].categoryId='custom-unknown';
const rejected=convertBackup(custom);
assert.equal(rejected.ok,false);
assert.deepEqual(rejected.report.unmappedCategories,[{categoryId:'custom-unknown',count:1}]);
assert.equal(convertBackup(custom,{categoryMappings:{'custom-unknown':'fixed'}}).ok,true);

const storage=new Map();
let failNextKey='';
const context=vm.createContext({
  console,
  crypto:webcrypto,
  toast:()=>{},
  storageLocked:false,
  localStorage:{
    getItem:key=>storage.has(key)?storage.get(key):null,
    setItem:(key,value)=>{if(key===failNextKey){failNextKey='';throw new Error('quota exceeded');}storage.set(key,String(value));},
    removeItem:key=>storage.delete(key),
  },
});
vm.runInContext(await readFile(new URL('../docs/js/model.js',import.meta.url),'utf8'),context);
vm.runInContext(await readFile(new URL('../docs/js/storage.js',import.meta.url),'utf8'),context);
context.backupInput=fixture;
const checked=vm.runInContext('(()=>{const settings=normalizeSettings(backupInput.settings),plans=normalizePlans(backupInput.plans),result=normalizeRecords(backupInput.records.records,settings,plans);return {settings,plans,records:result.records,errors:result.errors,envelope:backupEnvelope(result.records,settings,plans)};})()',context);
assert.equal(checked.errors.length,0);
assert.equal(checked.records.length,34);
assert.equal(checked.envelope.schemaVersion,5);
assert.equal(checked.envelope.summary.expenseCents,1886980);
assert.equal('categories' in checked.settings,false);
assert.equal(checked.settings.defaultBeneficiaryId,'family');
context.prefs=checked.settings;
context.decisions=checked.plans;
storage.set('cassie_records_v4','v4-original-content');
const legacyState=vm.runInContext('readStoredData(prefs,decisions)',context);
assert.equal(legacyState.needsUpgrade,true);
assert.equal(storage.get('cassie_records_v4'),'v4-original-content');
storage.delete('cassie_records_v4');

const persistedSettings=structuredClone(checked.settings),persistedPlans=structuredClone(checked.plans);
storage.set('cassie_settings_v5',JSON.stringify(persistedSettings));
storage.set('cassie_plans_v5',JSON.stringify(persistedPlans));
context.prefs=structuredClone(persistedSettings);
context.prefs.beneficiaries[0].name='临时名称';
failNextKey='cassie_settings_v5';
assert.equal(vm.runInContext('saveSettings()',context),false);
assert.equal(vm.runInContext('prefs.beneficiaries[0].name',context),persistedSettings.beneficiaries[0].name);
assert.equal(storage.get('cassie_settings_v5'),JSON.stringify(persistedSettings));

context.decisions=structuredClone(persistedPlans);
context.decisions.noSpendDates=['2026-07-19'];
failNextKey='cassie_plans_v5';
assert.equal(vm.runInContext('saveDecisions()',context),false);
assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(decisions.noSpendDates)',context)),persistedPlans.noSpendDates);
assert.equal(storage.get('cassie_plans_v5'),JSON.stringify(persistedPlans));

const recordsBeforePersist=storage.get('cassie_records_v5')||null;
context.checkedRecords=checked.records;
failNextKey='cassie_records_v5';
assert.equal(vm.runInContext('persist(checkedRecords)',context),false);
assert.equal(storage.get('cassie_records_v5')||null,recordsBeforePersist);

const restoreBefore={
  records:storage.get('cassie_records_v5'),
  settings:storage.get('cassie_settings_v5'),
  plans:storage.get('cassie_plans_v5'),
};
failNextKey='cassie_settings_v5';
assert.equal(vm.runInContext('persistFullRestore([],defaultSettings(),defaultPlans(),true)',context),false);
assert.deepEqual({records:storage.get('cassie_records_v5'),settings:storage.get('cassie_settings_v5'),plans:storage.get('cassie_plans_v5')},restoreBefore);

context.settingsInput=structuredClone(fixture.settings);
context.settingsInput.defaultBeneficiaryId='missing';
assert.equal(vm.runInContext('normalizeSettings(settingsInput).defaultBeneficiaryId',context),'family');
context.settingsInput=structuredClone(fixture.settings);
context.settingsInput.beneficiaries.push({id:'member-5',name:'成员五',kind:'member',active:true},{id:'member-6',name:'成员六',kind:'member',active:true},{id:'member-7',name:'成员七',kind:'member',active:true},{id:'member-8',name:'成员八',kind:'member',active:true},{id:'member-9',name:'成员九',kind:'member',active:true});
assert.throws(()=>vm.runInContext('normalizeSettings(settingsInput)',context),/不能超过 8 个/);

context.breakdownRecords=[
  {spendingType:'fixed',amountCents:40000},{spendingType:'flexible',amountCents:30000},{spendingType:'discretionary',amountCents:20000},{spendingType:'exceptional',amountCents:10000},
];
const breakdown=vm.runInContext('spendingTypeBreakdown(breakdownRecords)',context);
assert.equal(breakdown.totalCents,100000);
assert.equal(breakdown.baselineCents,70000);
assert.equal(breakdown.adjustableCents,20000);
context.noteRecords=[
  {date:'2026-07-01',note:'叮咚',amountCents:1200},
  {date:'2026-07-02',note:'叮咚买菜',amountCents:800},
  {date:'2026-07-03',note:'交通电车充电',amountCents:300},
  {date:'2026-07-04',note:'',amountCents:500},
];
const noteBreakdown=vm.runInContext('spendingNoteBreakdown(noteRecords,3)',context);
assert.deepEqual(Array.from(noteBreakdown.items, item=>item.label),['叮咚买菜','未填写备注','电车充电']);
assert.equal(noteBreakdown.items[0].count,2);
assert.equal(noteBreakdown.items[0].amountCents,2000);
const quality=vm.runInContext("monthRecordQuality('2026-07',noteRecords,['2026-07-05','2026-07-06'])",context);
assert.equal(quality.monthDays,31);
assert.equal(quality.spendDays,4);
assert.equal(quality.confirmedNoSpendDays,2);
assert.equal(quality.coveredDays,6);
assert.equal(quality.emptyNoteCount,1);
assert.equal(quality.emptyNoteCents,500);
assert.deepEqual({...vm.runInContext("monthProgress('2026-07','2026-07-15')",context)},{monthDays:31,elapsedDays:15,elapsedPercent:15/31*100});
context.ordinarySamples=[
  {spendingType:'fixed',projectId:''},
  {spendingType:'exceptional',projectId:''},
  {spendingType:'flexible',projectId:'trip'},
];
assert.deepEqual(vm.runInContext('ordinarySamples.map(isOrdinarySpending)',context),[true,false,false]);

context.forecastRecords=[];
for(const [month,fixed,flexible,optional] of [['2026-04',40000,30000,10000],['2026-05',42000,50000,20000],['2026-06',41000,40000,30000]]){
  context.forecastRecords.push({date:`${month}-02`,spendingType:'fixed',amountCents:fixed,projectId:''},{date:`${month}-03`,spendingType:'flexible',amountCents:flexible,projectId:''},{date:`${month}-04`,spendingType:'discretionary',amountCents:optional,projectId:''},{date:`${month}-05`,spendingType:'exceptional',amountCents:999999,projectId:''},{date:`${month}-06`,spendingType:'fixed',amountCents:888888,projectId:'trip'});
}
context.forecastProjects=[{id:'next-trip',status:'active',startDate:'2026-08-01',budgetCents:200000}];
const forecast=vm.runInContext('spendingForecast(forecastRecords,forecastProjects,"2026-07-22")',context);
assert.equal(forecast.ready,true);
assert.equal(forecast.typical.fixed,41000);
assert.equal(forecast.typical.flexible,40000);
assert.equal(forecast.typical.discretionary,20000);
assert.equal(forecast.normalCents,101000);
assert.equal(forecast.projectBudgetCents,200000);

context.projectList=[
  {id:'travel-old',name:'旧旅行',type:'travel',budgetCents:160000,startDate:'2025-01-01',endDate:'2025-01-02',people:2,status:'completed',updatedAt:'2025-01-03T00:00:00.000Z'},
  {id:'travel-reference',name:'杭州旅行',type:'travel',budgetCents:220000,startDate:'2026-05-01',endDate:'2026-05-03',people:4,status:'completed',updatedAt:'2026-05-04T00:00:00.000Z'},
  {id:'travel-empty',name:'空旅行',type:'travel',budgetCents:300000,startDate:'2026-06-01',endDate:'2026-06-03',people:3,status:'completed',updatedAt:'2026-06-04T00:00:00.000Z'},
  {id:'travel-active',name:'进行中旅行',type:'travel',budgetCents:400000,startDate:'2026-07-01',endDate:'2026-07-03',people:4,status:'active',updatedAt:'2026-07-04T00:00:00.000Z'},
];
context.projectRecords=[
  {projectId:'travel-old',spendingType:'exceptional',amountCents:120000},
  {projectId:'travel-reference',spendingType:'exceptional',amountCents:120000},
  {projectId:'travel-reference',spendingType:'flexible',amountCents:80000},
  {projectId:'travel-active',spendingType:'exceptional',amountCents:500000},
];
const projectReference=vm.runInContext('recentProjectReference("travel",projectList,projectRecords)',context);
assert.equal(projectReference.project.id,'travel-reference');
assert.equal(projectReference.metrics.actualCents,200000);
assert.equal(projectReference.metrics.perPersonCents,50000);
assert.equal(projectReference.metrics.perPersonDayCents,16667);
assert.equal(projectReference.topSpendingType.name,'专项突发');
assert.equal(projectReference.topSpendingType.amountCents,120000);
assert.equal(vm.runInContext('recentProjectReference("renovation",projectList,projectRecords)',context),null);

context.beneficiaryRecords=[
  {beneficiaryId:'family',amountCents:10000},
  {beneficiaryId:'wife',amountCents:20000},
  {beneficiaryId:'family',amountCents:5000},
];
const beneficiarySummary=vm.runInContext('beneficiaryBreakdown(beneficiaryRecords,backupInput.settings.beneficiaries)',context);
assert.equal(beneficiarySummary.totalCents,35000);
assert.equal(beneficiarySummary.items.map(item=>item.id).join(','),'wife,family');
assert.equal(beneficiarySummary.items[1].percent.toFixed(1),'42.9');

context.quickSceneRecords=[
  {spendingType:'flexible',beneficiaryId:'family',projectId:'',note:'买菜',date:'2026-07-19',updatedAt:'2026-07-19T10:00:00.000Z'},
  {spendingType:'discretionary',beneficiaryId:'wife',projectId:'',note:'奶茶',date:'2026-07-18',updatedAt:'2026-07-18T10:00:00.000Z'},
  {spendingType:'discretionary',beneficiaryId:'wife',projectId:'',note:'奶茶',date:'2026-07-17',updatedAt:'2026-07-17T10:00:00.000Z'},
  {spendingType:'discretionary',beneficiaryId:'husband',projectId:'',note:'电影',date:'2026-07-16',updatedAt:'2026-07-16T10:00:00.000Z'},
  {spendingType:'discretionary',beneficiaryId:'husband',projectId:'',note:'电影',date:'2026-07-15',updatedAt:'2026-07-15T10:00:00.000Z'},
  {spendingType:'discretionary',beneficiaryId:'husband',projectId:'',note:'电影',date:'2026-07-14',updatedAt:'2026-07-14T10:00:00.000Z'},
];
const scenes=vm.runInContext('quickRecordScenes(quickSceneRecords,1)',context);
assert.equal(scenes.length,3);
assert.equal(scenes[0].spendingType,'flexible');
assert.equal(scenes[1].beneficiaryId,'husband');
assert.equal(scenes[1].count,3);
assert.equal(scenes[2].count,2);
context.quickScenes=scenes;
const wifeScenes=vm.runInContext("rankQuickRecordScenes(quickScenes,'', 'wife','')",context);
assert.equal(wifeScenes[0].note,'奶茶');
assert.equal(wifeScenes[0].count,2);
const searchedScenes=vm.runInContext("rankQuickRecordScenes(quickScenes,'奶', 'family','')",context);
assert.equal(searchedScenes.length,1);
assert.equal(searchedScenes[0].note,'奶茶');
assert.equal(vm.runInContext("rankQuickRecordScenes(quickScenes,'不存在', 'family','').length",context),0);
context.longRecordNote='  这是一个用于验证备注长度和连续空格规范化的测试内容，超过四十个字符也不能破坏记录  ';
assert.equal(vm.runInContext("normalizeRecord({...backupInput.records.records[0],note:longRecordNote},backupInput.settings,backupInput.plans).note.length",context),40);
assert.equal(vm.runInContext("normalizeRecord({...backupInput.records.records[0],note:'工作   午餐'},backupInput.settings,backupInput.plans).note",context),'工作 午餐');

console.log('schema v5 converter, storage and decision validation passed');
