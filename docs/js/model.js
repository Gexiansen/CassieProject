/* ============ schema v5 数据定义 ============ */
const SPENDING_TYPES={
  fixed:{name:'固定必需',shortName:'固定',color:'#6366f1',description:'稳定且短期难以减少',examples:'房租、保险、固定订阅'},
  flexible:{name:'弹性必需',shortName:'弹性',color:'#22c55e',description:'必须发生但可以优化',examples:'买菜、餐饮、交通、充电'},
  discretionary:{name:'可选消费',shortName:'可选',color:'#f59e0b',description:'可以取消、推迟或降低',examples:'奶茶、玩具、非必要购物'},
  exceptional:{name:'专项突发',shortName:'专项',color:'#ef4444',description:'不进入普通月份基线',examples:'突发维修、急诊、临时大额支出'},
};
const SPENDING_TYPE_IDS=Object.keys(SPENDING_TYPES);
const NOTE_ALIAS_GROUPS=[
  {label:'叮咚买菜',aliases:['叮咚','叮咚买菜']},
  {label:'电车充电',aliases:['电车充电','交通电车充电']},
];
const NOTE_ALIAS_LOOKUP=new Map(NOTE_ALIAS_GROUPS.flatMap(group=>group.aliases.map(alias=>[alias.toLocaleLowerCase('zh-CN'),group.label])));
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
function noteAnalysisLabel(value){
  const note=String(value||'').trim().replace(/\s+/g,' ');if(!note)return '未填写备注';
  return NOTE_ALIAS_LOOKUP.get(note.toLocaleLowerCase('zh-CN'))||note;
}
function noteSuggestions(records,query='',limit=3){
  const normalizedQuery=normalizeQuickQuery(query),groups=new Map();
  records.forEach(record=>{const note=String(record.note||'').trim().replace(/\s+/g,' '),normalized=normalizeQuickQuery(note);if(!normalized||normalizedQuery&&!normalized.includes(normalizedQuery))return;const existing=groups.get(normalized)||{note,count:0,latest:''};existing.count++;existing.latest=existing.latest>String(record.updatedAt||'')?existing.latest:String(record.updatedAt||'');groups.set(normalized,existing);});
  const items=[...groups.values()].sort((a,b)=>{const am=normalizeQuickQuery(a.note)===normalizedQuery?3:normalizeQuickQuery(a.note).startsWith(normalizedQuery)?2:1,bm=normalizeQuickQuery(b.note)===normalizedQuery?3:normalizeQuickQuery(b.note).startsWith(normalizedQuery)?2:1;return bm-am||b.count-a.count||b.latest.localeCompare(a.latest)||a.note.localeCompare(b.note,'zh-CN');});
  return items.slice(0,Math.max(0,Number.isInteger(limit)?limit:3));
}
function spendingNoteBreakdown(records,limit=3){
  const groups=new Map();records.forEach(record=>{const label=noteAnalysisLabel(record.note),existing=groups.get(label)||{label,count:0,amountCents:0};existing.count++;existing.amountCents+=record.amountCents;groups.set(label,existing);});
  const totalCents=records.reduce((sum,record)=>sum+record.amountCents,0),items=[...groups.values()].sort((a,b)=>b.amountCents-a.amountCents||b.count-a.count||a.label.localeCompare(b.label,'zh-CN'));
  return {totalCents,items:items.slice(0,Math.max(0,limit)).map(item=>({...item,percent:totalCents?item.amountCents/totalCents*100:0}))};
}
function monthDayCount(value){const[y,m]=String(value).split('-').map(Number);return Number.isInteger(y)&&Number.isInteger(m)&&m>=1&&m<=12?new Date(y,m,0).getDate():0;}
function monthRecordQuality(value,records,noSpendDates=[],baseDate=''){
  const monthDays=monthDayCount(value),progress=baseDate?monthProgress(value,baseDate):{elapsedDays:monthDays},base=String(baseDate||'').slice(0,10),baseMonth=base.slice(0,7),inReviewWindow=date=>!base||value<baseMonth||(value===baseMonth&&date<=base),monthRecords=records.filter(record=>record.date.slice(0,7)===value&&inReviewWindow(record.date)),reviewableDays=base?progress.elapsedDays:monthDays,spendDates=new Set(monthRecords.map(record=>record.date)),confirmedNoSpendDates=[...new Set(noSpendDates)].filter(date=>date.slice(0,7)===value&&inReviewWindow(date)&&!spendDates.has(date)),coveredDays=new Set([...spendDates,...confirmedNoSpendDates]).size,emptyNoteRecords=monthRecords.filter(record=>!String(record.note||'').trim()),missingDays=Math.max(0,reviewableDays-coveredDays),futureDays=Math.max(0,monthDays-reviewableDays);
  return {recordCount:monthRecords.length,expenseCents:monthRecords.reduce((sum,record)=>sum+record.amountCents,0),monthDays,elapsedDays:reviewableDays,reviewableDays,futureDays,missingDays,spendDays:spendDates.size,confirmedNoSpendDays:confirmedNoSpendDates.length,coveredDays,coveragePercent:reviewableDays?coveredDays/reviewableDays*100:0,emptyNoteCount:emptyNoteRecords.length,emptyNoteCents:emptyNoteRecords.reduce((sum,record)=>sum+record.amountCents,0),topDrivers:spendingNoteBreakdown(monthRecords,3).items};
}
function monthProgress(value,baseDate){
  const monthDays=monthDayCount(value),base=String(baseDate||'').slice(0,10),baseMonth=base.slice(0,7),elapsedDays=value<baseMonth?monthDays:value>baseMonth?0:Math.min(monthDays,Math.max(0,Number(base.slice(8,10))||0));
  return {monthDays,elapsedDays,elapsedPercent:monthDays?elapsedDays/monthDays*100:0};
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
function projectDateApplies(project,date){return !!(project&&project.status==='active'&&typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&project.startDate<=date&&date<=project.endDate);}
function resolveAutoProject(projects=[],currentProjectId='',date=''){
  const candidates=(Array.isArray(projects)?projects:[]).filter(project=>projectDateApplies(project,date)),candidateIds=candidates.map(project=>project.id),current=candidates.find(project=>project.id===currentProjectId);
  if(current)return {projectId:current.id,reason:'current',candidateIds};
  if(candidates.length===1)return {projectId:candidates[0].id,reason:'single',candidateIds};
  return {projectId:'',reason:candidates.length?'ambiguous':'none',candidateIds};
}
function normalizeQuickQuery(value){return String(value||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('zh-CN');}
function rankQuickRecordScenes(scenes,query='',beneficiaryId='',projectId=''){
  const normalized=normalizeQuickQuery(query),matchLevel=scene=>{const note=normalizeQuickQuery(scene.note);if(!normalized)return 0;if(note===normalized)return 3;if(note.startsWith(normalized))return 2;return note.includes(normalized)?1:0;};
  return scenes.filter(scene=>!normalized||matchLevel(scene)>0).sort((a,b)=>{
    if(normalized){const matchDiff=matchLevel(b)-matchLevel(a);if(matchDiff)return matchDiff;}
    const relevance=scene=>(scene.beneficiaryId===beneficiaryId?4:0)+((scene.projectId||'')===(projectId||'')?2:0)+(scene.count>1?3:0),relevanceDiff=relevance(b)-relevance(a);
    return relevanceDiff||b.count-a.count||b.latest.localeCompare(a.latest)||normalizeQuickQuery(a.note).localeCompare(normalizeQuickQuery(b.note),'zh-CN');
  });
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
