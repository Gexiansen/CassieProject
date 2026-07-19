const SCHEMA_VERSION=4;
const BACKUP_VERSION=4;
const RECORDS_KEY='cassie_records_v4';
const SETTINGS_KEY='cassie_settings_v4';
const PLANS_KEY='cassie_plans_v4';
const META_KEY='cassie_backup_meta_v4';
const LEGACY_KEYS=['myBudgetBook_v2','myBudgetBook_v1','myBudgetBook_meta_v1','myBudgetBook_prefs_v1','myBudgetBook_decisions_v1'];
let recoveryRaw='',recoveryError='',recoveryDownloaded=false,storageReadError='';

function uuid(){
  if(globalThis.crypto&&typeof globalThis.crypto.randomUUID==='function')return globalThis.crypto.randomUUID();
  const bytes=new Uint8Array(16);
  if(globalThis.crypto&&typeof globalThis.crypto.getRandomValues==='function')globalThis.crypto.getRandomValues(bytes);
  else for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=[...bytes].map(b=>b.toString(16).padStart(2,'0'));
  return hex.slice(0,4).join('')+'-'+hex.slice(4,6).join('')+'-'+hex.slice(6,8).join('')+'-'+hex.slice(8,10).join('')+'-'+hex.slice(10).join('');
}
function validDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const parts=value.split('-').map(Number),date=new Date(parts[0],parts[1]-1,parts[2]);
  return date.getFullYear()===parts[0]&&date.getMonth()===parts[1]-1&&date.getDate()===parts[2];
}
function validYearMonth(value){if(!/^\d{4}-\d{2}$/.test(value))return false;const parts=value.split('-').map(Number);return parts[0]>=2000&&parts[0]<=2100&&parts[1]>=1&&parts[1]<=12;}
function validId(value){return typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value);}
function validIso(value){return typeof value==='string'&&Number.isFinite(Date.parse(value));}
function cleanText(value,max){return typeof value==='string'?value.trim().slice(0,max):'';}
function captureReadError(label,raw,error){storageReadError=label+'读取异常：'+error.message;recoveryRaw+=(recoveryRaw?'\n\n':'')+'【'+label+'】\n'+raw;recoveryError=storageReadError;}

