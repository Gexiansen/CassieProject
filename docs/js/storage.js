const SCHEMA_VERSION=3;
const BACKUP_VERSION=3;
const PREFS_SCHEMA_VERSION=2;
const DECISIONS_SCHEMA_VERSION=1;
const KEY='myBudgetBook_v2';
const LEGACY_KEY='myBudgetBook_v1';
const META_KEY='myBudgetBook_meta_v1';
const PREFS_KEY='myBudgetBook_prefs_v1';
const DECISIONS_KEY='myBudgetBook_decisions_v1';
let recoveryRaw='',recoveryError='',recoveryDownloaded=false;

function uuid(){
  if(globalThis.crypto&&typeof globalThis.crypto.randomUUID==='function')return globalThis.crypto.randomUUID();
  const bytes=new Uint8Array(16);
  if(globalThis.crypto&&typeof globalThis.crypto.getRandomValues==='function')globalThis.crypto.getRandomValues(bytes);
  else for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=[...bytes].map(b=>b.toString(16).padStart(2,'0'));
  return `${hex.slice(0,4).join('')}-${hex.slice(4,6).join('')}-${hex.slice(6,8).join('')}-${hex.slice(8,10).join('')}-${hex.slice(10).join('')}`;
}
function validDate(s){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
  const[y,m,d]=s.split('-').map(Number),dt=new Date(y,m-1,d);
  return dt.getFullYear()===y&&dt.getMonth()===m-1&&dt.getDate()===d;
}
function normalizeRecord(raw,expenseCats=EXPENSE_CATS){
  if(!raw||typeof raw!=='object')throw new Error('记录不是对象');
  const type=raw.type;
  if(type!=='expense'&&type!=='income')throw new Error('收支类型无效');
  const cats=type==='income'?INCOME_CATS:expenseCats;
  if(!cats[raw.cat]||!Object.prototype.hasOwnProperty.call(cats[raw.cat].subs,raw.sub))throw new Error('分类无效');
  const date=String(raw.date||'');
  if(!validDate(date))throw new Error('日期无效');
  let amountCents;
  if(Number.isInteger(raw.amountCents))amountCents=raw.amountCents;
  else if(Number.isFinite(Number(raw.amount)))amountCents=Math.round(Number(raw.amount)*100);
  if(!Number.isSafeInteger(amountCents)||amountCents<=0)throw new Error('金额无效');
  const nowIso=new Date().toISOString();
  const safeId=typeof raw.id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(raw.id)?raw.id:Number.isSafeInteger(raw.id)&&raw.id>=0?`legacy-${raw.id}`:uuid();
  const createdAt=typeof raw.createdAt==='string'&&Number.isFinite(Date.parse(raw.createdAt))?new Date(raw.createdAt).toISOString():nowIso;
  const updatedAt=typeof raw.updatedAt==='string'&&Number.isFinite(Date.parse(raw.updatedAt))?new Date(raw.updatedAt).toISOString():createdAt;
  const beneficiaryId=type==='expense'&&BENEFICIARY_IDS.includes(raw.beneficiaryId)?raw.beneficiaryId:type==='expense'?'unassigned':'';
  return {id:safeId,type,date,cat:raw.cat,sub:raw.sub,amountCents,
    note:typeof raw.note==='string'?raw.note.trim().slice(0,20):'',tag:type==='expense'&&typeof raw.tag==='string'?raw.tag.trim().slice(0,12):'',projectId:type==='expense'&&validId(raw.projectId)?raw.projectId:'',
    beneficiaryId,
    createdAt,updatedAt};
}
function normalizeRecords(input,expenseCats=EXPENSE_CATS){
  if(!Array.isArray(input))throw new Error('账本记录不是数组');
  const records=[],errors=[],ids=new Set();
  input.forEach((raw,index)=>{try{const record=normalizeRecord(raw,expenseCats);if(ids.has(record.id))record.id=uuid();ids.add(record.id);records.push(record);}catch(error){errors.push(`第 ${index+1} 条：${error.message}`);}});
  return {records,errors};
}
function envelope(records,forExport=false){
  const data={schemaVersion:SCHEMA_VERSION,records};
  return forExport?{...data,appName:'CassieProject',exportedAt:new Date().toISOString(),recordCount:records.length}:data;
}
function backupEnvelope(records,preferences,decisionData){return {appName:'CassieProject',backupVersion:BACKUP_VERSION,schemaVersion:SCHEMA_VERSION,exportedAt:new Date().toISOString(),recordCount:records.length,records,preferences,decisions:decisionData};}
function readStoredData(){
  let raw='';
  try{
    const current=localStorage.getItem(KEY);
    if(current){raw=current;const parsed=JSON.parse(current);if(!parsed||![2,SCHEMA_VERSION].includes(parsed.schemaVersion))throw new Error('数据版本不受支持');const result=normalizeRecords(parsed.records);if(result.errors.length){recoveryRaw=current;recoveryError=`${result.errors.length} 条记录校验失败`;return {records:result.records,notice:'发现异常记录，保存功能已暂停',locked:true};}if(parsed.schemaVersion!==SCHEMA_VERSION)localStorage.setItem(KEY,JSON.stringify(envelope(result.records)));return {records:result.records,notice:parsed.schemaVersion===SCHEMA_VERSION?'':'旧版数据已升级',locked:false};}
    const legacy=localStorage.getItem(LEGACY_KEY);
    if(legacy){raw=legacy;const result=normalizeRecords(JSON.parse(legacy));if(result.errors.length)throw new Error(result.errors[0]);localStorage.setItem(KEY,JSON.stringify(envelope(result.records)));return {records:result.records,notice:'旧版数据已升级',locked:false};}
  }catch(error){recoveryRaw=raw;recoveryError=error.message;return {records:[],notice:'账本数据读取异常，原始内容已保留',locked:true};}
  return {records:[],notice:'',locked:false};
}
function persist(records,force=false){
  if(storageLocked&&!force){toast('请先处理数据救援，再继续记账');return false;}
  try{localStorage.setItem(KEY,JSON.stringify(envelope(records)));return true;}
  catch(error){toast('保存失败：'+error.message);return false;}
}
function persistFullRestore(records,preferences,decisionData=null,force=false){
  if(storageLocked&&!force){toast('请先处理数据救援，再继续记账');return false;}
  let oldRecords=null,oldPreferences=null,oldDecisions=null;
  try{
    oldRecords=localStorage.getItem(KEY);oldPreferences=localStorage.getItem(PREFS_KEY);oldDecisions=localStorage.getItem(DECISIONS_KEY);
    localStorage.setItem(KEY,JSON.stringify(envelope(records)));
    localStorage.setItem(PREFS_KEY,JSON.stringify(preferences));
    if(decisionData)localStorage.setItem(DECISIONS_KEY,JSON.stringify(decisionData));
    return true;
  }catch(error){
    try{
      if(oldRecords===null)localStorage.removeItem(KEY);else localStorage.setItem(KEY,oldRecords);
      if(oldPreferences===null)localStorage.removeItem(PREFS_KEY);else localStorage.setItem(PREFS_KEY,oldPreferences);
      if(oldDecisions===null)localStorage.removeItem(DECISIONS_KEY);else localStorage.setItem(DECISIONS_KEY,oldDecisions);
    }catch(rollbackError){toast('完整恢复失败，且本地回滚未完成，请保留自动下载的恢复前备份');return false;}
    toast('完整恢复失败：'+error.message);return false;
  }
}
function readBackupMeta(){try{const raw=localStorage.getItem(META_KEY);return raw?JSON.parse(raw):{};}catch(error){return {};}}
function validChoice(type,cat,sub,expenseCats=EXPENSE_CATS){
  const cats=type==='income'?INCOME_CATS:expenseCats;
  return !!(cats[cat]&&Object.prototype.hasOwnProperty.call(cats[cat].subs,sub));
}
function normalizeCategoryConfig(source){
  const fallback=defaultCategoryConfig();if(!Array.isArray(source))return {categories:fallback,ignored:source===undefined?0:1};
  const categories=[],groupIds=new Set();let ignored=0;
  source.slice(0,30).forEach((raw,index)=>{
    if(!raw||typeof raw!=='object'||!validId(raw.id)||groupIds.has(raw.id)){ignored++;return;}
    const name=typeof raw.name==='string'?raw.name.trim().slice(0,12):'',inputSubs=Array.isArray(raw.subs)?raw.subs:[];if(!name||!inputSubs.length){ignored++;return;}
    const subs=[],subIds=new Set();inputSubs.slice(0,60).forEach(sub=>{
      if(!sub||typeof sub!=='object'||!validId(sub.id)||subIds.has(sub.id)){ignored++;return;}
      const subName=typeof sub.name==='string'?sub.name.trim().slice(0,12):'';if(!subName){ignored++;return;}
      const roles=Array.isArray(sub.roles)?BENEFICIARY_IDS.filter(role=>sub.roles.includes(role)):[...BENEFICIARY_IDS];
      subs.push({id:sub.id,name:subName,active:sub.active!==false,roles:roles.length?roles:[...BENEFICIARY_IDS]});subIds.add(sub.id);
    });
    if(!subs.length){ignored++;return;}groupIds.add(raw.id);categories.push({id:raw.id,name,color:/^#[0-9a-fA-F]{6}$/.test(raw.color||'')?raw.color:CATEGORY_COLORS[index%CATEGORY_COLORS.length],active:raw.active!==false,subs});
  });
  if(!categories.length)return {categories:fallback,ignored:ignored+1};
  if(source.length>30)ignored+=source.length-30;return {categories,ignored};
}
function defaultPrefs(){return {schemaVersion:PREFS_SCHEMA_VERSION,updatedAt:'',recent:{expense:null,income:null},favorites:{expense:[],income:[]},templates:[],categories:defaultCategoryConfig()};}
function normalizePrefs(source){
  const preferences=defaultPrefs();let ignored=0;
  if(!source||typeof source!=='object'||source.schemaVersion!==undefined&&![1,PREFS_SCHEMA_VERSION].includes(source.schemaVersion))return {preferences,ignored:1,supported:false};
  const normalizedCategories=normalizeCategoryConfig(source.categories);preferences.categories=normalizedCategories.categories;ignored+=normalizedCategories.ignored;const expenseCats=categoryMap(preferences.categories);
  preferences.updatedAt=typeof source.updatedAt==='string'&&Number.isFinite(Date.parse(source.updatedAt))?new Date(source.updatedAt).toISOString():'';
  ['expense','income'].forEach(type=>{
    const recent=source.recent&&source.recent[type];
    if(recent&&validChoice(type,recent.cat,recent.sub,expenseCats))preferences.recent[type]={cat:recent.cat,sub:recent.sub,beneficiaryId:BENEFICIARY_IDS.includes(recent.beneficiaryId)?recent.beneficiaryId:'',projectId:validId(recent.projectId)?recent.projectId:''};
    else if(recent)ignored++;
    const values=source.favorites&&Array.isArray(source.favorites[type])?source.favorites[type]:[];
    values.forEach(value=>{const[cat,sub]=String(value).split('/'),safe=`${cat}/${sub}`;if(validChoice(type,cat,sub,expenseCats)&&!preferences.favorites[type].includes(safe)&&preferences.favorites[type].length<8)preferences.favorites[type].push(safe);else ignored++;});
  });
  const templates=Array.isArray(source.templates)?source.templates:[];
  templates.forEach(item=>{
    if(preferences.templates.length>=12){ignored++;return;}
    if(!item||typeof item!=='object'||typeof item.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(item.id)||!validChoice(item.type,item.cat,item.sub,expenseCats)){ignored++;return;}
    preferences.templates.push({id:item.id,name:String(item.name||'常用模板').trim().slice(0,20)||'常用模板',type:item.type,cat:item.cat,sub:item.sub,
      amountCents:Number.isSafeInteger(item.amountCents)&&item.amountCents>0?item.amountCents:null,
      note:typeof item.note==='string'?item.note.trim().slice(0,20):'',tag:item.type==='expense'&&typeof item.tag==='string'?item.tag.trim().slice(0,12):''});
  });
  return {preferences,ignored,supported:true};
}
function readPrefs(){
  try{
    const raw=localStorage.getItem(PREFS_KEY);return raw?normalizePrefs(JSON.parse(raw)).preferences:defaultPrefs();
  }catch(error){return defaultPrefs();}
}
function savePrefs(){try{prefs.schemaVersion=PREFS_SCHEMA_VERSION;prefs.updatedAt=new Date().toISOString();localStorage.setItem(PREFS_KEY,JSON.stringify(prefs));EXPENSE_CATS=categoryMap(prefs.categories);return true;}catch(error){toast('快捷设置保存失败：'+error.message);return false;}}
function hasCustomCategories(preferences=prefs){return JSON.stringify(preferences.categories)!==JSON.stringify(defaultCategoryConfig());}
function hasPreferenceData(preferences=prefs){return !!(preferences.recent.expense||preferences.recent.income||preferences.favorites.expense.length||preferences.favorites.income.length||preferences.templates.length||hasCustomCategories(preferences));}
function validYearMonth(value){if(!/^\d{4}-\d{2}$/.test(value))return false;const[y,m]=value.split('-').map(Number);return y>=2000&&y<=2100&&m>=1&&m<=12;}
function validId(value){return typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value);}
function validIso(value){return typeof value==='string'&&Number.isFinite(Date.parse(value));}
function defaultDecisions(){return {schemaVersion:DECISIONS_SCHEMA_VERSION,updatedAt:'',budgets:{},goals:[],reviews:{},projects:[],currentProjectId:'',noSpendDates:[]};}
function normalizeDecisions(source,expenseCats=EXPENSE_CATS){
  const decisionData=defaultDecisions();let ignored=0;
  if(!source||typeof source!=='object'||source.schemaVersion!==DECISIONS_SCHEMA_VERSION)return {decisionData,ignored:1,supported:false};
  decisionData.updatedAt=typeof source.updatedAt==='string'&&Number.isFinite(Date.parse(source.updatedAt))?new Date(source.updatedAt).toISOString():'';
  const budgets=source.budgets&&typeof source.budgets==='object'?source.budgets:{};
  Object.entries(budgets).forEach(([month,value])=>{
    if(!validYearMonth(month)||!value||typeof value!=='object'){ignored++;return;}
    const totalCents=Number.isSafeInteger(value.totalCents)&&value.totalCents>0?value.totalCents:null,availableCents=Number.isSafeInteger(value.availableCents)&&value.availableCents>0?value.availableCents:null,categories={};
    if(value.totalCents!==null&&value.totalCents!==undefined&&totalCents===null)ignored++;
    if(value.availableCents!==null&&value.availableCents!==undefined&&availableCents===null)ignored++;
    const rawCategories=value.categories&&typeof value.categories==='object'?value.categories:{};
    Object.entries(rawCategories).forEach(([cat,amount])=>{if(expenseCats[cat]&&Number.isSafeInteger(amount)&&amount>0)categories[cat]=amount;else ignored++;});
    if(totalCents!==null||availableCents!==null||Object.keys(categories).length)decisionData.budgets[month]={totalCents,availableCents,categories,updatedAt:typeof value.updatedAt==='string'&&Number.isFinite(Date.parse(value.updatedAt))?new Date(value.updatedAt).toISOString():''};
    else ignored++;
  });
  const goalIds=new Set();
  (Array.isArray(source.goals)?source.goals:[]).slice(0,30).forEach(raw=>{
    if(!raw||typeof raw!=='object'||!validId(raw.id)||goalIds.has(raw.id)||!GOAL_TYPES[raw.type]||!GOAL_STATUSES[raw.status]||!Number.isSafeInteger(raw.targetCents)||raw.targetCents<=0||!validDate(String(raw.targetDate||''))){ignored++;return;}
    const name=typeof raw.name==='string'?raw.name.trim().slice(0,20):'';if(!name){ignored++;return;}
    goalIds.add(raw.id);const contributionIds=new Set(),contributions=[];
    (Array.isArray(raw.contributions)?raw.contributions:[]).slice(0,500).forEach(item=>{
      if(!item||typeof item!=='object'||!validId(item.id)||contributionIds.has(item.id)||!validDate(String(item.date||''))||!Number.isSafeInteger(item.amountCents)||item.amountCents<=0){ignored++;return;}
      contributionIds.add(item.id);contributions.push({id:item.id,date:item.date,amountCents:item.amountCents,note:typeof item.note==='string'?item.note.trim().slice(0,20):'',createdAt:validIso(item.createdAt)?new Date(item.createdAt).toISOString():''});
    });
    decisionData.goals.push({id:raw.id,name,type:raw.type,targetCents:raw.targetCents,targetDate:raw.targetDate,status:raw.status,contributions,
      createdAt:validIso(raw.createdAt)?new Date(raw.createdAt).toISOString():'',updatedAt:validIso(raw.updatedAt)?new Date(raw.updatedAt).toISOString():''});
  });
  if(Array.isArray(source.goals)&&source.goals.length>30)ignored+=source.goals.length-30;
  const reviews=source.reviews&&typeof source.reviews==='object'?source.reviews:{};
  Object.entries(reviews).forEach(([month,raw])=>{
    if(!validYearMonth(month)||!raw||typeof raw!=='object'){ignored++;return;}
    const actionIds=new Set(),actions=[];
    (Array.isArray(raw.actions)?raw.actions:[]).slice(0,3).forEach(item=>{
      if(!item||typeof item!=='object'||!validId(item.id)||actionIds.has(item.id)){ignored++;return;}
      const text=typeof item.text==='string'?item.text.trim().slice(0,40):'';if(!text){ignored++;return;}
      actionIds.add(item.id);actions.push({id:item.id,text,done:item.done===true,createdAt:validIso(item.createdAt)?new Date(item.createdAt).toISOString():'',completedAt:item.done===true&&validIso(item.completedAt)?new Date(item.completedAt).toISOString():''});
    });
    if(Array.isArray(raw.actions)&&raw.actions.length>3)ignored+=raw.actions.length-3;
    const highlight=typeof raw.highlight==='string'?raw.highlight.trim().slice(0,120):'',adjustment=typeof raw.adjustment==='string'?raw.adjustment.trim().slice(0,120):'';
    if(highlight||adjustment||actions.length)decisionData.reviews[month]={highlight,adjustment,actions,updatedAt:validIso(raw.updatedAt)?new Date(raw.updatedAt).toISOString():''};else ignored++;
  });
  const projectIds=new Set();
  (Array.isArray(source.projects)?source.projects:[]).slice(0,30).forEach(raw=>{
    if(!raw||typeof raw!=='object'||!validId(raw.id)||projectIds.has(raw.id)||!PROJECT_TYPES[raw.type]||!PROJECT_STATUSES[raw.status]||!validDate(String(raw.startDate||''))||!validDate(String(raw.endDate||''))||raw.startDate>raw.endDate){ignored++;return;}
    const name=typeof raw.name==='string'?raw.name.trim().slice(0,20):'',budgetCents=Number.isSafeInteger(raw.budgetCents)&&raw.budgetCents>=0?raw.budgetCents:null,people=raw.type==='travel'&&Number.isInteger(raw.people)&&raw.people>=1&&raw.people<=20?raw.people:null;if(!name||budgetCents===null){ignored++;return;}
    projectIds.add(raw.id);decisionData.projects.push({id:raw.id,name,type:raw.type,budgetCents,startDate:raw.startDate,endDate:raw.endDate,people,status:raw.status,createdAt:validIso(raw.createdAt)?new Date(raw.createdAt).toISOString():'',updatedAt:validIso(raw.updatedAt)?new Date(raw.updatedAt).toISOString():''});
  });
  if(Array.isArray(source.projects)&&source.projects.length>30)ignored+=source.projects.length-30;
  if(validId(source.currentProjectId)&&decisionData.projects.some(project=>project.id===source.currentProjectId&&project.status==='active'))decisionData.currentProjectId=source.currentProjectId;
  const noSpendDates=new Set();
  (Array.isArray(source.noSpendDates)?source.noSpendDates:[]).slice(0,5000).forEach(value=>{const date=String(value||'');if(validDate(date)&&!noSpendDates.has(date))noSpendDates.add(date);else ignored++;});
  if(Array.isArray(source.noSpendDates)&&source.noSpendDates.length>5000)ignored+=source.noSpendDates.length-5000;
  decisionData.noSpendDates=[...noSpendDates].sort();
  return {decisionData,ignored,supported:true};
}
function readDecisions(){try{const raw=localStorage.getItem(DECISIONS_KEY);return raw?normalizeDecisions(JSON.parse(raw)).decisionData:defaultDecisions();}catch(error){return defaultDecisions();}}
function saveDecisions(){if(storageLocked){toast('请先处理数据救援，再调整规划');return false;}try{decisions.schemaVersion=DECISIONS_SCHEMA_VERSION;decisions.updatedAt=new Date().toISOString();localStorage.setItem(DECISIONS_KEY,JSON.stringify(decisions));return true;}catch(error){toast('规划数据保存失败：'+error.message);return false;}}
function hasDecisionData(decisionData=decisions){return Object.keys(decisionData.budgets).length>0||decisionData.goals.length>0||Object.keys(decisionData.reviews).length>0||decisionData.projects.length>0||decisionData.noSpendDates.length>0;}
function backupStatus(){
  const hasSettings=hasPreferenceData(),hasPlans=hasDecisionData();
  if(!state.records.length&&!hasSettings&&!hasPlans)return {warn:false,text:'数据只保存在当前浏览器。开始记账后请定期导出 JSON 备份。'};
  if(!backupMeta.lastBackupAt)return {warn:true,text:`当前有 ${state.records.length} 笔记录${hasSettings||hasPlans?'和配置数据':''}尚未备份，建议现在导出。`};
  const days=Math.max(0,Math.floor((Date.now()-Date.parse(backupMeta.lastBackupAt))/86400000));
  const added=Math.max(0,state.records.length-(backupMeta.recordCount||0)),settingsChanged=!!prefs.updatedAt&&prefs.updatedAt!==backupMeta.prefsUpdatedAt,plansChanged=!!decisions.updatedAt&&decisions.updatedAt!==backupMeta.decisionsUpdatedAt,warn=days>=14||added>=30||settingsChanged||plansChanged;
  const date=new Date(backupMeta.lastBackupAt).toLocaleDateString('zh-CN');
  return {warn,text:`上次完整备份：${date}${added?`，之后新增 ${added} 笔`:''}${settingsChanged?'，快捷设置有变更':''}${plansChanged?'，规划数据有变更':''}${warn?'，建议重新导出。':'。'}`};
}
