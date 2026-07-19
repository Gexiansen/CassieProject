#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const SCHEMA_VERSION=4;
const BENEFICIARIES=[
  {id:'family',name:'共同',kind:'shared',active:true},
  {id:'wife',name:'妻子',kind:'member',active:true},
  {id:'husband',name:'丈夫',kind:'member',active:true},
  {id:'son',name:'儿子',kind:'member',active:true},
];
const BENEFICIARY_IDS=new Set(BENEFICIARIES.map(item=>item.id));
const CATEGORY_DEFINITIONS=[
  ['food','食品生鲜','#22c55e',[['vegetable','买菜'],['meat','买肉'],['fruit','水果'],['snack','零食'],['drink','饮料']]],
  ['shopping','购物','#6366f1',[['daily','日用品'],['clothes','衣服'],['sports','运动器材'],['digital','数码电器']]],
  ['kids','育儿','#fb7185',[['toy','玩具'],['kclothes','衣服'],['shoes','鞋子'],['bedding','床品'],['study','学习文具'],['kother','其他']]],
  ['dining','餐饮外食','#f59e0b',[['restaurant','堂食'],['takeout','外卖']]],
  ['transport','交通出行','#0ea5e9',[['transit','公共交通'],['taxi','打车'],['fuel','加油'],['charging','车辆充电'],['ticket','车票机票']]],
  ['living','居住生活','#8b5cf6',[['rent','房租'],['utility','水电燃气'],['hotel','住宿酒店']]],
  ['entertainment','休闲娱乐','#ec4899',[['movie','影音游戏'],['scenic','景点门票'],['fitness','健身']]],
  ['health','医疗健康','#ef4444',[['medicine','药品'],['checkup','体检医疗']]],
  ['social','人情往来','#f97316',[['gift','礼物红包']]],
];
const PROJECT_TYPES=new Set(['travel','renovation','festival','medical','education','moving','other']);
const PROJECT_STATUSES=new Set(['active','completed']);
const GOAL_TYPES=new Set(['emergency','travel','education','debt','other']);
const GOAL_STATUSES=new Set(['active','paused','completed']);

