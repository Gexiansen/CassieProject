/* ============ schema v4 数据定义 ============ */
const CATEGORY_COLORS=['#22c55e','#6366f1','#fb7185','#f59e0b','#0ea5e9','#8b5cf6','#ec4899','#ef4444','#f97316','#14b8a6','#64748b'];
const DEFAULT_BENEFICIARIES=[
  {id:'family',name:'共同',kind:'shared',active:true},
  {id:'wife',name:'妻子',kind:'member',active:true},
  {id:'husband',name:'丈夫',kind:'member',active:true},
  {id:'son',name:'儿子',kind:'member',active:true},
];
const DEFAULT_CATEGORY_GROUPS=[
  ['food','食品生鲜','#22c55e',[['food-vegetable','买菜'],['food-meat','买肉'],['food-fruit','水果'],['food-snack','零食'],['food-drink','饮料']]],
  ['shopping','购物','#6366f1',[['shopping-daily','日用品'],['shopping-clothes','衣服'],['shopping-sports','运动器材'],['shopping-digital','数码电器']]],
  ['kids','育儿','#fb7185',[['kids-toy','玩具'],['kids-clothes','衣服'],['kids-shoes','鞋子'],['kids-bedding','床品'],['kids-study','学习文具'],['kids-other','其他']]],
  ['dining','餐饮外食','#f59e0b',[['dining-restaurant','堂食'],['dining-takeout','外卖']]],
  ['transport','交通出行','#0ea5e9',[['transport-transit','公共交通'],['transport-taxi','打车'],['transport-fuel','加油'],['transport-charging','车辆充电'],['transport-ticket','车票机票']]],
  ['living','居住生活','#8b5cf6',[['living-rent','房租'],['living-utility','水电燃气'],['living-hotel','住宿酒店']]],
  ['entertainment','休闲娱乐','#ec4899',[['entertainment-media','影音游戏'],['entertainment-scenic','景点门票'],['entertainment-fitness','健身']]],
  ['health','医疗健康','#ef4444',[['health-medicine','药品'],['health-checkup','体检医疗']]],
  ['social','人情往来','#f97316',[['social-gift','礼物红包']]],
];
function defaultBeneficiaries(){return DEFAULT_BENEFICIARIES.map(item=>({...item}));}
function defaultCategoryConfig(){const beneficiaryIds=DEFAULT_BENEFICIARIES.map(item=>item.id);return DEFAULT_CATEGORY_GROUPS.map(([id,name,color,items])=>({id,name,color,active:true,items:items.map(([itemId,itemName])=>({id:itemId,name:itemName,active:true,beneficiaryIds:[...beneficiaryIds]}))}));}
function cloneCategoryConfig(config){return JSON.parse(JSON.stringify(config));}
function categoryMap(config){const groups={},items={};config.forEach(group=>{const itemMap={};group.items.forEach(item=>{itemMap[item.id]=item;items[item.id]={...item,groupId:group.id,groupName:group.name,color:group.color,groupActive:group.active!==false};});groups[group.id]={...group,itemMap};});return {groups,items};}
let EXPENSE_CATS={};
let CATEGORY_ITEMS={};
let BENEFICIARIES={};
let BENEFICIARY_IDS=[];
function refreshDerivedSettings(settings){const mapped=categoryMap(settings.categories);EXPENSE_CATS=mapped.groups;CATEGORY_ITEMS=mapped.items;BENEFICIARIES=Object.fromEntries(settings.beneficiaries.map(item=>[item.id,item.name]));BENEFICIARY_IDS=settings.beneficiaries.map(item=>item.id);}
const GOAL_TYPES={emergency:{name:'应急储备',emoji:'🛟'},travel:{name:'旅行计划',emoji:'✈️'},education:{name:'教育成长',emoji:'🎓'},debt:{name:'偿还债务',emoji:'🧾'},other:{name:'其他目标',emoji:'🎯'}};
const GOAL_STATUSES={active:'进行中',paused:'已暂停',completed:'已完成'};
const PROJECT_TYPES={travel:{name:'旅行',emoji:'✈️'},renovation:{name:'装修',emoji:'🛠️'},festival:{name:'节日',emoji:'🧧'},medical:{name:'医疗',emoji:'🏥'},education:{name:'教育',emoji:'🎓'},moving:{name:'搬家',emoji:'📦'},other:{name:'其他',emoji:'🧳'}};
const PROJECT_STATUSES={active:'进行中',completed:'已完成'};
const getCategory=categoryId=>CATEGORY_ITEMS[categoryId]||null;
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
function calculateProjectMetrics(project,records){
  const items=records.filter(record=>record.projectId===project.id),actualCents=items.reduce((sum,item)=>sum+item.amountCents,0),days=Math.max(1,Math.round((new Date(project.endDate)-new Date(project.startDate))/86400000)+1),people=project.people||1;
  return {items,actualCents,remainingCents:project.budgetCents?project.budgetCents-actualCents:null,percent:project.budgetCents?actualCents/project.budgetCents*100:null,days,people,perPersonCents:Math.round(actualCents/people),perPersonDayCents:Math.round(actualCents/people/days)};
}
function projectHistoryReferences(type,projects,records,categories,excludeProjectId='',limit=5){
  const candidates=projects.filter(project=>project.id!==excludeProjectId&&project.type===type&&project.status==='completed').sort((a,b)=>b.endDate.localeCompare(a.endDate)||b.updatedAt.localeCompare(a.updatedAt));
  const categoryItems=categoryMap(categories).items,groupNames=Object.fromEntries(categories.map(group=>[group.id,group.name]));
  const references=[];
  for(const project of candidates){
    const metrics=calculateProjectMetrics(project,records);if(!metrics.items.length)continue;
    const totals={};metrics.items.forEach(record=>{const category=categoryItems[record.categoryId];if(category)totals[category.groupId]=(totals[category.groupId]||0)+record.amountCents;});
    const top=Object.entries(totals).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]||null;
    references.push({project,metrics,topCategory:top?{id:top[0],name:groupNames[top[0]]||'未知分类',amountCents:top[1]}:null});if(references.length>=limit)break;
  }
  return references;
}
function recentProjectReference(type,projects,records,categories){return projectHistoryReferences(type,projects,records,categories,'',1)[0]||null;}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
