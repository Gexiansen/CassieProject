/* ============ schema v5 数据定义 ============ */
const SPENDING_TYPES={
  fixed:{name:'固定必需',shortName:'固定',color:'#6366f1',description:'稳定且短期难以减少'},
  flexible:{name:'弹性必需',shortName:'弹性',color:'#22c55e',description:'必须发生但可以优化'},
  discretionary:{name:'可选消费',shortName:'可选',color:'#f59e0b',description:'可以取消、推迟或降低'},
  exceptional:{name:'专项突发',shortName:'专项',color:'#ef4444',description:'不进入普通月份基线'},
};
const SPENDING_TYPE_IDS=Object.keys(SPENDING_TYPES);
const DEFAULT_BENEFICIARIES=[
  {id:'family',name:'共同',kind:'shared',active:true},
  {id:'wife',name:'妻子',kind:'member',active:true},
  {id:'husband',name:'丈夫',kind:'member',active:true},
  {id:'son',name:'儿子',kind:'member',active:true},
];
function defaultBeneficiaries(){return DEFAULT_BENEFICIARIES.map(item=>({...item}));}
let BENEFICIARIES={};
let BENEFICIARY_IDS=[];
function refreshDerivedSettings(settings){BENEFICIARIES=Object.fromEntries(settings.beneficiaries.map(item=>[item.id,item.name]));BENEFICIARY_IDS=settings.beneficiaries.map(item=>item.id);}
const GOAL_TYPES={emergency:{name:'应急储备',emoji:'🛟'},travel:{name:'旅行计划',emoji:'✈️'},education:{name:'教育成长',emoji:'🎓'},debt:{name:'偿还债务',emoji:'🧾'},other:{name:'其他目标',emoji:'🎯'}};
const GOAL_STATUSES={active:'进行中',paused:'已暂停',completed:'已完成'};
const PROJECT_TYPES={travel:{name:'旅行',emoji:'✈️'},renovation:{name:'装修',emoji:'🛠️'},festival:{name:'节日',emoji:'🧧'},medical:{name:'医疗',emoji:'🏥'},education:{name:'教育',emoji:'🎓'},moving:{name:'搬家',emoji:'📦'},other:{name:'其他',emoji:'🧳'}};
const PROJECT_STATUSES={active:'进行中',completed:'已完成'};
const getSpendingType=id=>SPENDING_TYPES[id]||null;
const fmt=cents=>(Number(cents)/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
function calendarAmountLabel(cents){
  const yuan=Number(cents)/100;
  if(yuan>=10000)return`${(yuan/10000).toFixed(1).replace(/\.0$/,'')}万`;
  if(yuan>=1000)return`${(yuan/1000).toFixed(1).replace(/\.0$/,'')}k`;
  const decimals=cents%100===0?0:2,text=yuan.toFixed(decimals);
  return decimals?text.replace(/0$/,''):text;
}
function calendarDayTotals(records,year,month){
  const totals={},prefix=`${year}-${String(month+1).padStart(2,'0')}-`;
  records.forEach(record=>{if(record.date.startsWith(prefix))totals[record.date]=(totals[record.date]||0)+record.amountCents;});
  return totals;
}
function beneficiaryBreakdown(records,beneficiaries){
  const totals={};records.forEach(record=>{totals[record.beneficiaryId]=(totals[record.beneficiaryId]||0)+record.amountCents;});
  const totalCents=Object.values(totals).reduce((sum,value)=>sum+value,0);
  const items=beneficiaries.map((beneficiary,index)=>({id:beneficiary.id,name:beneficiary.name,amountCents:totals[beneficiary.id]||0,order:index})).filter(item=>item.amountCents>0).sort((a,b)=>b.amountCents-a.amountCents||a.order-b.order).map(({order,...item})=>({...item,percent:totalCents?item.amountCents/totalCents*100:0}));
  return {totalCents,items};
}
function spendingTypeBreakdown(records){
  const totals=Object.fromEntries(SPENDING_TYPE_IDS.map(id=>[id,0]));
  records.forEach(record=>{if(totals[record.spendingType]!==undefined)totals[record.spendingType]+=record.amountCents;});
  const totalCents=Object.values(totals).reduce((sum,value)=>sum+value,0),items=SPENDING_TYPE_IDS.map(id=>({id,...SPENDING_TYPES[id],amountCents:totals[id],percent:totalCents?totals[id]/totalCents*100:0}));
  return {totalCents,baselineCents:totals.fixed+totals.flexible,adjustableCents:totals.discretionary,totals,items};
}
function isOrdinarySpending(record){return !record.projectId&&record.spendingType!=='exceptional';}
function median(values){if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:Math.round((sorted[middle-1]+sorted[middle])/2);}
function spendingForecast(records,projects=[],baseDate){
  const[y,m]=baseDate.slice(0,7).split('-').map(Number),keys=[];
  for(let index=1;index<=3;index++){const date=new Date(y,m-1-index,1);keys.push(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`);}
  const periods=keys.map(key=>{const items=records.filter(record=>record.date.slice(0,7)===key&&isOrdinarySpending(record)),breakdown=spendingTypeBreakdown(items);return {key,recordCount:items.length,...breakdown};});
  const sampleCount=periods.filter(item=>item.recordCount>0).length,ready=sampleCount===3,typical={fixed:0,flexible:0,discretionary:0};
  if(ready)Object.keys(typical).forEach(id=>{typical[id]=median(periods.map(item=>item.totals[id]));});
  const nextDate=new Date(y,m,1),nextMonth=`${nextDate.getFullYear()}-${String(nextDate.getMonth()+1).padStart(2,'0')}`,projectBudgetCents=projects.filter(project=>project.status==='active'&&project.startDate.slice(0,7)===nextMonth).reduce((sum,project)=>sum+project.budgetCents,0);
  return {keys,periods,sampleCount,ready,nextMonth,typical,baselineCents:typical.fixed+typical.flexible,normalCents:typical.fixed+typical.flexible+typical.discretionary,projectBudgetCents};
}
function quickRecordScenes(records,recentLimit=3){
  const scenes=new Map(),ordered=[...records].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.date.localeCompare(a.date));
  ordered.forEach(record=>{const key=JSON.stringify([record.spendingType,record.beneficiaryId,record.projectId||'',record.note||'']),existing=scenes.get(key);if(existing){existing.count++;return;}scenes.set(key,{key,spendingType:record.spendingType,beneficiaryId:record.beneficiaryId,projectId:record.projectId||'',note:record.note||'',count:1,latest:record.updatedAt});});
  const values=[...scenes.values()],count=Math.max(0,Number.isInteger(recentLimit)?recentLimit:3),recent=values.slice(0,count),recentKeys=new Set(recent.map(item=>item.key));
  const frequent=values.filter(item=>!recentKeys.has(item.key)).sort((a,b)=>b.count-a.count||b.latest.localeCompare(a.latest)||a.key.localeCompare(b.key));
  return [...recent,...frequent].map(({key,...item})=>item);
}
function calculateProjectMetrics(project,records){
  const items=records.filter(record=>record.projectId===project.id),actualCents=items.reduce((sum,item)=>sum+item.amountCents,0),days=Math.max(1,Math.round((new Date(project.endDate)-new Date(project.startDate))/86400000)+1),people=project.people||1;
  return {items,actualCents,remainingCents:project.budgetCents?project.budgetCents-actualCents:null,percent:project.budgetCents?actualCents/project.budgetCents*100:null,days,people,perPersonCents:Math.round(actualCents/people),perPersonDayCents:Math.round(actualCents/people/days)};
}
function projectHistoryReferences(type,projects,records,excludeProjectId='',limit=5){
  const candidates=projects.filter(project=>project.id!==excludeProjectId&&project.type===type&&project.status==='completed').sort((a,b)=>b.endDate.localeCompare(a.endDate)||b.updatedAt.localeCompare(a.updatedAt)),references=[];
  for(const project of candidates){
    const metrics=calculateProjectMetrics(project,records);if(!metrics.items.length)continue;
    const breakdown=spendingTypeBreakdown(metrics.items),top=breakdown.items.filter(item=>item.amountCents>0).sort((a,b)=>b.amountCents-a.amountCents)[0]||null;
    references.push({project,metrics,topSpendingType:top?{id:top.id,name:top.name,amountCents:top.amountCents}:null});if(references.length>=limit)break;
  }
  return references;
}
function recentProjectReference(type,projects,records){return projectHistoryReferences(type,projects,records,'',1)[0]||null;}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