function validId(value){return typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value);}
function validDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const parts=value.split('-').map(Number),date=new Date(parts[0],parts[1]-1,parts[2]);return date.getFullYear()===parts[0]&&date.getMonth()===parts[1]-1&&date.getDate()===parts[2];}
function validMonth(value){return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);}
function validIso(value){return typeof value==='string'&&Number.isFinite(Date.parse(value));}
function cleanText(value,max){return typeof value==='string'?value.trim().slice(0,max):'';}
function stableItemId(groupId,subId,used){
  const known=groupId+'-'+subId;
  if(validId(known)&&!used.has(known))return known;
  const hashed='item-'+createHash('sha256').update(groupId+'/'+subId).digest('hex').slice(0,32);
  if(used.has(hashed))throw new Error('无法生成唯一分类 ID：'+groupId+'/'+subId);
  return hashed;
}
function defaultCategories(){
  const ids=[...BENEFICIARY_IDS];
  return CATEGORY_DEFINITIONS.map(([id,name,color,subs])=>({id,name,color,active:true,items:subs.map(([subId,subName])=>({id:id+'-'+subId,name:subName,active:true,beneficiaryIds:[...ids]}))}));
}
function convertCategories(preferences,report){
  const source=preferences&&Array.isArray(preferences.categories)?preferences.categories:null;
  if(!source)return defaultCategories();
  const used=new Set(),groups=[],groupIds=new Set();
  source.forEach((raw,index)=>{
    if(!raw||!validId(raw.id)||groupIds.has(raw.id)||!cleanText(raw.name,12)||!Array.isArray(raw.subs)||!raw.subs.length){report.invalidCategories.push('第 '+(index+1)+' 个大类');return;}
    const items=[];raw.subs.forEach(sub=>{
      if(!sub||!validId(sub.id)||!cleanText(sub.name,12)){report.invalidCategories.push(raw.id+'/'+String(sub&&sub.id));return;}
      const id=stableItemId(raw.id,sub.id,used),roles=Array.isArray(sub.roles)?[...new Set(sub.roles.filter(role=>BENEFICIARY_IDS.has(role)))]:[...BENEFICIARY_IDS];
      if(!roles.length){report.invalidCategories.push(raw.id+'/'+sub.id+'：没有有效成员');return;}
      used.add(id);items.push({id,name:cleanText(sub.name,12),active:sub.active!==false,beneficiaryIds:roles});
    });
    if(items.length){groupIds.add(raw.id);groups.push({id:raw.id,name:cleanText(raw.name,12),color:/^#[0-9a-fA-F]{6}$/.test(raw.color||'')?raw.color:CATEGORY_DEFINITIONS[index%CATEGORY_DEFINITIONS.length][2],active:raw.active!==false,items});}
  });
  return groups;
}
function buildCategoryLookup(categories,preferences){
  const lookup=new Map();
  if(preferences&&Array.isArray(preferences.categories)){
    preferences.categories.forEach(group=>{
      const converted=categories.find(item=>item.id===group.id);
      if(!converted)return;
      group.subs.forEach((sub,index)=>{if(converted.items[index])lookup.set(group.id+'/'+sub.id,converted.items[index].id);});
    });
  }else CATEGORY_DEFINITIONS.forEach(([groupId,,,subs])=>subs.forEach(([subId])=>lookup.set(groupId+'/'+subId,groupId+'-'+subId)));
  return lookup;
}
function convertProjects(source,report){
  const projects=[],ids=new Set();
  (Array.isArray(source)?source:[]).forEach(raw=>{
    const travelPeople=raw&&raw.type==='travel'&&Number.isInteger(raw.people)&&raw.people>=1&&raw.people<=20;
    if(!raw||!validId(raw.id)||ids.has(raw.id)||!PROJECT_TYPES.has(raw.type)||!PROJECT_STATUSES.has(raw.status)||!validDate(String(raw.startDate||''))||!validDate(String(raw.endDate||''))||raw.startDate>raw.endDate||!cleanText(raw.name,20)||!Number.isSafeInteger(raw.budgetCents)||raw.budgetCents<0||raw.type==='travel'&&!travelPeople){report.invalidProjects.push(raw&&raw.id||'未知专项');return;}
    ids.add(raw.id);projects.push({id:raw.id,name:cleanText(raw.name,20),type:raw.type,budgetCents:raw.budgetCents,startDate:raw.startDate,endDate:raw.endDate,people:raw.type==='travel'?raw.people:null,status:raw.status,createdAt:validIso(raw.createdAt)?new Date(raw.createdAt).toISOString():'',updatedAt:validIso(raw.updatedAt)?new Date(raw.updatedAt).toISOString():''});
  });
  return projects;
}
function convertGoals(source,report){
  const goals=[],ids=new Set();
  (Array.isArray(source)?source:[]).forEach(raw=>{
    if(!raw||!validId(raw.id)||ids.has(raw.id)||!GOAL_TYPES.has(raw.type)||!GOAL_STATUSES.has(raw.status)||!validDate(String(raw.targetDate||''))||!Number.isSafeInteger(raw.targetCents)||raw.targetCents<=0||!cleanText(raw.name,20)){report.invalidGoals.push(raw&&raw.id||'未知目标');return;}
    const contributionIds=new Set(),contributions=[];let invalid=false;
    (Array.isArray(raw.contributions)?raw.contributions:[]).forEach(item=>{
      if(!item||!validId(item.id)||contributionIds.has(item.id)||!validDate(String(item.date||''))||!Number.isSafeInteger(item.amountCents)||item.amountCents<=0){invalid=true;return;}
      contributionIds.add(item.id);contributions.push({id:item.id,date:item.date,amountCents:item.amountCents,note:cleanText(item.note,20),createdAt:validIso(item.createdAt)?new Date(item.createdAt).toISOString():''});
    });
    if(invalid){report.invalidGoals.push(raw.id+'：投入记录无效');return;}
    ids.add(raw.id);goals.push({id:raw.id,name:cleanText(raw.name,20),type:raw.type,targetCents:raw.targetCents,targetDate:raw.targetDate,status:raw.status,contributions,createdAt:validIso(raw.createdAt)?new Date(raw.createdAt).toISOString():'',updatedAt:validIso(raw.updatedAt)?new Date(raw.updatedAt).toISOString():''});
  });
  return goals;
}
function convertPlans(source,report){
  const raw=source&&typeof source==='object'?source:{},budgets={};
  Object.entries(raw.budgets&&typeof raw.budgets==='object'?raw.budgets:{}).forEach(([month,value])=>{
    if(!validMonth(month)||!value||typeof value!=='object'){report.invalidPlans.push('预算 '+month);return;}
    const totalCents=Number.isSafeInteger(value.totalCents)&&value.totalCents>0?value.totalCents:null,availableCents=Number.isSafeInteger(value.availableCents)&&value.availableCents>0?value.availableCents:null;
    if(totalCents!==null||availableCents!==null)budgets[month]={totalCents,availableCents,updatedAt:validIso(value.updatedAt)?new Date(value.updatedAt).toISOString():''};
  });
  const projects=convertProjects(raw.projects,report),projectIds=new Set(projects.map(item=>item.id)),goals=convertGoals(raw.goals,report),reviews={};
  Object.entries(raw.reviews&&typeof raw.reviews==='object'?raw.reviews:{}).forEach(([month,value])=>{
    if(!validMonth(month)||!value||typeof value!=='object'){report.invalidPlans.push('月结 '+month);return;}
    const first=Array.isArray(value.actions)?value.actions[0]:null,highlight=cleanText(value.highlight,120);let action=null;
    if(first&&validId(first.id)&&cleanText(first.text,40))action={id:first.id,text:cleanText(first.text,40),done:first.done===true,createdAt:validIso(first.createdAt)?new Date(first.createdAt).toISOString():'',completedAt:first.done===true&&validIso(first.completedAt)?new Date(first.completedAt).toISOString():''};
    if(highlight||action)reviews[month]={highlight,action,updatedAt:validIso(value.updatedAt)?new Date(value.updatedAt).toISOString():''};
  });
  const noSpendDates=[...new Set((Array.isArray(raw.noSpendDates)?raw.noSpendDates:[]).map(String).filter(validDate))].sort();
  const currentProjectId=validId(raw.currentProjectId)&&projects.some(item=>item.id===raw.currentProjectId&&item.status==='active')?raw.currentProjectId:'';
  return {schemaVersion:SCHEMA_VERSION,updatedAt:validIso(raw.updatedAt)?new Date(raw.updatedAt).toISOString():'',budgets,projects,currentProjectId,goals,reviews,noSpendDates,projectIds};
}
export function convertBackup(source,{unassignedBeneficiaryId=''}={}){
  if(!source||typeof source!=='object')throw new Error('输入不是 JSON 对象');
  const rawRecords=Array.isArray(source)?source:source.records;
  if(!Array.isArray(rawRecords))throw new Error('输入中没有 records 数组');
  const preferences=source.preferences&&typeof source.preferences==='object'?source.preferences:null,decisions=source.decisions&&typeof source.decisions==='object'?source.decisions:null;
  const report={originalRecordCount:rawRecords.length,expenseCount:0,excludedIncomeCount:0,expenseCents:0,outputExpenseCents:0,dateRange:[],unmappedCategories:[],unmappedBeneficiaries:[],invalidProjects:[],invalidGoals:[],invalidPlans:[],invalidCategories:[],legacyTagCount:0};
  const categories=convertCategories(preferences,report),categoryIds=buildCategoryLookup(categories,preferences),plans=convertPlans(decisions,report),records=[],dates=[];
  rawRecords.forEach((raw,index)=>{
    if(raw&&raw.type==='income'){report.excludedIncomeCount++;return;}
    if(!raw||raw.type!=='expense'){report.invalidPlans.push('第 '+(index+1)+' 条记录类型无效');return;}
    report.expenseCount++;if(Number.isSafeInteger(raw.amountCents)&&raw.amountCents>0)report.expenseCents+=raw.amountCents;
    const categoryId=categoryIds.get(raw.cat+'/'+raw.sub);if(!categoryId){report.unmappedCategories.push(raw.cat+'/'+raw.sub);return;}
    let beneficiaryId=raw.beneficiaryId;
    if(!beneficiaryId||beneficiaryId==='unassigned')beneficiaryId=unassignedBeneficiaryId;
    if(!BENEFICIARY_IDS.has(beneficiaryId)){report.unmappedBeneficiaries.push(raw.id||'第 '+(index+1)+' 条');return;}
    const projectId=raw.projectId||'';if(projectId&&!plans.projectIds.has(projectId)){report.invalidProjects.push('记录 '+(raw.id||index+1)+' 引用 '+projectId);return;}
    if(!validId(raw.id)||!validDate(String(raw.date||''))||!Number.isSafeInteger(raw.amountCents)||raw.amountCents<=0||!validIso(raw.createdAt)||!validIso(raw.updatedAt)){report.invalidPlans.push('第 '+(index+1)+' 条记录字段无效');return;}
    if(cleanText(raw.tag,12))report.legacyTagCount++;
    const record={id:raw.id,date:raw.date,amountCents:raw.amountCents,categoryId,beneficiaryId,projectId,note:cleanText(raw.note,20),createdAt:new Date(raw.createdAt).toISOString(),updatedAt:new Date(raw.updatedAt).toISOString()};
    records.push(record);dates.push(record.date);
  });
  report.unmappedCategories=[...new Set(report.unmappedCategories)];report.unmappedBeneficiaries=[...new Set(report.unmappedBeneficiaries)];report.invalidProjects=[...new Set(report.invalidProjects)];
  report.outputExpenseCents=records.reduce((sum,item)=>sum+item.amountCents,0);dates.sort();report.dateRange=dates.length?[dates[0],dates[dates.length-1]]:[];
  const errors=[report.unmappedCategories,report.unmappedBeneficiaries,report.invalidProjects,report.invalidGoals,report.invalidPlans,report.invalidCategories].reduce((sum,items)=>sum+items.length,0);
  if(report.expenseCents!==report.outputExpenseCents)report.invalidPlans.push('转换前后支出总额不一致');
  const exportedAt=new Date().toISOString(),settings={schemaVersion:SCHEMA_VERSION,updatedAt:validIso(preferences&&preferences.updatedAt)?new Date(preferences.updatedAt).toISOString():'',defaultBeneficiaryId:'family',beneficiaries:BENEFICIARIES.map(item=>({...item})),categories};
  delete plans.projectIds;
  const backup={appName:'CassieProject',backupVersion:SCHEMA_VERSION,schemaVersion:SCHEMA_VERSION,exportedAt,summary:{recordCount:records.length,expenseCents:report.outputExpenseCents},records:{schemaVersion:SCHEMA_VERSION,updatedAt:exportedAt,records},settings,plans};
  return {backup,report,ok:errors===0&&report.expenseCents===report.outputExpenseCents};
}
function usage(){return '用法：node tools/convert-v3-to-v4.mjs <旧备份.json> <v4备份.json> [--unassigned family|wife|husband|son]';}
async function main(){
  const args=process.argv.slice(2),input=args[0],output=args[1],flag=args.indexOf('--unassigned'),unassignedBeneficiaryId=flag>=0?args[flag+1]:'';
  if(!input||!output){console.error(usage());process.exitCode=1;return;}
  if(existsSync(output)){console.error('输出文件已存在，未覆盖：'+output);process.exitCode=1;return;}
  try{
    const source=JSON.parse(await readFile(input,'utf8')),result=convertBackup(source,{unassignedBeneficiaryId});
    console.log(JSON.stringify(result.report,null,2));
    if(!result.ok){console.error('转换未生成文件：请处理报告中的未映射或无效项。');process.exitCode=1;return;}
    await writeFile(output,JSON.stringify(result.backup,null,2)+'\n','utf8');console.log('已生成 v4 完整备份：'+output);
  }catch(error){console.error('转换失败：'+error.message);process.exitCode=1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