function defaultSettings(){return {schemaVersion:SCHEMA_VERSION,updatedAt:'',defaultBeneficiaryId:'family',beneficiaries:defaultBeneficiaries(),categories:defaultCategoryConfig()};}
function normalizeSettings(source){
  if(!source||typeof source!=='object'||source.schemaVersion!==SCHEMA_VERSION)throw new Error('设置版本不受支持');
  const beneficiaries=[],beneficiaryIds=new Set(),names=new Set();
  if(!Array.isArray(source.beneficiaries)||!source.beneficiaries.length)throw new Error('获益方不能为空');
  source.beneficiaries.forEach(raw=>{
    if(!raw||!validId(raw.id)||beneficiaryIds.has(raw.id))throw new Error('获益方 ID 无效或重复');
    const name=cleanText(raw.name,6);if(!name||names.has(name))throw new Error('获益方名称无效或重复');
    const kind=raw.id==='family'?'shared':'member';
    if(raw.id==='family'&&(raw.kind!=='shared'||raw.active===false))throw new Error('共同获益方不能停用');
    beneficiaries.push({id:raw.id,name,kind,active:raw.id==='family'?true:raw.active!==false});beneficiaryIds.add(raw.id);names.add(name);
  });
  if(!beneficiaryIds.has('family'))throw new Error('缺少共同获益方');
  if(beneficiaries.filter(item=>item.active).length>8)throw new Error('启用的获益方不能超过 8 个');
  if(!Array.isArray(source.categories)||!source.categories.length)throw new Error('分类不能为空');
  const categories=[],groupIds=new Set(),itemIds=new Set();
  source.categories.forEach((raw,index)=>{
    if(!raw||!validId(raw.id)||groupIds.has(raw.id))throw new Error('大类 ID 无效或重复');
    const name=cleanText(raw.name,12);if(!name||!Array.isArray(raw.items)||!raw.items.length)throw new Error('大类名称或细分类无效');
    const items=[];raw.items.forEach(item=>{
      if(!item||!validId(item.id)||itemIds.has(item.id))throw new Error('细分类 ID 无效或不唯一');
      const itemName=cleanText(item.name,12);if(!itemName)throw new Error('细分类名称无效');
      const ids=Array.isArray(item.beneficiaryIds)?[...new Set(item.beneficiaryIds)]:[];
      if(!ids.length||ids.some(id=>!beneficiaryIds.has(id)))throw new Error('细分类获益方引用无效');
      items.push({id:item.id,name:itemName,active:item.active!==false,beneficiaryIds:ids});itemIds.add(item.id);
    });
    categories.push({id:raw.id,name,color:/^#[0-9a-fA-F]{6}$/.test(raw.color||'')?raw.color:CATEGORY_COLORS[index%CATEGORY_COLORS.length],active:raw.active!==false,items});groupIds.add(raw.id);
  });
  const defaultBeneficiaryId=beneficiaries.some(item=>item.id===source.defaultBeneficiaryId&&item.active)?source.defaultBeneficiaryId:'family';
  return {schemaVersion:SCHEMA_VERSION,updatedAt:validIso(source.updatedAt)?new Date(source.updatedAt).toISOString():'',defaultBeneficiaryId,beneficiaries,categories};
}
function readSettings(){
  const raw=localStorage.getItem(SETTINGS_KEY);if(!raw)return defaultSettings();
  try{return normalizeSettings(JSON.parse(raw));}catch(error){captureReadError('设置数据',raw,error);return defaultSettings();}
}
function saveSettings(){
  if(storageLocked){toast('请先处理数据救援，再调整设置');return false;}
  try{prefs.schemaVersion=SCHEMA_VERSION;prefs.updatedAt=new Date().toISOString();const normalized=normalizeSettings(prefs);Object.assign(prefs,normalized);localStorage.setItem(SETTINGS_KEY,JSON.stringify(prefs));refreshDerivedSettings(prefs);return true;}
  catch(error){toast('设置保存失败：'+error.message);return false;}
}

function defaultPlans(){return {schemaVersion:SCHEMA_VERSION,updatedAt:'',budgets:{},projects:[],currentProjectId:'',goals:[],reviews:{},noSpendDates:[]};}
function normalizePlans(source){
  if(!source||typeof source!=='object'||source.schemaVersion!==SCHEMA_VERSION)throw new Error('规划版本不受支持');
  const plans=defaultPlans();plans.updatedAt=validIso(source.updatedAt)?new Date(source.updatedAt).toISOString():'';
  const budgets=source.budgets&&typeof source.budgets==='object'?source.budgets:{};
  Object.entries(budgets).forEach(([month,raw])=>{
    if(!validYearMonth(month)||!raw||typeof raw!=='object')throw new Error('月度预算无效');
    const totalCents=raw.totalCents===null||raw.totalCents===undefined?null:raw.totalCents,availableCents=raw.availableCents===null||raw.availableCents===undefined?null:raw.availableCents;
    if(totalCents!==null&&(!Number.isSafeInteger(totalCents)||totalCents<=0))throw new Error('日常预算金额无效');
    if(availableCents!==null&&(!Number.isSafeInteger(availableCents)||availableCents<=0))throw new Error('可支配金额无效');
    if(totalCents!==null||availableCents!==null)plans.budgets[month]={totalCents,availableCents,updatedAt:validIso(raw.updatedAt)?new Date(raw.updatedAt).toISOString():''};
  });
  const projectIds=new Set();
  (Array.isArray(source.projects)?source.projects:[]).forEach(raw=>{
    if(!raw||!validId(raw.id)||projectIds.has(raw.id)||!PROJECT_TYPES[raw.type]||!PROJECT_STATUSES[raw.status]||!validDate(String(raw.startDate||''))||!validDate(String(raw.endDate||''))||raw.startDate>raw.endDate)throw new Error('专项数据无效');
    const name=cleanText(raw.name,20),budgetCents=raw.budgetCents;if(!name||!Number.isSafeInteger(budgetCents)||budgetCents<0)throw new Error('专项名称或预算无效');
    const people=raw.type==='travel'&&Number.isInteger(raw.people)&&raw.people>=1&&raw.people<=20?raw.people:null;
    if(raw.type==='travel'&&people===null)throw new Error('旅行人数无效');
    plans.projects.push({id:raw.id,name,type:raw.type,budgetCents,startDate:raw.startDate,endDate:raw.endDate,people,status:raw.status,createdAt:validIso(raw.createdAt)?new Date(raw.createdAt).toISOString():'',updatedAt:validIso(raw.updatedAt)?new Date(raw.updatedAt).toISOString():''});projectIds.add(raw.id);
  });
  if(validId(source.currentProjectId)&&plans.projects.some(item=>item.id===source.currentProjectId&&item.status==='active'))plans.currentProjectId=source.currentProjectId;
  const goalIds=new Set();
  (Array.isArray(source.goals)?source.goals:[]).forEach(raw=>{
    if(!raw||!validId(raw.id)||goalIds.has(raw.id)||!GOAL_TYPES[raw.type]||!GOAL_STATUSES[raw.status]||!Number.isSafeInteger(raw.targetCents)||raw.targetCents<=0||!validDate(String(raw.targetDate||'')))throw new Error('目标数据无效');
    const name=cleanText(raw.name,20);if(!name)throw new Error('目标名称无效');
    const contributionIds=new Set(),contributions=[];
    (Array.isArray(raw.contributions)?raw.contributions:[]).forEach(item=>{
      if(!item||!validId(item.id)||contributionIds.has(item.id)||!validDate(String(item.date||''))||!Number.isSafeInteger(item.amountCents)||item.amountCents<=0)throw new Error('目标投入无效');
      contributions.push({id:item.id,date:item.date,amountCents:item.amountCents,note:cleanText(item.note,20),createdAt:validIso(item.createdAt)?new Date(item.createdAt).toISOString():''});contributionIds.add(item.id);
    });
    plans.goals.push({id:raw.id,name,type:raw.type,targetCents:raw.targetCents,targetDate:raw.targetDate,status:raw.status,contributions,createdAt:validIso(raw.createdAt)?new Date(raw.createdAt).toISOString():'',updatedAt:validIso(raw.updatedAt)?new Date(raw.updatedAt).toISOString():''});goalIds.add(raw.id);
  });
  const reviews=source.reviews&&typeof source.reviews==='object'?source.reviews:{};
  Object.entries(reviews).forEach(([month,raw])=>{
    if(!validYearMonth(month)||!raw||typeof raw!=='object')throw new Error('月结数据无效');
    let action=null;
    if(raw.action!==null&&raw.action!==undefined){
      const item=raw.action;if(!item||!validId(item.id)||!cleanText(item.text,40))throw new Error('月结行动无效');
      action={id:item.id,text:cleanText(item.text,40),done:item.done===true,createdAt:validIso(item.createdAt)?new Date(item.createdAt).toISOString():'',completedAt:item.done===true&&validIso(item.completedAt)?new Date(item.completedAt).toISOString():''};
    }
    const highlight=cleanText(raw.highlight,120);if(highlight||action)plans.reviews[month]={highlight,action,updatedAt:validIso(raw.updatedAt)?new Date(raw.updatedAt).toISOString():''};
  });
  const noSpendDates=new Set();
  (Array.isArray(source.noSpendDates)?source.noSpendDates:[]).forEach(value=>{if(!validDate(String(value||'')))throw new Error('无支出日期无效');noSpendDates.add(String(value));});
  plans.noSpendDates=[...noSpendDates].sort();
  return plans;
}
function readPlans(){
  const raw=localStorage.getItem(PLANS_KEY);if(!raw)return defaultPlans();
  try{return normalizePlans(JSON.parse(raw));}catch(error){captureReadError('规划数据',raw,error);return defaultPlans();}
}
function saveDecisions(){
  if(storageLocked){toast('请先处理数据救援，再调整规划');return false;}
  try{decisions.schemaVersion=SCHEMA_VERSION;decisions.updatedAt=new Date().toISOString();const normalized=normalizePlans(decisions);Object.assign(decisions,normalized);localStorage.setItem(PLANS_KEY,JSON.stringify(decisions));return true;}
  catch(error){toast('规划数据保存失败：'+error.message);return false;}
}

function normalizeRecord(raw,settings=prefs,plans=decisions){
  if(!raw||typeof raw!=='object')throw new Error('记录不是对象');
  if(!validId(raw.id))throw new Error('记录 ID 无效');
  const date=String(raw.date||'');if(!validDate(date))throw new Error('日期无效');
  if(!Number.isSafeInteger(raw.amountCents)||raw.amountCents<=0)throw new Error('金额无效');
  const categories=categoryMap(settings.categories).items;if(!categories[raw.categoryId])throw new Error('分类引用无效');
  if(!settings.beneficiaries.some(item=>item.id===raw.beneficiaryId))throw new Error('获益方引用无效');
  const projectId=raw.projectId||'';if(projectId&&!plans.projects.some(item=>item.id===projectId))throw new Error('专项引用无效');
  const createdAt=validIso(raw.createdAt)?new Date(raw.createdAt).toISOString():'';if(!createdAt)throw new Error('创建时间无效');
  const updatedAt=validIso(raw.updatedAt)?new Date(raw.updatedAt).toISOString():'';if(!updatedAt)throw new Error('更新时间无效');
  return {id:raw.id,date,amountCents:raw.amountCents,categoryId:raw.categoryId,beneficiaryId:raw.beneficiaryId,projectId,note:cleanText(raw.note,20),createdAt,updatedAt};
}
function normalizeRecords(input,settings=prefs,plans=decisions){
  if(!Array.isArray(input))throw new Error('账本记录不是数组');
  const records=[],errors=[],ids=new Set();
  input.forEach((raw,index)=>{try{const record=normalizeRecord(raw,settings,plans);if(ids.has(record.id))throw new Error('记录 ID 重复');ids.add(record.id);records.push(record);}catch(error){errors.push('第 '+(index+1)+' 条：'+error.message);}});
  return {records,errors};
}
function recordsEnvelope(records){return {schemaVersion:SCHEMA_VERSION,updatedAt:new Date().toISOString(),records};}
function hasLegacyData(){return LEGACY_KEYS.some(key=>localStorage.getItem(key)!==null);}
function readStoredData(settings=prefs,plans=decisions){
  const raw=localStorage.getItem(RECORDS_KEY);
  if(!raw)return {records:[],notice:storageReadError,locked:!!storageReadError,needsUpgrade:hasLegacyData()};
  try{
    const parsed=JSON.parse(raw);if(!parsed||parsed.schemaVersion!==SCHEMA_VERSION)throw new Error('账目版本不受支持');
    const result=normalizeRecords(parsed.records,settings,plans);
    if(result.errors.length){captureReadError('账目数据',raw,new Error(result.errors[0]));return {records:result.records,notice:'发现异常记录，保存功能已暂停',locked:true,needsUpgrade:false};}
    return {records:result.records,notice:storageReadError,locked:!!storageReadError,needsUpgrade:false};
  }catch(error){captureReadError('账目数据',raw,error);return {records:[],notice:'账本数据读取异常，原始内容已保留',locked:true,needsUpgrade:false};}
}
function persist(records,force=false){
  if(storageLocked&&!force){toast('请先处理数据救援，再继续记账');return false;}
  try{localStorage.setItem(RECORDS_KEY,JSON.stringify(recordsEnvelope(records)));return true;}catch(error){toast('保存失败：'+error.message);return false;}
}
function persistFullRestore(records,settings,plans,force=false){
  if(storageLocked&&!force){toast('请先处理数据救援，再继续记账');return false;}
  const previous={records:localStorage.getItem(RECORDS_KEY),settings:localStorage.getItem(SETTINGS_KEY),plans:localStorage.getItem(PLANS_KEY)};
  try{
    localStorage.setItem(RECORDS_KEY,JSON.stringify(recordsEnvelope(records)));
    localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));
    localStorage.setItem(PLANS_KEY,JSON.stringify(plans));
    return true;
  }catch(error){
    try{[[RECORDS_KEY,previous.records],[SETTINGS_KEY,previous.settings],[PLANS_KEY,previous.plans]].forEach(([key,value])=>{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);});}
    catch(rollbackError){toast('完整恢复失败，且本地回滚未完成，请保留恢复前备份');return false;}
    toast('完整恢复失败：'+error.message);return false;
  }
}
function readBackupMeta(){try{const raw=localStorage.getItem(META_KEY);return raw?JSON.parse(raw):{};}catch(error){return {};}}
function backupEnvelope(records,settings,plans){return {appName:'CassieProject',backupVersion:BACKUP_VERSION,schemaVersion:SCHEMA_VERSION,exportedAt:new Date().toISOString(),summary:{recordCount:records.length,expenseCents:records.reduce((sum,item)=>sum+item.amountCents,0)},records:recordsEnvelope(records),settings,plans};}
function hasCustomSettings(settings=prefs){const comparable={...settings,updatedAt:''};return JSON.stringify(comparable)!==JSON.stringify(defaultSettings());}
function hasDecisionData(planData=decisions){return Object.keys(planData.budgets).length>0||planData.goals.length>0||Object.keys(planData.reviews).length>0||planData.projects.length>0||planData.noSpendDates.length>0;}
function backupStatus(){
  const hasSettings=hasCustomSettings(),hasPlans=hasDecisionData();
  if(!state.records.length&&!hasSettings&&!hasPlans)return {warn:false,text:'数据只保存在当前浏览器。开始记账后请定期导出 JSON 备份。'};
  if(!backupMeta.lastBackupAt)return {warn:true,text:'当前有 '+state.records.length+' 笔记录'+(hasSettings||hasPlans?'和配置数据':'')+'尚未备份，建议现在导出。'};
  const days=Math.max(0,Math.floor((Date.now()-Date.parse(backupMeta.lastBackupAt))/86400000));
  const added=Math.max(0,state.records.length-(backupMeta.recordCount||0)),settingsChanged=!!prefs.updatedAt&&prefs.updatedAt!==backupMeta.settingsUpdatedAt,plansChanged=!!decisions.updatedAt&&decisions.updatedAt!==backupMeta.plansUpdatedAt,warn=days>=14||added>=30||settingsChanged||plansChanged;
  const date=new Date(backupMeta.lastBackupAt).toLocaleDateString('zh-CN');
  return {warn,text:'上次完整备份：'+date+(added?'，之后新增 '+added+' 笔':'')+(settingsChanged?'，家庭或分类设置有变更':'')+(plansChanged?'，规划数据有变更':'')+(warn?'，建议重新导出。':'。')};
}
