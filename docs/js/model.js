/* ============ 数据定义 ============ */
const DEFAULT_EXPENSE_CATS = {
  food:{name:'食品生鲜',emoji:'🥗',color:'#22c55e',subs:{vegetable:'买菜',meat:'买肉',fruit:'水果',snack:'零食',drink:'饮料'}},
  shopping:{name:'购物',emoji:'🛒',color:'#6366f1',subs:{daily:'日用品',clothes:'衣服',sports:'运动器材',digital:'数码电器'}},
  kids:{name:'育儿',emoji:'🧸',color:'#fb7185',subs:{toy:'玩具',kclothes:'衣服',shoes:'鞋子',bedding:'床品',study:'学习文具',kother:'其他'}},
  dining:{name:'餐饮外食',emoji:'🍜',color:'#f59e0b',subs:{restaurant:'堂食',takeout:'外卖'}},
  transport:{name:'交通出行',emoji:'🚌',color:'#0ea5e9',subs:{transit:'公共交通',taxi:'打车',fuel:'加油',charging:'车辆充电',ticket:'车票机票'}},
  living:{name:'居住生活',emoji:'🏠',color:'#8b5cf6',subs:{rent:'房租',utility:'水电燃气',hotel:'住宿酒店'}},
  entertainment:{name:'休闲娱乐',emoji:'🎮',color:'#ec4899',subs:{movie:'影音游戏',scenic:'景点门票',fitness:'健身'}},
  health:{name:'医疗健康',emoji:'💊',color:'#ef4444',subs:{medicine:'药品',checkup:'体检医疗'}},
  social:{name:'人情往来',emoji:'🎁',color:'#f97316',subs:{gift:'礼物红包'}},
};
const BENEFICIARIES={family:'共同',wife:'妻子',husband:'丈夫',son:'儿子'};
const BENEFICIARY_IDS=Object.keys(BENEFICIARIES);
const CATEGORY_COLORS=['#22c55e','#6366f1','#fb7185','#f59e0b','#0ea5e9','#8b5cf6','#ec4899','#ef4444','#f97316','#14b8a6','#64748b'];
function defaultCategoryConfig(){return Object.entries(DEFAULT_EXPENSE_CATS).map(([id,item],index)=>({id,name:item.name,color:item.color||CATEGORY_COLORS[index%CATEGORY_COLORS.length],active:true,subs:Object.entries(item.subs).map(([subId,name])=>({id:subId,name,active:true,roles:[...BENEFICIARY_IDS]}))}));}
function cloneCategoryConfig(config){return JSON.parse(JSON.stringify(config));}
function categoryMap(config){const map={};config.forEach(group=>{const subs={},subConfig={};group.subs.forEach(sub=>{subs[sub.id]=sub.name;subConfig[sub.id]=sub;});map[group.id]={name:group.name,color:group.color,active:group.active!==false,subs,subConfig};});return map;}
let EXPENSE_CATS=categoryMap(defaultCategoryConfig());
const INCOME_CATS = {
  salary:{name:'工资',emoji:'💼',color:'#10b981',subs:{base:'月薪'}},
  bonus:{name:'奖金',emoji:'🏆',color:'#14b8a6',subs:{perf:'绩效奖金'}},
  finance:{name:'理财收益',emoji:'📈',color:'#0ea5e9',subs:{invest:'投资收益'}},
  parttime:{name:'兼职外快',emoji:'🤝',color:'#6366f1',subs:{side:'兼职'}},
  redpacket:{name:'红包礼金',emoji:'🧧',color:'#f59e0b',subs:{gift:'收红包'}},
  other_in:{name:'其他收入',emoji:'🐷',color:'#94a3b8',subs:{misc:'其他'}},
};
const GOAL_TYPES={emergency:{name:'应急储备',emoji:'🛟'},travel:{name:'旅行计划',emoji:'✈️'},education:{name:'教育成长',emoji:'🎓'},debt:{name:'偿还债务',emoji:'🧾'},other:{name:'其他目标',emoji:'🎯'}};
const GOAL_STATUSES={active:'进行中',paused:'已暂停',completed:'已完成'};
const PROJECT_TYPES={travel:{name:'旅行',emoji:'✈️'},renovation:{name:'装修',emoji:'🛠️'},festival:{name:'节日',emoji:'🧧'},medical:{name:'医疗',emoji:'🏥'},education:{name:'教育',emoji:'🎓'},moving:{name:'搬家',emoji:'📦'},other:{name:'其他',emoji:'🧳'}};
const PROJECT_STATUSES={active:'进行中',completed:'已完成',archived:'已归档'};
const getCat=(t,k)=>(t==='income'?INCOME_CATS:EXPENSE_CATS)[k];
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
  records.forEach(record=>{if(record.type==='expense'&&record.date.startsWith(prefix))totals[record.date]=(totals[record.date]||0)+record.amountCents;});
  return totals;
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
