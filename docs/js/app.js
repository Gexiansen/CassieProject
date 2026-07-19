/* ============ 状态 ============ */
let prefs=readPrefs();
EXPENSE_CATS=categoryMap(prefs.categories);
const loaded=readStoredData();
let storageLocked=loaded.locked;
let backupMeta=readBackupMeta();
let decisions=readDecisions();
const now=new Date();
function defaultFilters(){return {keyword:'',type:'all',range:'all',start:'',end:''};}
let state={records:loaded.records,view:'month',tab:'home',filtersExpanded:false,year:now.getFullYear(),month:now.getMonth(),calendarExpanded:false,calendarAnchor:todayStr(),
  openYears:{[now.getFullYear()]:true},
  openMonths:{[now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')]:true},filters:defaultFilters(),planningView:'budget'};

/* ============ 计算辅助 ============ */
function inPeriod(r){const[y,m]=r.date.split('-').map(Number);return state.view==='year'?y===state.year:y===state.year&&m-1===state.month;}
function periodRecs(){return state.records.filter(inPeriod);}
function sumType(recs,t){return recs.filter(r=>r.type===t).reduce((s,r)=>s+r.amountCents,0);}
function previousComparable(type,records=state.records,year=state.year,month=state.month,view=state.view,baseDate=todayStr()){
  const[baseYear,baseMonth,baseDay]=baseDate.split('-').map(Number);
  if(view==='year'){
    const previousYear=year-1,isCurrent=year===baseYear,cutoff=isCurrent?`${previousYear}-${String(baseMonth).padStart(2,'0')}-${String(baseDay).padStart(2,'0')}`:`${previousYear}-12-31`;
    const amountCents=records.filter(record=>record.type===type&&record.date.slice(0,4)===String(previousYear)&&record.date<=cutoff).reduce((sum,record)=>sum+record.amountCents,0);
    return {amountCents,label:isCurrent?'上年同期':'上年'};
  }
  const previous=new Date(year,month-1,1),previousYear=previous.getFullYear(),previousMonth=previous.getMonth()+1,isCurrent=year===baseYear&&month===baseMonth-1,lastDay=new Date(previousYear,previousMonth,0).getDate(),cutoffDay=isCurrent?Math.min(baseDay,lastDay):lastDay;
  const prefix=`${previousYear}-${String(previousMonth).padStart(2,'0')}`,cutoff=`${prefix}-${String(cutoffDay).padStart(2,'0')}`;
  const amountCents=records.filter(record=>record.type===type&&record.date.startsWith(prefix)&&record.date<=cutoff).reduce((sum,record)=>sum+record.amountCents,0);
  return {amountCents,label:isCurrent?'上月同期':'上月'};
}
function filterDateBounds(range,today){
  const[y,m]=today.split('-').map(Number),lastDay=(year,month)=>String(new Date(year,month,0).getDate()).padStart(2,'0');
  if(range==='month')return [`${y}-${String(m).padStart(2,'0')}-01`,`${y}-${String(m).padStart(2,'0')}-${lastDay(y,m)}`];
  if(range==='lastMonth'){const d=new Date(y,m-2,1),ly=d.getFullYear(),lm=d.getMonth()+1;return[`${ly}-${String(lm).padStart(2,'0')}-01`,`${ly}-${String(lm).padStart(2,'0')}-${lastDay(ly,lm)}`];}
  if(range==='year')return[`${y}-01-01`,`${y}-12-31`];
  return ['', ''];
}
function hasActiveFilters(filters=state.filters){return Object.entries(filters).some(([key,value])=>key==='type'||key==='range'?value!=='all':value!=='');}
function filterRecords(records,filters,today=todayStr()){
  const keyword=filters.keyword.toLocaleLowerCase('zh-CN'),bounds=filterDateBounds(filters.range,today);
  const start=filters.range==='custom'?filters.start:bounds[0],end=filters.range==='custom'?filters.end:bounds[1];
  return records.filter(record=>{
    const cat=getCat(record.type,record.cat),project=projectForId(record.projectId),beneficiary=BENEFICIARIES[record.beneficiaryId]||'',haystack=`${record.note} ${record.tag} ${project?project.name:''} ${beneficiary} ${cat.name} ${cat.subs[record.sub]}`.toLocaleLowerCase('zh-CN');
    if(keyword&&!haystack.includes(keyword))return false;
    if(filters.type!=='all'&&record.type!==filters.type)return false;
    if(start&&record.date<start||end&&record.date>end)return false;
    return true;
  });
}
function monthKey(year=state.year,month=state.month){return `${year}-${String(month+1).padStart(2,'0')}`;}
function previousMonthKey(value){const[y,m]=value.split('-').map(Number),date=new Date(y,m-2,1);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;}
function projectForId(id,decisionData=decisions){return id?decisionData.projects.find(project=>project.id===id)||null:null;}
function projectAppliesOn(project,date){return !!(project&&project.status==='active'&&validDate(date)&&project.startDate<=date&&date<=project.endDate);}
function calculateProject(project,records=state.records){
  const items=records.filter(record=>record.type==='expense'&&record.projectId===project.id),actualCents=items.reduce((sum,item)=>sum+item.amountCents,0),days=Math.max(1,Math.round((new Date(project.endDate)-new Date(project.startDate))/86400000)+1),people=project.people||1;
  return {items,actualCents,remainingCents:project.budgetCents?project.budgetCents-actualCents:null,percent:project.budgetCents?actualCents/project.budgetCents*100:null,days,people,perPersonCents:Math.round(actualCents/people),perPersonDayCents:Math.round(actualCents/people/days)};
}
function projectBudgetForMonth(value,decisionData=decisions){return decisionData.projects.filter(project=>project.status!=='archived'&&project.startDate.slice(0,7)===value).reduce((sum,project)=>sum+project.budgetCents,0);}
function calculateBudget(value,records=state.records,decisionData=decisions){
  const budget=decisionData.budgets[value]||null;let spentCents=0;
  records.forEach(record=>{if(record.type==='expense'&&record.date.slice(0,7)===value&&!projectForId(record.projectId,decisionData))spentCents+=record.amountCents;});
  return {configured:!!(budget&&budget.totalCents!==null),budget,totalCents:budget?budget.totalCents:null,spentCents,remainingCents:budget&&budget.totalCents!==null?budget.totalCents-spentCents:null,percent:budget&&budget.totalCents?spentCents/budget.totalCents*100:null};
}
function budgetLevel(percent){return percent===null?'':percent>=100?'over':percent>=80?'warn':'';}
function monthsUntil(targetDate,baseDate=todayStr()){
  const[by,bm]=baseDate.slice(0,7).split('-').map(Number),[ty,tm]=targetDate.slice(0,7).split('-').map(Number);
  return Math.max(1,(ty-by)*12+tm-bm+1);
}
function calculateGoal(goal,baseDate=todayStr()){
  const savedCents=goal.contributions.reduce((sum,item)=>sum+item.amountCents,0),remainingCents=Math.max(0,goal.targetCents-savedCents);
  const percent=goal.targetCents?savedCents/goal.targetCents*100:0,months=monthsUntil(goal.targetDate,baseDate);
  return {savedCents,remainingCents,percent,recommendedCents:remainingCents?Math.ceil(remainingCents/months):0,months};
}
function calculateMonthReview(value,records=state.records,decisionData=decisions){
  const monthRecords=records.filter(record=>record.date.slice(0,7)===value),legacyIncomeCents=sumType(monthRecords,'income'),expenseCents=sumType(monthRecords,'expense'),budget=decisionData.budgets[value]||null,availableCents=budget&&budget.availableCents!==null&&budget.availableCents!==undefined?budget.availableCents:legacyIncomeCents||null;
  let goalContributionCents=0,goalContributionCount=0;
  decisionData.goals.forEach(goal=>goal.contributions.forEach(item=>{if(item.date.slice(0,7)===value){goalContributionCents+=item.amountCents;goalContributionCount++;}}));
  const followReview=decisionData.reviews[previousMonthKey(value)]||null,followActions=followReview?followReview.actions:[];
  return {availableCents,availableSource:budget&&budget.availableCents?'plan':legacyIncomeCents?'legacy':'none',legacyIncomeCents,expenseCents,balanceCents:availableCents===null?null:availableCents-expenseCents-goalContributionCents,budget:calculateBudget(value,records,decisionData),goalContributionCents,goalContributionCount,followActions};
}
function reviewObservations(metrics,decisionData=decisions){
  const items=[];
  if(metrics.availableCents===null)items.push({warn:true,text:'本月没有设置可支配金额，暂时无法判断实际结余。'});
  else if(metrics.balanceCents<0)items.push({warn:true,text:`扣除支出和目标投入后，本月超出可支配金额 ¥${fmt(Math.abs(metrics.balanceCents))}。`});
  else items.push({warn:false,text:`扣除支出和目标投入后，本月剩余 ¥${fmt(metrics.balanceCents)}，占可支配金额的 ${(metrics.balanceCents/metrics.availableCents*100).toFixed(1)}%。`});
  if(!metrics.budget.configured)items.push({warn:true,text:'本月没有预算，无法判断支出是否符合月初计划。'});
  else if(metrics.budget.percent!==null&&metrics.budget.percent>=100)items.push({warn:true,text:`总预算已超出 ¥${fmt(Math.abs(metrics.budget.remainingCents))}。`});
  else if(metrics.budget.percent!==null)items.push({warn:metrics.budget.percent>=80,text:`总预算执行率为 ${metrics.budget.percent.toFixed(1)}%，剩余 ¥${fmt(Math.max(0,metrics.budget.remainingCents))}。`});
  if(decisionData.goals.some(goal=>goal.status==='active'))items.push({warn:metrics.goalContributionCents===0,text:metrics.goalContributionCents?`本月完成 ${metrics.goalContributionCount} 次目标投入，共 ¥${fmt(metrics.goalContributionCents)}。`:'本月还没有目标投入记录。'});
  return items;
}
function recentCompleteMonthKeys(baseDate=todayStr(),count=3){
  const[y,m]=baseDate.slice(0,7).split('-').map(Number),keys=[];
  for(let index=1;index<=count;index++){const date=new Date(y,m-1-index,1);keys.push(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`);}
  return keys;
}
function calculateCashflow(records=state.records,decisionData=decisions,baseDate=todayStr()){
  const keys=recentCompleteMonthKeys(baseDate),periods=keys.map(key=>{const items=records.filter(record=>record.type==='expense'&&record.date.slice(0,7)===key);return {key,recordCount:items.length,expenseCents:sumType(items,'expense')};}).filter(item=>item.recordCount>0);
  const average=field=>periods.length?Math.round(periods.reduce((sum,item)=>sum+item[field],0)/periods.length):0;
  const averageExpenseCents=average('expenseCents');
  const activeGoals=decisionData.goals.filter(goal=>goal.status==='active'),requiredGoalCents=activeGoals.reduce((sum,goal)=>sum+calculateGoal(goal,baseDate).recommendedCents,0);
  const projectBudgetCents=projectBudgetForMonth(baseDate.slice(0,7),decisionData),currentBudget=decisionData.budgets[baseDate.slice(0,7)]||null,hasDailyBudget=!!(currentBudget&&Number.isSafeInteger(currentBudget.totalCents)&&currentBudget.totalCents>0),availableCents=currentBudget&&currentBudget.availableCents!==null&&currentBudget.availableCents!==undefined?currentBudget.availableCents:null,dailyPlanCents=hasDailyBudget?currentBudget.totalCents:periods.length?averageExpenseCents:null,plannedExpenseCents=dailyPlanCents===null?null:dailyPlanCents+projectBudgetCents;
  const planBalanceCents=availableCents===null||plannedExpenseCents===null?null:availableCents-plannedExpenseCents-requiredGoalCents;
  return {keys,periods,sampleCount:periods.length,availableCents,averageExpenseCents,activeGoalCount:activeGoals.length,requiredGoalCents,currentBudget,hasDailyBudget,projectBudgetCents,dailyPlanCents,plannedExpenseCents,planBalanceCents};
}
function cashflowObservations(metrics){
  const items=[];
  if(metrics.availableCents===null)items.push({warn:true,text:'请先填写本月可支配金额，才能判断计划后结余。'});
  if(metrics.dailyPlanCents===null)items.push({warn:true,text:'本月没有日常预算，历史支出也不足，暂时无法估算日常花费。'});
  else if(!metrics.hasDailyBudget&&metrics.sampleCount<3)items.push({warn:true,text:`日常花费使用历史平均值，当前只有 ${metrics.sampleCount} 个月有效样本。`});
  if(metrics.planBalanceCents!==null)items.push({warn:metrics.planBalanceCents<0,text:`按${metrics.hasDailyBudget?'本月日常预算':'历史平均支出'}${metrics.projectBudgetCents?'、当月专项预算':''}${metrics.activeGoalCount?'和目标建议投入':''}估算，计划后${metrics.planBalanceCents<0?'缺口':'结余'} ¥${fmt(Math.abs(metrics.planBalanceCents))}。`});
  return items;
}

/* ============ 图表(纯SVG) ============ */
function trendSVG(){
  const arr=Array(12).fill(0);
  state.records.forEach(r=>{const[y,m]=r.date.split('-').map(Number);if(r.type==='expense'&&y===state.year)arr[m-1]+=r.amountCents;});
  const max=Math.max(1,...arr);
  const W=340,H=190,pL=34,pR=10,pT=10,pB=30,cw=W-pL-pR,ch=H-pT-pB,base=pT+ch;
  const X=i=>pL+i*cw/11, Y=v=>base-(v/max)*ch;
  const points=arr.map((value,index)=>`${X(index)},${Y(value)}`).join(' '),area=`M${pL},${base} L${points.split(' ').join(' L')} L${pL+cw},${base} Z`;
  let grid='';for(let g=0;g<=3;g++){const y=pT+ch*g/3;grid+=`<line x1="${pL}" y1="${y}" x2="${W-pR}" y2="${y}" stroke="#f1f5f9" stroke-width="1"/>`;}
  let labels='';arr.forEach((a,i)=>{if(i%2===0)labels+=`<text x="${X(i)}" y="${H-8}" font-size="9" fill="#94a3b8" text-anchor="middle">${i+1}月</text>`;});
  const dots=arr.map((value,index)=>`<circle cx="${X(index)}" cy="${Y(value)}" r="2.5" fill="#6366f1"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id="gE" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#818cf8" stop-opacity=".35"/><stop offset="100%" stop-color="#818cf8" stop-opacity="0"/></linearGradient></defs>
    ${grid}<path d="${area}" fill="url(#gE)"/><polyline points="${points}" fill="none" stroke="#6366f1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${dots}${labels}</svg>`;
}
/* ============ 渲染主界面 ============ */
function render(){
  const recs=periodRecs();
  const totalExp=sumType(recs,'expense'),pExp=previousComparable('expense');
  const diff=totalExp-pExp.amountCents, diffPct=pExp.amountCents>0?diff/pExp.amountCents*100:null;
  const currentBudget=state.view==='month'?decisions.budgets[monthKey()]||null:null,availableCents=currentBudget&&currentBudget.availableCents!==undefined?currentBudget.availableCents:null;
  const periodLabel=state.view==='year'?`${state.year}年`:`${state.year}年${state.month+1}月`;
  const showToday=state.view==='year'||state.year!==now.getFullYear()||state.month!==now.getMonth();
  const backup=backupStatus();

  let html=`
  <div class="top">
    <div class="logo"><div class="pig">🐷</div><h1>我的小账本</h1></div>
    <div class="top-actions"><button class="data-button" data-action="open-data-management" aria-label="数据与备份">☁️<span>数据</span></button></div>
  </div>`;
  html+=`<div class="tabs">
    <button class="${state.tab==='home'?'on':''}" data-action="set-tab" data-value="home">🏠 首页</button>
    <button class="${state.tab==='details'?'on':''}" data-action="set-tab" data-value="details">📋 明细</button>
    <button class="${state.tab==='planning'?'on':''}" data-action="set-tab" data-value="planning">🧭 计划</button>
  </div>`;
  if(state.tab!=='home')html+=`<div class="compact-period"><button data-action="shift" data-value="-1" aria-label="上一${state.view==='year'?'年':'月'}">‹</button><div class="period-label">${periodLabel}</div>${showToday?`<button class="today" data-action="go-today">回本月</button>`:''}<button data-action="shift" data-value="1" aria-label="下一${state.view==='year'?'年':'月'}">›</button>${state.tab==='details'?`<div class="view-toggle"><button class="${state.view==='month'?'on':''}" data-action="set-view" data-value="month">月</button><button class="${state.view==='year'?'on':''}" data-action="set-view" data-value="year">年</button></div>`:''}</div>`;
  if(state.tab==='home'&&(backup.warn||storageLocked))html+=`<button class="backup-notice" data-action="open-data-management"><span>${storageLocked?'检测到本地数据异常，记账已暂停。':esc(backup.text)}</span><b>${storageLocked?'处理':'去备份'} ›</b></button>`;

  if(state.tab==='home')html+=renderHomeCalendar()+`<div class="card-sum">
    <div class="blob" style="width:112px;height:112px;right:-24px;top:-24px;"></div>
    <div class="blob" style="width:64px;height:64px;right:-8px;top:64px;"></div>
    <div class="big"><div class="t">${periodLabel}支出 💸</div><div class="n">¥${fmt(totalExp)}</div></div>
    <div class="duo">
      <div class="mini"><div class="h"><span>本月可支配</span></div><div class="v lg">${availableCents!==null?`¥${fmt(availableCents)}`:'未设置'}</div></div>
      <div class="mini"><div class="h"><span>↗ 较${pExp.label}支出</span></div>${diffPct!==null?`<div class="pill big-pill ${diff>0?'up':diff<0?'down':'flat'}">${diff>0?'▲':diff<0?'▼':'–'}${diff>0?'+':diff<0?'-':''}${Math.abs(diffPct).toFixed(1)}%</div>`:`<div class="v lg" style="opacity:.6">—</div>`}</div>
    </div>
  </div>`+renderOverview(recs);
  if(state.tab==='details')html+=renderDetails();
  if(state.tab==='planning')html+=renderPlanning();

  html+=`<div class="fab"><button class="exp" data-action="open-add">＋ 记一笔</button></div>`;
  document.getElementById('app').innerHTML=html;
}

function renderBudgetCard(showAction=true){
  if(state.view!=='month')return '';
  const key=monthKey(),metrics=calculateBudget(key),label=`${state.year}年${state.month+1}月`;
  if(!metrics.configured)return `<div class="card"><h3>🎯 本月日常预算 <span class="sub">${label}</span></h3><div class="empty" style="padding:16px 0">还没有设置本月日常预算<br><span style="font-size:12px;font-weight:500">专项支出会由各自的专项预算单独管理</span></div>${showAction?`<div class="budget-actions"><button class="primary" data-action="open-planning">设置日常预算</button></div>`:''}</div>`;
  let h=`<div class="card"><h3>🎯 本月日常预算 <span class="sub">${label}</span></h3>`;
  if(metrics.totalCents!==null){const level=budgetLevel(metrics.percent),remaining=metrics.remainingCents;
    h+=`<div class="budget-hero"><div class="budget-head"><div><div class="label">日常预算总额</div><div class="value">¥${fmt(metrics.totalCents)}</div></div><div class="remain">${remaining>=0?'剩余':'已超出'}<b class="${remaining<0?'ex-c':''}">¥${fmt(Math.abs(remaining))}</b></div></div><div class="budget-progress"><div class="fill ${level}" style="width:${Math.min(100,metrics.percent)}%"></div></div><div class="budget-caption"><span>日常已用 ¥${fmt(metrics.spentCents)}</span><span>${metrics.percent.toFixed(1)}%</span></div></div>`;
  }
  if(showAction)h+=`<div class="budget-actions"><button data-action="open-planning">管理本月预算</button></div>`;
  return h+`</div>`;
}

function renderBudgetPlanning(){
  const key=monthKey(),metrics=calculateBudget(key),budget=metrics.budget||{totalCents:null,availableCents:null,categories:{}},previous=decisions.budgets[previousMonthKey(key)],hasPlan=budget.totalCents!==null||(budget.availableCents!==null&&budget.availableCents!==undefined);
  return `<div class="card"><h3>🧭 制定月度计划 <span class="sub">${state.year}年${state.month+1}月</span></h3><p class="planning-note">不再逐笔记录收入；可支配金额表示本月可以安排给支出和目标的钱。</p>
    <div class="budget-form-row"><div class="name">本月可支配金额<span>用于判断计划后结余，选填</span></div><div class="money">¥<input id="budgetAvailable" type="number" inputmode="decimal" min="0.01" step="0.01" aria-label="本月可支配金额" placeholder="未设置" value="${budget.availableCents?(budget.availableCents/100).toFixed(2):''}"></div></div>
    <div class="budget-form-row"><div class="name">本月日常预算<span>不含已关联正式专项的支出</span></div><div class="money">¥<input id="budgetTotal" type="number" inputmode="decimal" min="0.01" step="0.01" aria-label="本月日常预算" placeholder="未设置" value="${budget.totalCents?(budget.totalCents/100).toFixed(2):''}"></div></div><div class="budget-actions">${previous&&(previous.totalCents||previous.availableCents)&&!hasPlan?`<button data-action="copy-previous-budget">复制上月计划</button>`:''}<button class="primary" data-action="save-budget">保存月度计划</button></div></div>`;
}

function projectCardMarkup(project){
  const type=PROJECT_TYPES[project.type],metrics=calculateProject(project),current=project.id===decisions.currentProjectId,level=budgetLevel(metrics.percent),budget=project.budgetCents?`<div class="budget-progress"><div class="fill ${level}" style="width:${Math.min(100,metrics.percent)}%"></div></div><div class="budget-caption"><span>已用 ¥${fmt(metrics.actualCents)}</span><span>预算 ¥${fmt(project.budgetCents)} · ${metrics.percent.toFixed(1)}%</span></div>`:`<div class="budget-caption"><span>已用 ¥${fmt(metrics.actualCents)}</span><span>未设置预算</span></div>`,stats=project.type==='travel'?`<div>记录<b>${metrics.items.length} 笔</b></div><div>人均<b>¥${fmt(metrics.perPersonCents)}</b></div><div>人均每天<b>¥${fmt(metrics.perPersonDayCents)}</b></div>`:`<div>记录<b>${metrics.items.length} 笔</b></div><div>周期<b>${metrics.days} 天</b></div><div>${project.budgetCents?'剩余':'预算'}<b>${project.budgetCents?`¥${fmt(Math.max(0,metrics.remainingCents))}`:'未设置'}</b></div>`;
  return `<div class="project-card ${current?'current':''}"><div class="goal-title"><div class="name">${type.emoji} ${esc(project.name)}${current?'<span class="project-current">当前</span>':''}<span class="meta">${project.startDate} 至 ${project.endDate} · ${PROJECT_STATUSES[project.status]}</span></div></div>${budget}<div class="project-stats">${stats}</div><div class="project-actions"><button class="primary" data-action="open-project" data-value="${project.id}">查看详情</button><button data-action="open-project-actions" data-value="${project.id}">管理</button></div></div>`;
}
function renderProjectsPlanning(){
  const projects=[...decisions.projects].filter(project=>project.status!=='archived'),active=projects.filter(project=>project.status==='active').sort((a,b)=>a.startDate.localeCompare(b.startDate)),completed=projects.filter(project=>project.status==='completed').sort((a,b)=>b.endDate.localeCompare(a.endDate));
  let h=`<div class="card"><h3>🧳 专项计划 <span class="sub">生活事件单独归集</span></h3><p class="planning-note">专项支出保留住宿、交通、餐饮等分类，但不占用日常总预算。</p><div class="budget-actions"><button class="primary" data-action="open-project-form">＋ 新建专项</button></div></div>`;
  if(!projects.length)return h+`<div class="card"><div class="empty">还没有正式专项<br><span style="font-size:12px;font-weight:500">可以从下一次旅行、装修或节日计划开始</span></div></div>`;
  if(active.length)h+=`<div class="card"><h3>📍 进行中的专项 <span class="sub">${active.length} 个</span></h3>${active.map(projectCardMarkup).join('')}</div>`;
  else h+=`<div class="card"><div class="empty" style="padding:14px 0">当前没有进行中的专项</div></div>`;
  if(completed.length)h+=`<details class="card analysis-card"><summary>✅ 已完成专项（${completed.length}）</summary>${completed.map(projectCardMarkup).join('')}</details>`;
  return h;
}

function goalCardMarkup(goal){
  const type=GOAL_TYPES[goal.type],metrics=calculateGoal(goal),level=metrics.percent>=100?'completed':goal.status,advice=goal.status==='completed'?'目标已完成，历史投入仍会保留。':goal.status==='paused'?'目标已暂停。':metrics.remainingCents===0?'目标金额已经达成，可以标记完成。':`距离目标月还有 ${metrics.months} 个月，建议每月投入 ¥${fmt(metrics.recommendedCents)}。`;
  return `<div class="goal-card"><div class="goal-title"><div class="name">${type.emoji} ${esc(goal.name)}<span class="meta">${type.name} · 目标日期 ${goal.targetDate}</span></div><span class="goal-status ${level}">${GOAL_STATUSES[goal.status]}</span></div><div class="goal-money"><span>已投入<b>¥${fmt(metrics.savedCents)}</b></span><span style="text-align:right">目标 ¥${fmt(goal.targetCents)}<br>还差 ¥${fmt(metrics.remainingCents)}</span></div><div class="budget-progress"><div class="fill ${metrics.percent>=100?'':'warn'}" style="width:${Math.min(100,metrics.percent)}%"></div></div><div class="budget-caption"><span>${goal.contributions.length} 次确认</span><span>${Math.min(999,metrics.percent).toFixed(1)}%</span></div><div class="goal-advice">${advice}</div><div class="goal-actions">${goal.status==='active'?`<button class="primary" data-action="open-contribution" data-value="${goal.id}">记录投入</button>`:''}<button data-action="open-goal-actions" data-value="${goal.id}">管理</button></div></div>`;
}
function renderGoalsPlanning(){
  const goals=[...decisions.goals],active=goals.filter(goal=>goal.status==='active').sort((a,b)=>a.targetDate.localeCompare(b.targetDate)),paused=goals.filter(goal=>goal.status==='paused').sort((a,b)=>a.targetDate.localeCompare(b.targetDate)),completed=goals.filter(goal=>goal.status==='completed').sort((a,b)=>b.targetDate.localeCompare(a.targetDate)),saved=goals.reduce((sum,goal)=>sum+calculateGoal(goal).savedCents,0),target=goals.reduce((sum,goal)=>sum+goal.targetCents,0);
  let h=`<div class="card"><h3>🏁 财务目标 <span class="sub">为未来留出资金</span></h3><div class="goal-summary"><div>进行中<b>${active.length} 个</b></div><div>累计投入<b>¥${fmt(saved)}</b></div><div>目标合计<b>¥${fmt(target)}</b></div></div><p class="planning-note">目标用于攒钱，实际发生旅行、装修等支出时请建立专项。目标投入不计入日常支出预算。</p><div class="budget-actions"><button class="primary" data-action="open-goal-form">＋ 新建财务目标</button></div></div>`;
  if(!goals.length)return h+`<div class="card"><div class="empty">还没有财务目标<br><span style="font-size:12px;font-weight:500">可以先从应急储备开始</span></div></div>`;
  if(active.length)h+=`<div class="card"><h3>📍 进行中的目标 <span class="sub">${active.length} 个</span></h3>${active.map(goalCardMarkup).join('')}</div>`;
  if(paused.length)h+=`<details class="card analysis-card"><summary>⏸ 已暂停目标（${paused.length}）</summary>${paused.map(goalCardMarkup).join('')}</details>`;
  if(completed.length)h+=`<details class="card analysis-card"><summary>✅ 已完成目标（${completed.length}）</summary>${completed.map(goalCardMarkup).join('')}</details>`;
  return h;
}

function renderReviewPlanning(){
  const key=monthKey(),today=new Date(),currentKey=monthKey(today.getFullYear(),today.getMonth()),label=`${state.year}年${state.month+1}月`;
  if(key>currentKey)return `<div class="card"><h3>📝 月度复盘 <span class="sub">${label}</span></h3><div class="empty">这个月还没有发生<br><span style="font-size:12px;font-weight:500">到当月再根据实际支出进行复盘</span></div></div>`;
  const metrics=calculateMonthReview(key),review=decisions.reviews[key]||{highlight:'',adjustment:'',actions:[]},observations=reviewObservations(metrics);
  let h=`<div class="card"><h3>📊 本月结果 <span class="sub">${label}</span></h3><div class="review-summary"><div>可支配<b>${metrics.availableCents===null?'未设置':`¥${fmt(metrics.availableCents)}`}</b></div><div>支出<b>¥${fmt(metrics.expenseCents)}</b></div><div>剩余<b class="${metrics.balanceCents!==null&&metrics.balanceCents<0?'negative':''}">${metrics.balanceCents===null?'—':`${metrics.balanceCents<0?'-':''}¥${fmt(Math.abs(metrics.balanceCents))}`}</b></div></div><p class="planning-note" style="margin:0">目标投入：¥${fmt(metrics.goalContributionCents)}，共 ${metrics.goalContributionCount} 次。${metrics.availableSource==='legacy'?' 可支配金额暂用历史逐笔收入合计。':''}</p></div>`;
  h+=`<div class="card"><h3>🔎 系统观察 <span class="sub">根据当前本地数据</span></h3><div class="review-observations">${observations.map(item=>`<div class="review-observation ${item.warn?'warn':''}">${item.warn?'⚠️':'✓'} ${item.text}</div>`).join('')}</div></div>`;
  const followMonth=previousMonthKey(key);
  h+=`<div class="card"><h3>✅ 上月行动跟进 <span class="sub">来自 ${followMonth}</span></h3>`;
  if(!metrics.followActions.length)h+=`<div class="empty" style="padding:14px 0">上月没有设置行动事项</div>`;
  else h+=`<div class="follow-actions">${metrics.followActions.map(item=>`<button class="follow-action ${item.done?'done':''}" data-action="toggle-review-action" data-value="${followMonth}/${item.id}"><span class="check">${item.done?'✓':''}</span><span>${esc(item.text)}</span></button>`).join('')}</div>`;
  const firstAction=review.actions[0],hasLegacy=!!review.adjustment||review.actions.length>1;
  h+=`</div><div class="card review-form"><h3>✍️ 本月一个结论 ${review.updatedAt?'<span class="sub">已保存</span>':''}</h3><div class="field"><label for="reviewHighlight">最值得记住的发现</label><textarea id="reviewHighlight" maxlength="120" placeholder="例如：外卖是本月最容易失控的支出">${esc(review.highlight||review.adjustment)}</textarea></div><div class="field"><label for="reviewAction">下个月只做一件事</label><div class="action-input"><span>1</span><input id="reviewAction" class="review-action-input" data-id="${firstAction?firstAction.id:''}" type="text" maxlength="40" placeholder="例如：每周外卖不超过 2 次" value="${firstAction?esc(firstAction.text):''}"></div></div>${hasLegacy?`<details class="advanced-import"><summary>旧版复盘中的其他内容仍会保留</summary><p class="planning-note" style="margin:6px 0 0">${review.adjustment?`补充：${esc(review.adjustment)}`:''}${review.actions.slice(1).map(item=>`<br>行动：${esc(item.text)}`).join('')}</p></details>`:''}<div class="budget-actions"><button class="primary" data-action="save-review">保存月度结论</button></div></div>`;
  return h;
}

function renderCashflowPlanning(){
  const selected=monthKey(),current=todayStr().slice(0,7),baseDate=selected===current?todayStr():`${selected}-01`,metrics=calculateCashflow(state.records,decisions,baseDate),observations=cashflowObservations(metrics),periodLabel=metrics.periods.map(item=>item.key).reverse().join('、');
  const confidence=metrics.availableCents===null?'等待可支配金额':metrics.hasDailyBudget?'基于本月计划':metrics.sampleCount===3?'历史样本较完整':metrics.sampleCount?'历史样本较少':'等待支出数据';
  let h=`<div class="card"><h3>💧 计划后结余 <span class="sub">${confidence}</span></h3>`;
  if(metrics.planBalanceCents!==null)h+=`<div class="td-box"><div class="l">按当前预算、专项和目标估算</div><div class="n ${metrics.planBalanceCents<0?'ex-c':''}">${metrics.planBalanceCents<0?'-':''}¥${fmt(Math.abs(metrics.planBalanceCents))}</div><div class="planning-note" style="margin:4px 0 0">${metrics.planBalanceCents<0?'预计缺口':'预计结余'}</div></div>`;
  h+=`<div class="review-observations">${observations.map(item=>`<div class="review-observation ${item.warn?'warn':''}">${item.warn?'⚠️':'✓'} ${item.text}</div>`).join('')}</div><details class="advanced-import"><summary>查看估算依据</summary><div class="cashflow-plan"><div>本月可支配金额<b>${metrics.availableCents===null?'未设置':`¥${fmt(metrics.availableCents)}`}</b></div><div>日常支出依据<b>${metrics.hasDailyBudget?`预算 ¥${fmt(metrics.currentBudget.totalCents)}`:metrics.sampleCount?`历史月均 ¥${fmt(metrics.averageExpenseCents)}`:'暂无依据'}</b></div><div>本月开始的专项预算<b>¥${fmt(metrics.projectBudgetCents)}</b></div><div>目标建议投入<b>¥${fmt(metrics.requiredGoalCents)}／月</b></div></div><p class="planning-note" style="margin:10px 0 0">${periodLabel?`支出样本：${periodLabel}。`:''}该结果不读取账户余额，只用于检查当前计划是否超过可支配金额。</p></details></div>`;
  return h;
}

function renderPlanning(){
  const content=state.planningView==='projects'?renderProjectsPlanning():state.planningView==='goals'?renderGoalsPlanning():state.planningView==='summary'?renderReviewPlanning():renderBudgetPlanning()+renderCashflowPlanning();
  return `<div class="planning-seg"><button class="${state.planningView==='budget'?'on':''}" data-action="set-planning-view" data-value="budget">🎯 预算</button><button class="${state.planningView==='projects'?'on':''}" data-action="set-planning-view" data-value="projects">🧳 专项</button><button class="${state.planningView==='goals'?'on':''}" data-action="set-planning-view" data-value="goals">🏁 目标</button><button class="${state.planningView==='summary'?'on':''}" data-action="set-planning-view" data-value="summary">📝 月结</button></div>${content}`;
}

function renderDetails(){
  return renderList();
}

function renderOverview(recs){
  const exp=recs.filter(r=>r.type==='expense');
  if(!state.records.length)return `<div class="card"><h3>👋 从第一笔开始</h3><p style="font-size:14px;color:#64748b;line-height:1.7">先记录今天的一笔支出，再设置本月日常预算。</p><div class="budget-actions"><button class="primary" data-action="open-add" data-value="expense">＋ 记录第一笔支出</button></div></div>`;
  let h=renderBudgetCard();
  const currentProject=projectForId(decisions.currentProjectId);
  if(currentProject){const type=PROJECT_TYPES[currentProject.type],metrics=calculateProject(currentProject),auto=projectAppliesOn(currentProject,todayStr()),budget=currentProject.budgetCents?`<div class="budget-progress"><div class="fill ${budgetLevel(metrics.percent)}" style="width:${Math.min(100,metrics.percent)}%"></div></div><div class="budget-caption"><span>已用 ¥${fmt(metrics.actualCents)}</span><span>预算 ${metrics.percent.toFixed(1)}％</span></div>`:`<div class="budget-caption"><span>已用 ¥${fmt(metrics.actualCents)}</span><span>未设置预算</span></div>`;h+=`<div class="card"><h3>📍 当前专项 <span class="sub">${auto?'今天记账时自动带入':'当前不在专项日期内'}</span></h3><div class="project-card current"><div class="goal-title"><div class="name">${type.emoji} ${esc(currentProject.name)}<span class="project-current">当前</span><span class="meta">${currentProject.startDate} 至 ${currentProject.endDate}</span></div></div>${budget}<div class="budget-actions"><button data-action="open-project" data-value="${currentProject.id}">查看专项</button></div></div></div>`;}
  const budget=state.view==='month'?calculateBudget(monthKey()):null;
  let insight='继续记录一段时间后，这里会给出更有针对性的月度观察。',warn=false;
  if(budget&&budget.configured&&budget.percent!==null){warn=budget.percent>=80;insight=budget.percent>=100?`日常预算已经超出 ¥${fmt(Math.abs(budget.remainingCents))}，本月应优先检查可推迟的支出。`:`日常预算已使用 ${budget.percent.toFixed(1)}％，还可安排 ¥${fmt(Math.max(0,budget.remainingCents))}。`;}
  else if(exp.length){const catTotals={};exp.forEach(record=>{catTotals[record.cat]=(catTotals[record.cat]||0)+record.amountCents;});const top=Object.entries(catTotals).sort((a,b)=>b[1]-a[1])[0],total=sumType(exp,'expense');if(top)insight=`${EXPENSE_CATS[top[0]].name}是当前最大支出，占本期支出的 ${(top[1]/total*100).toFixed(1)}％。`;}
  h+=`<div class="card"><h3>💡 本期观察</h3><div class="review-observation ${warn?'warn':''}">${warn?'⚠️':'✓'} ${insight}</div></div>`;
  let analysis='';const trendMonths=new Set(state.records.filter(record=>record.type==='expense'&&record.date.startsWith(String(state.year))).map(record=>record.date.slice(0,7)));
  if(trendMonths.size>=2)analysis+=`<h3>📈 ${state.year}年 支出趋势</h3>${trendSVG()}`;
  const subMap={};exp.forEach(r=>{const k=r.cat+'/'+r.sub;subMap[k]=(subMap[k]||0)+r.amountCents;});
  const subs=Object.entries(subMap).map(([k,v])=>{const[c,s]=k.split('/');return{name:EXPENSE_CATS[c].subs[s],catName:EXPENSE_CATS[c].name,color:EXPENSE_CATS[c].color,value:v};}).sort((a,b)=>b.value-a.value).slice(0,5);
  if(subs.length){analysis+=`<h3 style="margin-top:${analysis?'18px':'0'}">🔥 支出排行 <span class="sub">前 ${subs.length} 项</span></h3>`;const mx=subs[0].value;subs.forEach(s=>{analysis+=`<div class="bar-item"><div class="row"><span class="l"><span class="cat">${s.catName}·</span>${s.name}</span><span class="r">¥${fmt(s.value)}</span></div><div class="track"><div class="fill" style="width:${s.value/mx*100}%;background:${s.color}"></div></div></div>`;});}
  if(analysis)h+=`<details class="card analysis-card"><summary>📊 查看趋势和排行</summary>${analysis}</details>`;
  return h;
}

function dateFromString(value){const[y,m,d]=value.split('-').map(Number);return new Date(y,m-1,d);}
function dateString(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function mondayOfWeek(date){const result=new Date(date);result.setHours(0,0,0,0);result.setDate(result.getDate()-((result.getDay()+6)%7));return result;}
function renderHomeCalendar(){
  const anchor=dateFromString(state.calendarAnchor),today=todayStr(),noSpend=new Set(decisions.noSpendDates),monthMap=calendarDayTotals(state.records,state.year,state.month);
  let start,count,title;
  if(state.calendarExpanded){
    const first=new Date(state.year,state.month,1),last=new Date(state.year,state.month+1,0);start=mondayOfWeek(first);const end=mondayOfWeek(last);end.setDate(end.getDate()+6);count=Math.round((end-start)/86400000)+1;title=`${state.year}年${state.month+1}月`;
  }else{
    start=mondayOfWeek(anchor);count=7;const end=new Date(start);end.setDate(end.getDate()+6);title=`${start.getMonth()+1}月${start.getDate()}日—${end.getMonth()+1}月${end.getDate()}日`;
  }
  let cells='';
  for(let index=0;index<count;index++){
    const date=new Date(start);date.setDate(start.getDate()+index);const value=dateString(date),amount=monthMap[value]||state.records.filter(record=>record.type==='expense'&&record.date===value).reduce((sum,record)=>sum+record.amountCents,0),future=value>today,confirmed=noSpend.has(value)&&!amount,otherMonth=state.calendarExpanded&&(date.getFullYear()!==state.year||date.getMonth()!==state.month);
    const status=amount?'recorded':future?'future':confirmed?'no-spend':'unrecorded',label=amount?calendarAmountLabel(amount):future?'':confirmed?'✓ 无支出':value===today?'今天':'无记录';
    cells+=`<button class="day ${status} ${value===today?'today':''} ${otherMonth?'other-month':''}" data-action="open-calendar-day" data-value="${value}" aria-label="${date.getMonth()+1}月${date.getDate()}日，${amount?`支出 ${fmt(amount)} 元`:confirmed?'已确认无支出':future?'未来日期':'无记录'}"><span class="dn">${date.getDate()}</span>${label?`<span class="amt">${label}</span>`:''}</button>`;
  }
  return `<div class="card calendar-card"><div class="cal-nav"><button data-action="calendar-shift" data-value="-1" aria-label="${state.calendarExpanded?'上个月':'上一周'}">‹</button><div class="cal-title"><b>${title}</b><span>${state.calendarExpanded?'点击日期查看或记账':'本周记账'}</span></div><button data-action="calendar-shift" data-value="1" aria-label="${state.calendarExpanded?'下个月':'下一周'}">›</button></div>
    <div class="week"><div>一</div><div>二</div><div>三</div><div>四</div><div>五</div><div>六</div><div>日</div></div><div class="days">${cells}</div>
    <button class="calendar-expand" data-action="toggle-calendar"><b>${state.calendarExpanded?'⌃':'•••'}</b>${state.calendarExpanded?'收起到本周':'展开整月'}</button>
    <div class="cal-hint"><span><i class="dot recorded"></i>已记录</span><span><i class="dot unrecorded"></i>无记录</span><span><i class="dot no-spend"></i>已确认无支出</span></div></div>`;
}

function renderFilterPanel(){
  const filters=state.filters,selected=(value,current)=>value===current?' selected':'',active=hasActiveFilters();
  return `<div class="card filter-card"><h3>🔎 查找明细 ${active?`<span class="sub">筛选已生效</span>`:''}</h3><form id="filterForm">
    <div class="filter-search"><input id="filterKeyword" type="search" maxlength="40" placeholder="搜索备注、专项或分类" value="${esc(filters.keyword)}"><button type="button" data-action="apply-filters">搜索</button></div><button class="record-toggle" type="button" data-action="toggle-filters">${state.filtersExpanded||active?'收起筛选条件':'更多筛选条件'}</button>
    <div class="filter-advanced ${state.filtersExpanded||active?'':'hidden'}"><div class="filter-grid" style="margin-top:12px">
      <div class="filter-field"><label for="filterType">记录类型</label><select id="filterType"><option value="all"${selected('all',filters.type)}>全部记录</option><option value="expense"${selected('expense',filters.type)}>支出</option><option value="income"${selected('income',filters.type)}>历史收入</option></select></div>
      <div class="filter-field"><label for="filterRange">日期范围</label><select id="filterRange"><option value="all"${selected('all',filters.range)}>全部日期</option><option value="month"${selected('month',filters.range)}>本月</option><option value="lastMonth"${selected('lastMonth',filters.range)}>上月</option><option value="year"${selected('year',filters.range)}>今年</option><option value="custom"${selected('custom',filters.range)}>自定义</option></select></div>
      <div class="filter-field wide"><label>自定义日期</label><div class="filter-dates"><input id="filterStart" type="date" aria-label="开始日期" value="${filters.start}"><input id="filterEnd" type="date" aria-label="结束日期" value="${filters.end}"></div></div>
    </div><div class="filter-actions">${active?`<button type="button" class="clear" data-action="clear-filters">清空筛选</button>`:''}<button type="button" data-action="apply-filters">应用筛选</button></div></div>
  </form></div>`;
}

function renderList(){
  if(!state.records.length)return `<div class="card"><div class="empty">还没有任何记录<br><span style="font-size:13px;font-weight:500">点右下角「记一笔」开始吧 ✨</span></div></div>`;
  const active=hasActiveFilters(),records=filterRecords(state.records,state.filters);
  let h=renderFilterPanel();
  if(active){const income=sumType(records,'income'),expense=sumType(records,'expense');h+=`<div class="filter-summary"><div>结果<b>${records.length} 笔</b></div><div>历史收入<b class="in-c">+${fmt(income)}</b></div><div>支出<b class="ex-c">-${fmt(expense)}</b></div></div>`;}
  if(!records.length)return h+`<div class="card"><div class="empty">没有找到符合条件的记录<br><span style="font-size:13px;font-weight:500">可以调整或清空筛选条件</span></div></div>`;
  const yMap={};
  records.forEach(r=>{const y=r.date.slice(0,4),ym=r.date.slice(0,7);
    if(!yMap[y])yMap[y]={year:y,exp:0,inc:0,count:0,months:{}};
    yMap[y][r.type==='income'?'inc':'exp']+=r.amountCents;yMap[y].count++;
    if(!yMap[y].months[ym])yMap[y].months[ym]={ym,exp:0,inc:0,items:[]};
    yMap[y].months[ym][r.type==='income'?'inc':'exp']+=r.amountCents;yMap[y].months[ym].items.push(r);});
  const groups=Object.values(yMap).map(g=>({...g,
    months:Object.values(g.months).map(m=>({...m,items:m.items.sort((a,b)=>b.date.localeCompare(a.date)||b.updatedAt.localeCompare(a.updatedAt))})).sort((a,b)=>b.ym.localeCompare(a.ym))})).sort((a,b)=>b.year.localeCompare(a.year));
  h+=`<div class="hint">${active?'筛选结果已自动展开，可直接查看明细':'默认按年折叠，点年展开月份、再点月份看明细 👇'}</div>`;
  groups.forEach(yg=>{const yo=active||!!state.openYears[yg.year];
    h+=`<div class="acc"><button class="acc-head" data-action="toggle-year" data-value="${yg.year}"><span class="l"><span class="chev ${yo?'':'closed'}">▾</span>${yg.year}年<span class="c">(${yg.count}笔 · ${yg.months.length}个月)</span></span><span class="r">${yg.inc?`<div class="in">历史收 +${fmt(yg.inc)}</div>`:''}<div class="ex">支 -${fmt(yg.exp)}</div></span></button>`;
    if(yo){h+=`<div class="months">`;
      yg.months.forEach(g=>{const gm=+g.ym.split('-')[1],mo=active||!!state.openMonths[g.ym];
        h+=`<div class="macc"><button class="macc-head" data-action="toggle-month" data-value="${g.ym}"><span class="l"><span class="chev ${mo?'':'closed'}">▾</span>${gm}月<span class="c">(${g.items.length}笔)</span></span><span class="r">${g.inc?`<span class="in" style="font-size:12px;font-weight:700">历史 +${fmt(g.inc)}</span> · `:''}<span class="ex" style="font-size:12px;font-weight:700">-${fmt(g.exp)}</span></span></button>`;
        if(mo){h+=`<div class="items">`;
          g.items.forEach(r=>{const c=getCat(r.type,r.cat),inc=r.type==='income',project=projectForId(r.projectId),scene=project?project.name:r.tag;
            const beneficiary=!inc?(BENEFICIARIES[r.beneficiaryId]||'未标注'):'';h+=`<div class="item"><div class="mid"><div class="tt">${c.subs[r.sub]}<span class="cat">${c.name}</span>${beneficiary?`<span class="tagmini">${beneficiary}</span>`:''}${scene?`<span class="tagmini">${esc(scene)}</span>`:''}</div><div class="sub">${+r.date.slice(8)}日${r.note?' · '+esc(r.note):''}</div></div><div class="amt ${inc?'in-c':'ex-c'}">${inc?'+':'-'}¥${fmt(r.amountCents)}</div><button class="more" data-action="open-record-actions" data-value="${r.id}" aria-label="${inc?'查看历史收入':'管理这笔支出'}">${inc?'›':'⋯'}</button></div>`;});
          h+=`</div>`;}
        h+=`</div>`;});
      h+=`</div>`;}
    h+=`</div>`;});
  return h;
}

/* ============ 交互 ============ */
function setView(v){state.view=v;render();}
function setTab(t){if(!['home','details','planning'].includes(t))return;state.tab=t;if(t==='home'){state.view='month';const anchor=dateFromString(state.calendarAnchor);if(anchor.getFullYear()!==state.year||anchor.getMonth()!==state.month)state.calendarAnchor=dateString(new Date(state.year,state.month,1));}else if(t==='planning')state.view='month';render();}
function openPlanning(){state.tab='planning';state.planningView='budget';state.view='month';render();}
function setPlanningView(value){if(!['budget','projects','goals','summary'].includes(value))return;state.planningView=value;render();}
function shift(d){if(state.view==='year'){state.year+=d;render();return;}let m=state.month+d,y=state.year;if(m>11){m=0;y++;}if(m<0){m=11;y--;}state.month=m;state.year=y;render();}
function goToday(){const date=new Date();state.view='month';state.year=date.getFullYear();state.month=date.getMonth();state.calendarAnchor=todayStr();render();}
function shiftCalendar(direction){
  const date=dateFromString(state.calendarAnchor);if(state.calendarExpanded){date.setDate(1);date.setMonth(date.getMonth()+direction);}else date.setDate(date.getDate()+direction*7);
  state.calendarAnchor=dateString(date);state.year=date.getFullYear();state.month=date.getMonth();state.view='month';render();
}
function toggleCalendar(){state.calendarExpanded=!state.calendarExpanded;render();}
function togY(y){state.openYears[y]=!state.openYears[y];render();}
function togM(ym){state.openMonths[ym]=!state.openMonths[ym];render();}
function applyFilters(){
  const keyword=document.getElementById('filterKeyword').value.trim().slice(0,40);
  const type=document.getElementById('filterType').value;
  const range=document.getElementById('filterRange').value;
  let start=document.getElementById('filterStart').value,end=document.getElementById('filterEnd').value;
  if(range==='custom'){
    if(!start&&!end){toast('请至少选择一个自定义日期');return;}
    if(start&&!validDate(start)||end&&!validDate(end)){toast('请输入正确的日期');return;}
    if(start&&end&&start>end){toast('开始日期不能晚于结束日期');return;}
  }else{start='';end='';}
  state.filters={keyword,type,range,start,end};render();
}
function toggleFilters(){const box=document.querySelector('.filter-advanced'),button=document.querySelector('[data-action="toggle-filters"]'),willOpen=box?box.classList.contains('hidden'):!state.filtersExpanded;state.filtersExpanded=willOpen;if(box)box.classList.toggle('hidden',!willOpen);if(button)button.textContent=willOpen?'收起筛选条件':'更多筛选条件';}
function clearFilters(){state.filters=defaultFilters();state.filtersExpanded=false;render();}
function readBudgetInput(element){
  const raw=element.value.trim();if(!raw)return null;
  if(!/^\d+(?:\.\d{1,2})?$/.test(raw))return false;
  const cents=Math.round(Number(raw)*100);return Number.isSafeInteger(cents)&&cents>0?cents:false;
}
function saveBudget(){
  const availableCents=readBudgetInput(document.getElementById('budgetAvailable')),totalCents=readBudgetInput(document.getElementById('budgetTotal'));
  if(availableCents===false){toast('可支配金额最多保留两位小数');return;}if(totalCents===false){toast('日常预算最多保留两位小数');return;}
  if(availableCents===null&&totalCents===null){toast('请至少填写可支配金额或日常预算');return;}
  const key=monthKey(),old=decisions.budgets[key],nowIso=new Date().toISOString();
  decisions.budgets[key]={totalCents,availableCents,categories:old&&old.categories?old.categories:{},updatedAt:nowIso};
  if(!saveDecisions()){if(old)decisions.budgets[key]=old;else delete decisions.budgets[key];return;}
  render();toast('本月计划已保存');
}
function copyPreviousBudget(){
  const key=monthKey(),source=decisions.budgets[previousMonthKey(key)];if(!source){toast('上月没有可复制的预算');return;}
  const old=decisions.budgets[key];decisions.budgets[key]={totalCents:source.totalCents??null,availableCents:source.availableCents??null,categories:old&&old.categories?old.categories:{},updatedAt:new Date().toISOString()};
  if(!saveDecisions()){if(old)decisions.budgets[key]=old;else delete decisions.budgets[key];return;}
  render();toast('已复制上月计划');
}
function saveReview(){
  const today=new Date(),key=monthKey(),currentKey=monthKey(today.getFullYear(),today.getMonth());if(key>currentKey)return;
  const highlight=document.getElementById('reviewHighlight').value.trim().slice(0,120),old=decisions.reviews[key]||null,adjustment=old?old.adjustment:'',nowIso=new Date().toISOString(),input=document.getElementById('reviewAction'),text=input.value.trim().slice(0,40),actions=old?old.actions.slice(1):[];
  if(text){const previous=old&&old.actions.find(item=>item.id===input.dataset.id);actions.unshift(previous?{...previous,text}:{id:uuid(),text,done:false,createdAt:nowIso,completedAt:''});}
  if(!highlight&&!adjustment&&!actions.length){toast('请至少填写一项复盘内容');return;}
  decisions.reviews[key]={highlight,adjustment,actions,updatedAt:nowIso};
  if(!saveDecisions()){if(old)decisions.reviews[key]=old;else delete decisions.reviews[key];return;}
  render();toast('本月复盘已保存');
}
function toggleReviewAction(value){
  const slash=value.indexOf('/'),month=value.slice(0,slash),id=value.slice(slash+1),review=decisions.reviews[month];if(!validYearMonth(month)||!review)return;
  const index=review.actions.findIndex(item=>item.id===id);if(index<0)return;
  const old=review.actions[index],done=!old.done;review.actions[index]={...old,done,completedAt:done?new Date().toISOString():''};review.updatedAt=new Date().toISOString();
  if(!saveDecisions()){review.actions[index]=old;return;}
  render();toast(done?'行动已完成':'行动已恢复为待办');
}
let projectFormId=null;
function openProjectForm(id=null){
  const project=id?decisions.projects.find(item=>item.id===id):null;projectFormId=project?project.id:null;const options=Object.entries(PROJECT_TYPES).map(([key,item])=>`<option value="${key}"${project&&project.type===key?' selected':''}>${item.emoji} ${item.name}</option>`).join('');
  document.getElementById('modals').innerHTML=`<div class="overlay" data-action="close-overlay"><div class="sheet" role="dialog" aria-modal="true" aria-label="${project?'编辑专项计划':'新建专项计划'}"><div class="sheet-head"><div class="r1"><h3>🧳 ${project?'编辑专项':'新建专项'}</h3><button class="x" data-action="close-modal" aria-label="关闭">✕</button></div></div><div class="sheet-body"><div class="field"><label for="projectName">专项名称</label><input id="projectName" type="text" maxlength="20" placeholder="如：2026 北京旅行" value="${project?esc(project.name):''}"></div><div class="field"><label for="projectType">专项类型</label><select id="projectType">${options}</select></div><div class="field" id="projectPeopleField" style="display:${!project||project.type==='travel'?'block':'none'}"><label for="projectPeople">旅行参与人数</label><input id="projectPeople" type="number" inputmode="numeric" min="1" max="20" step="1" placeholder="选填" value="${project&&project.type==='travel'&&project.people?project.people:''}"></div><div class="field"><label for="projectBudget">专项预算（元） <span style="color:#cbd5e1;font-weight:500">（选填）</span></label><input id="projectBudget" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="暂不设置" value="${project&&project.budgetCents?(project.budgetCents/100).toFixed(2):''}"></div><div class="two"><div class="field"><label for="projectStart">开始日期</label><input id="projectStart" type="date" value="${project?project.startDate:todayStr()}"></div><div class="field"><label for="projectEnd">结束日期</label><input id="projectEnd" type="date" value="${project?project.endDate:todayStr()}"></div></div><p class="planning-note" style="margin:0">只有旅行专项使用参与人数计算人均费用；未设置预算时仍可归集实际支出。</p></div><div class="sheet-foot"><button class="save-btn e" data-action="save-project">保存专项计划</button></div></div></div>`;document.body.style.overflow='hidden';document.querySelector('#modals .x').focus({preventScroll:true});
}
function saveProject(){
  const name=document.getElementById('projectName').value.trim().slice(0,20),type=document.getElementById('projectType').value,budgetInput=readBudgetInput(document.getElementById('projectBudget')),budgetCents=budgetInput===null?0:budgetInput,startDate=document.getElementById('projectStart').value,endDate=document.getElementById('projectEnd').value,peopleRaw=document.getElementById('projectPeople').value.trim(),people=type==='travel'&&peopleRaw?Number(peopleRaw):null;
  if(!name){toast('请填写专项名称');return;}if(!PROJECT_TYPES[type]){toast('请选择专项类型');return;}if(budgetCents===false){toast('请输入正确的专项预算');return;}if(!validDate(startDate)||!validDate(endDate)||startDate>endDate){toast('请输入正确的专项日期范围');return;}if(people!==null&&(!Number.isInteger(people)||people<1||people>20)){toast('参与人数应为 1 至 20 人');return;}
  const index=projectFormId?decisions.projects.findIndex(item=>item.id===projectFormId):-1,old=index>=0?decisions.projects[index]:null,nowIso=new Date().toISOString(),next=old?{...old,name,type,budgetCents,startDate,endDate,people,updatedAt:nowIso}:{id:uuid(),name,type,budgetCents,startDate,endDate,people,status:'active',createdAt:nowIso,updatedAt:nowIso};
  if(index>=0)decisions.projects[index]=next;else decisions.projects.push(next);const oldCurrent=decisions.currentProjectId,madeCurrent=!old&&!oldCurrent&&next.status==='active';if(madeCurrent)decisions.currentProjectId=next.id;
  if(!saveDecisions()){if(index>=0)decisions.projects[index]=old;else decisions.projects.pop();decisions.currentProjectId=oldCurrent;return;}
  closeModals();render();toast(old?'专项计划已更新':madeCurrent?'专项计划已创建并设为当前':'专项计划已创建');
}
function setCurrentProject(id){
  const old=decisions.currentProjectId;if(id&&!decisions.projects.some(project=>project.id===id&&project.status==='active'))return;decisions.currentProjectId=id;
  if(!saveDecisions()){decisions.currentProjectId=old;return;}render();toast(id?'已设为当前专项':'已取消当前专项');
}
function setProjectStatus(value){
  const slash=value.lastIndexOf('/'),id=value.slice(0,slash),status=value.slice(slash+1),index=decisions.projects.findIndex(project=>project.id===id);if(index<0||!PROJECT_STATUSES[status])return;const old=decisions.projects[index],oldCurrent=decisions.currentProjectId;decisions.projects[index]={...old,status,updatedAt:new Date().toISOString()};if(status!=='active'&&oldCurrent===id)decisions.currentProjectId='';
  if(!saveDecisions()){decisions.projects[index]=old;decisions.currentProjectId=oldCurrent;return;}render();toast(status==='active'?'专项已重新启用':'专项已完成');
}
function openProject(id){
  const project=decisions.projects.find(item=>item.id===id);if(!project)return;const type=PROJECT_TYPES[project.type],metrics=calculateProject(project),byCat={};metrics.items.forEach(item=>{byCat[item.cat]=(byCat[item.cat]||0)+item.amountCents;});const cats=Object.entries(byCat).map(([key,value])=>({cat:EXPENSE_CATS[key],value})).sort((a,b)=>b.value-a.value),items=[...metrics.items].sort((a,b)=>b.date.localeCompare(a.date)||b.updatedAt.localeCompare(a.updatedAt)),level=budgetLevel(metrics.percent);
  const stats=project.type==='travel'?`<div>天数<b>${metrics.days} 天</b></div><div>人均<b>¥${fmt(metrics.perPersonCents)}</b></div><div>人均每天<b>¥${fmt(metrics.perPersonDayCents)}</b></div>`:`<div>周期<b>${metrics.days} 天</b></div><div>记录<b>${metrics.items.length} 笔</b></div><div>${project.budgetCents?'剩余':'预算'}<b>${project.budgetCents?`¥${fmt(Math.max(0,metrics.remainingCents))}`:'未设置'}</b></div>`,budget=project.budgetCents?`<div class="budget-progress"><div class="fill ${level}" style="width:${Math.min(100,metrics.percent)}%"></div></div><div class="budget-caption"><span>预算 ¥${fmt(project.budgetCents)}</span><span>${metrics.percent.toFixed(1)}%</span></div>`:`<div class="budget-caption"><span>未设置专项预算</span><span>只统计实际支出</span></div>`;
  let h=`<div class="overlay" data-action="close-overlay"><div class="sheet" role="dialog" aria-modal="true" aria-label="专项详情"><div class="sheet-head"><div class="r1"><div><h3>${type.emoji} ${esc(project.name)}</h3><p style="font-size:12px;color:#94a3b8;margin-top:3px">${project.startDate} 至 ${project.endDate} · ${PROJECT_STATUSES[project.status]}</p></div><button class="x" data-action="close-modal" aria-label="关闭">✕</button></div></div><div class="sheet-body"><div class="td-box"><div class="l">专项总花费</div><div class="n">¥${fmt(metrics.actualCents)}</div></div>${budget}<div class="project-stats">${stats}</div>`;
  if(cats.length){h+=`<div class="field"><label>费用构成</label>`;cats.forEach(item=>{h+=`<div class="bar-item"><div class="row"><span class="l">${esc(item.cat.name)}</span><span class="r">¥${fmt(item.value)}</span></div><div class="track"><div class="fill" style="width:${item.value/metrics.actualCents*100}%;background:${item.cat.color}"></div></div></div>`;});h+=`</div>`;}
  h+=`<div class="field"><label>支出明细（${items.length}）</label>`;if(!items.length)h+=`<div class="empty" style="padding:14px 0">还没有关联支出</div>`;items.forEach(item=>{const cat=EXPENSE_CATS[item.cat],beneficiary=BENEFICIARIES[item.beneficiaryId]||'未标注';h+=`<button class="drow" data-action="open-record-actions" data-value="${item.id}"><span><span style="display:block;color:#475569;font-weight:600">${cat.subs[item.sub]}${item.note?' · '+esc(item.note):''}</span><span style="font-size:12px;color:#cbd5e1">${item.date} · ${beneficiary}</span></span><span class="amt" style="color:#475569">¥${fmt(item.amountCents)}</span></button>`;});h+=`</div></div></div></div>`;document.getElementById('modals').innerHTML=h;document.body.style.overflow='hidden';
}
function openProjectActions(id){
  const project=decisions.projects.find(item=>item.id===id);if(!project)return;const current=project.id===decisions.currentProjectId;
  document.getElementById('modals').innerHTML=`<div class="overlay" data-action="close-overlay"><div class="sheet" role="dialog" aria-modal="true" aria-label="管理专项"><div class="sheet-head"><div class="r1"><div><h3>${PROJECT_TYPES[project.type].emoji} ${esc(project.name)}</h3><p style="font-size:12px;color:#94a3b8;margin-top:3px">${PROJECT_STATUSES[project.status]}</p></div><button class="x" data-action="close-modal" aria-label="关闭">✕</button></div></div><div class="sheet-body"><div class="record-action-list"><button data-action="edit-project" data-value="${project.id}">编辑计划</button>${project.status==='active'?`<button data-action="set-current-project" data-value="${current?'':project.id}">${current?'取消当前专项':'设为当前专项'}</button><button data-action="set-project-status" data-value="${project.id}/completed">完成专项</button>`:`<button data-action="set-project-status" data-value="${project.id}/active">重新启用专项</button>`}</div></div></div></div>`;document.body.style.overflow='hidden';
}
let goalFormId=null;
function openGoalForm(id=null){
  const goal=id?decisions.goals.find(item=>item.id===id):null;goalFormId=goal?goal.id:null;
  const options=Object.entries(GOAL_TYPES).map(([key,item])=>`<option value="${key}"${goal&&goal.type===key?' selected':''}>${item.emoji} ${item.name}</option>`).join('');
  document.getElementById('modals').innerHTML=`<div class="overlay" data-action="close-overlay"><div class="sheet" role="dialog" aria-modal="true" aria-label="${goal?'编辑财务目标':'新建财务目标'}"><div class="sheet-head"><div class="r1"><h3>🏁 ${goal?'编辑目标':'新建目标'}</h3><button class="x" data-action="close-modal" aria-label="关闭">✕</button></div></div><div class="sheet-body"><div class="field"><label for="goalName">目标名称</label><input id="goalName" type="text" maxlength="20" placeholder="如：家庭应急金" value="${goal?esc(goal.name):''}"></div><div class="field"><label for="goalType">目标类型</label><select id="goalType">${options}</select></div><div class="field"><label for="goalAmount">目标金额（元）</label><input id="goalAmount" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="0.00" value="${goal?(goal.targetCents/100).toFixed(2):''}"></div><div class="field"><label for="goalDate">目标日期</label><input id="goalDate" type="date" value="${goal?goal.targetDate:''}"></div><p class="planning-note" style="margin:0">保存后会根据剩余金额和目标日期计算建议月投入；已有投入记录不会因编辑目标而丢失。</p></div><div class="sheet-foot"><button class="save-btn e" data-action="save-goal">保存目标</button></div></div></div>`;
  document.body.style.overflow='hidden';document.querySelector('#modals .x').focus({preventScroll:true});
}
function saveGoal(){
  const name=document.getElementById('goalName').value.trim().slice(0,20),type=document.getElementById('goalType').value,targetCents=readBudgetInput(document.getElementById('goalAmount')),targetDate=document.getElementById('goalDate').value;
  if(!name){toast('请填写目标名称');return;}if(!GOAL_TYPES[type]){toast('请选择目标类型');return;}if(targetCents===null||targetCents===false){toast('请输入正确的目标金额');return;}if(!validDate(targetDate)){toast('请选择正确的目标日期');return;}
  const index=goalFormId?decisions.goals.findIndex(item=>item.id===goalFormId):-1,nowIso=new Date().toISOString(),old=index>=0?decisions.goals[index]:null;
  const next=old?{...old,name,type,targetCents,targetDate,updatedAt:nowIso}:{id:uuid(),name,type,targetCents,targetDate,status:'active',contributions:[],createdAt:nowIso,updatedAt:nowIso};
  if(index>=0)decisions.goals[index]=next;else decisions.goals.push(next);
  if(!saveDecisions()){if(index>=0)decisions.goals[index]=old;else decisions.goals.pop();return;}
  closeModals();render();toast(old?'目标已更新':'目标已创建');
}
function openGoalActions(id){
  const goal=decisions.goals.find(item=>item.id===id);if(!goal)return;const metrics=calculateGoal(goal),statusAction=goal.status==='completed'?`<button data-action="set-goal-status" data-value="${goal.id}/active">重新启用目标</button>`:goal.status==='paused'?`<button data-action="set-goal-status" data-value="${goal.id}/active">恢复目标</button>`:metrics.remainingCents===0?`<button data-action="set-goal-status" data-value="${goal.id}/completed">标记目标完成</button>`:`<button data-action="set-goal-status" data-value="${goal.id}/paused">暂停目标</button>`;
  document.getElementById('modals').innerHTML=`<div class="overlay" data-action="close-overlay"><div class="sheet" role="dialog" aria-modal="true" aria-label="管理财务目标"><div class="sheet-head"><div class="r1"><div><h3>${GOAL_TYPES[goal.type].emoji} ${esc(goal.name)}</h3><p style="font-size:12px;color:#94a3b8;margin-top:3px">${GOAL_STATUSES[goal.status]} · 已投入 ¥${fmt(metrics.savedCents)}</p></div><button class="x" data-action="close-modal" aria-label="关闭">✕</button></div></div><div class="sheet-body"><div class="record-action-list"><button data-action="edit-goal" data-value="${goal.id}">编辑目标</button>${goal.contributions.length?`<button data-action="open-contribution-history" data-value="${goal.id}">查看和纠正投入记录</button>`:''}${statusAction}</div></div></div></div>`;document.body.style.overflow='hidden';
}
let contributionForm={goalId:null,id:null};
function splitContributionValue(value){const slash=value.lastIndexOf('/');return slash>0?[value.slice(0,slash),value.slice(slash+1)]:[value,''];}
function openContribution(goalId,contributionId=null){
  const goal=decisions.goals.find(item=>item.id===goalId),contribution=goal&&contributionId?goal.contributions.find(item=>item.id===contributionId):null;if(!goal||contributionId&&!contribution||!contribution&&goal.status!=='active')return;
  contributionForm={goalId:goal.id,id:contribution?contribution.id:null};const metrics=calculateGoal(goal);
  document.getElementById('modals').innerHTML=`<div class="overlay" data-action="close-overlay"><div class="sheet" role="dialog" aria-modal="true" aria-label="${contribution?'编辑目标投入':'记录目标投入'}"><div class="sheet-head"><div class="r1"><div><h3>💰 ${contribution?'编辑目标投入':'记录目标投入'}</h3><p style="font-size:12px;color:#94a3b8;margin-top:3px">${esc(goal.name)} · 还差 ¥${fmt(metrics.remainingCents)}</p></div><button class="x" data-action="close-modal" aria-label="关闭">✕</button></div></div><div class="sheet-body"><div class="field"><label for="contributionAmount">本次已留出金额（元）</label><input id="contributionAmount" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="0.00" value="${contribution?(contribution.amountCents/100).toFixed(2):''}"></div><div class="two"><div class="field"><label for="contributionDate">投入日期</label><input id="contributionDate" type="date" value="${contribution?contribution.date:todayStr()}"></div><div class="field"><label for="contributionNote">备注</label><input id="contributionNote" type="text" maxlength="20" placeholder="选填" value="${contribution?esc(contribution.note):''}"></div></div><p class="planning-note" style="margin:0">${contribution?'修改后会同步更新目标进度和对应月份复盘。':'这是一条独立的目标投入确认，不会新增支出记录。'}</p></div><div class="sheet-foot"><button class="save-btn e" data-action="save-contribution">${contribution?'保存修改':'确认已投入'}</button></div></div></div>`;
  document.body.style.overflow='hidden';document.querySelector('#modals .x').focus({preventScroll:true});
}
function saveContribution(){
  const index=decisions.goals.findIndex(item=>item.id===contributionForm.goalId);if(index<0)return;
  const existingIndex=contributionForm.id?decisions.goals[index].contributions.findIndex(item=>item.id===contributionForm.id):-1;if(contributionForm.id&&existingIndex<0||!contributionForm.id&&decisions.goals[index].status!=='active')return;
  const amountCents=readBudgetInput(document.getElementById('contributionAmount')),date=document.getElementById('contributionDate').value,note=document.getElementById('contributionNote').value.trim().slice(0,20);
  if(amountCents===null||amountCents===false){toast('请输入正确的投入金额');return;}if(!validDate(date)){toast('请选择正确的投入日期');return;}
  const old=decisions.goals[index],nowIso=new Date().toISOString(),contributions=[...old.contributions],existing=existingIndex>=0?contributions[existingIndex]:null,item=existing?{...existing,date,amountCents,note}:{id:uuid(),date,amountCents,note,createdAt:nowIso};
  if(existing)contributions[existingIndex]=item;else contributions.push(item);
  decisions.goals[index]={...old,contributions,updatedAt:nowIso};
  if(!saveDecisions()){decisions.goals[index]=old;return;}
  render();if(existing)openContributionHistory(old.id);else closeModals();toast(existing?'投入记录已更新':'目标投入已记录');
}
function openContributionHistory(goalId){
  const goal=decisions.goals.find(item=>item.id===goalId);if(!goal)return;const metrics=calculateGoal(goal),items=[...goal.contributions].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
  const rows=items.map(item=>`<div class="contribution-row"><div class="info"><div class="date">${item.date}</div><div class="note">${item.note?esc(item.note):'无备注'}</div></div><div class="amount">¥${fmt(item.amountCents)}</div><button data-action="edit-contribution" data-value="${goal.id}/${item.id}" aria-label="编辑 ${item.date} 的投入">✎</button><button data-action="confirm-delete-contribution" data-value="${goal.id}/${item.id}" aria-label="撤销 ${item.date} 的投入">🗑</button></div>`).join('');
  document.getElementById('modals').innerHTML=`<div class="overlay" data-action="close-overlay"><div class="sheet" role="dialog" aria-modal="true" aria-label="目标投入明细"><div class="sheet-head"><div class="r1"><div><h3>📒 投入明细</h3><p style="font-size:12px;color:#94a3b8;margin-top:3px">${esc(goal.name)} · ${items.length} 次</p></div><button class="x" data-action="close-modal" aria-label="关闭">✕</button></div></div><div class="sheet-body"><div class="contribution-summary">累计已投入<b>¥${fmt(metrics.savedCents)}</b></div>${items.length?`<div class="contribution-list">${rows}</div>`:'<div class="empty" style="padding:14px 0">还没有投入记录</div>'}</div></div></div>`;
  document.body.style.overflow='hidden';
}
function confirmDeleteContribution(value){
  const[goalId,id]=splitContributionValue(value),goal=decisions.goals.find(item=>item.id===goalId),item=goal&&goal.contributions.find(entry=>entry.id===id);if(!goal||!item)return;
  document.getElementById('modals').innerHTML=`<div class="overlay" data-action="close-overlay"><div class="sheet" role="dialog" aria-modal="true" aria-label="确认撤销目标投入"><div class="sheet-head"><div class="r1"><h3>撤销这笔投入？</h3><button class="x" data-action="close-modal" aria-label="关闭">✕</button></div></div><div class="sheet-body"><p style="font-size:14px;color:#64748b;line-height:1.7">${esc(goal.name)}<br>${item.date} · ¥${fmt(item.amountCents)}${item.note?` · ${esc(item.note)}`:''}</p><p class="planning-note" style="margin:12px 0 0">撤销后会同步减少目标进度和对应月份的投入汇总。</p></div><div class="sheet-foot"><button class="danger-btn" data-action="delete-contribution" data-value="${goal.id}/${item.id}">确认撤销投入</button></div></div></div>`;
}
function deleteContribution(value){
  const[goalId,id]=splitContributionValue(value),index=decisions.goals.findIndex(item=>item.id===goalId);if(index<0)return;const old=decisions.goals[index],next=old.contributions.filter(item=>item.id!==id);if(next.length===old.contributions.length)return;
  decisions.goals[index]={...old,contributions:next,updatedAt:new Date().toISOString()};if(!saveDecisions()){decisions.goals[index]=old;return;}
  render();if(next.length)openContributionHistory(goalId);else closeModals();toast('投入记录已撤销');
}
function setGoalStatus(value){
  const slash=value.lastIndexOf('/'),id=value.slice(0,slash),status=value.slice(slash+1),index=decisions.goals.findIndex(item=>item.id===id);if(index<0||!GOAL_STATUSES[status])return;
  const old=decisions.goals[index];decisions.goals[index]={...old,status,updatedAt:new Date().toISOString()};
  if(!saveDecisions()){decisions.goals[index]=old;return;}
  render();toast(status==='paused'?'目标已暂停':status==='completed'?'目标已完成':'目标已重新启用');
}
let deletedUndo=null,addedUndo=null;
function openRecordActions(id){
  const record=state.records.find(item=>item.id===id);if(!record)return;const cat=getCat(record.type,record.cat);
  const beneficiary=record.type==='expense'?(BENEFICIARIES[record.beneficiaryId]||'未标注'):'';
  const content=record.type==='income'?`<p style="font-size:14px;color:#64748b;line-height:1.7">这是停用逐笔收入前保留的历史记录。它会继续出现在明细、备份和导入中，但不能复制、编辑或删除。</p>`:`<div class="record-action-list"><button data-action="copy-record" data-value="${record.id}">复制为新记录</button><button data-action="edit-record" data-value="${record.id}">编辑这笔记录</button><button class="danger" data-action="delete-record" data-value="${record.id}">删除，可在 12 秒内撤销</button></div>`;
  document.getElementById('modals').innerHTML=`<div class="overlay" data-action="close-overlay"><div class="sheet" role="dialog" aria-modal="true" aria-label="${record.type==='income'?'历史收入记录':'管理记录'}"><div class="sheet-head"><div class="r1"><div><h3>${cat.subs[record.sub]}</h3><p style="font-size:12px;color:#94a3b8;margin-top:3px">${record.date} · ¥${fmt(record.amountCents)}${beneficiary?` · ${beneficiary}`:''}</p></div><button class="x" data-action="close-modal" aria-label="关闭">✕</button></div></div><div class="sheet-body">${content}</div></div></div>`;document.body.style.overflow='hidden';
}
function delRec(id){
  const index=state.records.findIndex(r=>r.id===id);if(index<0)return;
  const record=state.records[index];if(record.type!=='expense')return;
  const next=state.records.filter(r=>r.id!==id);
  if(!persist(next))return;
  if(addedUndo&&addedUndo.record.id===id){clearTimeout(addedUndo.timer);addedUndo=null;}
  if(deletedUndo)clearTimeout(deletedUndo.timer);
  state.records=next;deletedUndo={record,index,timer:setTimeout(()=>{deletedUndo=null;},12000)};
  render();toast('已删除一笔记录','undo-delete');
}
function undoDelete(){
  if(!deletedUndo)return;
  const next=[...state.records];next.splice(Math.min(deletedUndo.index,next.length),0,deletedUndo.record);
  if(!persist(next))return;
  clearTimeout(deletedUndo.timer);deletedUndo=null;state.records=next;render();toast('已恢复记录');
}
function undoAdd(){
  if(!addedUndo)return;const next=state.records.filter(record=>record.id!==addedUndo.record.id);if(next.length===state.records.length)return;
  if(!persist(next))return;const restoreDate=addedUndo.removedNoSpend?addedUndo.record.date:'';if(restoreDate&&!decisions.noSpendDates.includes(restoreDate)){const oldDates=decisions.noSpendDates;decisions.noSpendDates=[...oldDates,restoreDate].sort();if(!saveDecisions())decisions.noSpendDates=oldDates;}clearTimeout(addedUndo.timer);addedUndo=null;state.records=next;render();toast('已撤销刚才的记录');
}
function openCalendarDay(date){
  if(!validDate(date))return;if(date>todayStr()){toast('未来日期暂不记账');return;}
  const records=state.records.filter(record=>record.type==='expense'&&record.date===date);if(records.length)openDayDetails(date);else openRecordForm(null,{date});
}
function openDayDetails(date){
  const records=state.records.filter(record=>record.type==='expense'&&record.date===date).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),total=records.reduce((sum,record)=>sum+record.amountCents,0),label=dateFromString(date).toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});
  let rows='';records.forEach(record=>{const cat=EXPENSE_CATS[record.cat],project=projectForId(record.projectId),scene=project?project.name:record.tag,beneficiary=BENEFICIARIES[record.beneficiaryId]||'未标注';rows+=`<button class="drow" data-action="open-record-actions" data-value="${record.id}"><span style="color:#475569;font-weight:700">${cat.subs[record.sub]}${record.note?` · ${esc(record.note)}`:''}</span><span class="tagmini">${beneficiary}</span>${scene?`<span class="tagmini">${esc(scene)}</span>`:''}<span class="amt ex-c">-¥${fmt(record.amountCents)}</span></button>`;});
  document.getElementById('modals').innerHTML=`<div class="overlay" data-action="close-overlay"><div class="sheet" role="dialog" aria-modal="true" aria-label="当日支出"><div class="sheet-head"><div class="r1"><div><h3>📅 ${label}</h3><p style="font-size:12px;color:#94a3b8;margin-top:3px">${records.length} 笔支出</p></div><button class="x" data-action="close-modal" aria-label="关闭">✕</button></div></div><div class="sheet-body"><div class="day-sheet-total">当日支出<b>¥${fmt(total)}</b></div>${rows}</div><div class="sheet-foot"><button class="save-btn e" data-action="add-for-date" data-value="${date}">＋ 再记一笔</button></div></div></div>`;document.body.style.overflow='hidden';document.querySelector('#modals .x').focus({preventScroll:true});
}
function toggleFormNoSpend(){
  const input=document.getElementById('fDate'),date=input?input.value:'';if(!validDate(date)||date>todayStr())return;
  if(state.records.some(record=>record.type==='expense'&&record.date===date)){toast('这天已有支出，不能标记无支出');return;}
  const oldDates=decisions.noSpendDates,exists=oldDates.includes(date);decisions.noSpendDates=exists?oldDates.filter(item=>item!==date):[...oldDates,date].sort();
  if(!saveDecisions()){decisions.noSpendDates=oldDates;return;}const selected=dateFromString(date);state.calendarAnchor=date;state.year=selected.getFullYear();state.month=selected.getMonth();closeModals();render();toast(exists?'已取消无支出确认':'已确认当日无支出');
}

/* ============ 记账弹窗 ============ */
let form={id:null,cat:'food',sub:'vegetable',beneficiaryId:'family',projectId:'',projectTouched:false,showMore:false,sourceTag:''};
function todayStr(){const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function recordsForFormContext(){return state.records.filter(record=>record.type==='expense'&&(form.projectId?record.projectId===form.projectId:!record.projectId&&record.beneficiaryId===form.beneficiaryId));}
function recentExpenseRecord(){
  return recordsForFormContext().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]||null;
}
function frequentChoices(limit=6){
  const counts=new Map();recordsForFormContext().forEach(record=>{const key=`${record.cat}/${record.sub}`,old=counts.get(key)||{value:key,count:0,latest:''};old.count++;if(record.date>old.latest)old.latest=record.date;counts.set(key,old);});
  const values=[],recent=recentExpenseRecord();if(recent&&choiceVisible(recent.cat,recent.sub))values.push(`${recent.cat}/${recent.sub}`);
  [...counts.values()].sort((a,b)=>b.count-a.count||b.latest.localeCompare(a.latest)).forEach(item=>{if(values.length<limit&&!values.includes(item.value))values.push(item.value);});
  return values.filter(value=>{const[cat,sub]=value.split('/');return choiceVisible(cat,sub);});
}
function choiceVisible(cat,sub){const group=EXPENSE_CATS[cat],config=group&&group.subConfig[sub];return !!(group&&group.active&&config&&config.active&&(form.projectId||config.roles.includes(form.beneficiaryId)));}
function ensureFormChoice(){if(choiceVisible(form.cat,form.sub))return;for(const[cat,group]of Object.entries(EXPENSE_CATS)){for(const sub of Object.keys(group.subs)){if(choiceVisible(cat,sub)){form.cat=cat;form.sub=sub;return;}}}}
function contextProject(){const selected=projectForId(form.projectId);if(selected)return selected;const input=document.getElementById('fDate'),date=input?input.value:todayStr(),current=projectForId(decisions.currentProjectId);return projectAppliesOn(current,date)?current:null;}
function renderRecordContext(){
  const container=document.getElementById('recordContext'),project=contextProject(),items=Object.entries(BENEFICIARIES).map(([id,name])=>({value:id,name,on:!form.projectId&&form.beneficiaryId===id}));if(project)items.push({value:`project:${project.id}`,name:project.name,on:form.projectId===project.id});container.className=`record-context ${items.length===5?'five':'four'}`;container.innerHTML=items.map(item=>`<button class="${item.on?'on':''}" data-action="select-record-context" data-value="${item.value}" title="${esc(item.name)}">${esc(item.name)}</button>`).join('');
}
function selectRecordContext(value){
  if(value.startsWith('project:')){const project=projectForId(value.slice(8));if(!project)return;form.projectId=project.id;form.beneficiaryId='family';}
  else{if(!BENEFICIARIES[value])return;form.beneficiaryId=value;form.projectId='';}
  form.projectTouched=true;const select=document.getElementById('fProject');if(select)select.value=form.projectId;ensureFormChoice();renderRecordContext();renderQuickChoices();renderCategoryGroups();
}
function openRecordForm(id=null,preset=null){
  const record=id?state.records.find(r=>r.id===id):null;
  if(record&&record.type==='income'){toast('历史收入记录仅保留查看');return;}
  const source=record||preset;
  form.id=record?record.id:null;form.sourceTag=source&&source.tag?source.tag:'';
  const obj=EXPENSE_CATS,recent=prefs.recent.expense;
  form.cat=source&&validChoice('expense',source.cat,source.sub)?source.cat:recent?recent.cat:Object.keys(obj)[0];
  form.sub=source&&validChoice('expense',source.cat,source.sub)?source.sub:recent?recent.sub:Object.keys(obj[form.cat].subs)[0];
  const sourceDate=source&&validDate(source.date||'')?source.date:todayStr(),sourceProject=source&&projectForId(source.projectId),currentProject=projectForId(decisions.currentProjectId),autoProject=!record&&!sourceProject&&projectAppliesOn(currentProject,sourceDate);form.projectId=sourceProject?sourceProject.id:autoProject?currentProject.id:'';form.beneficiaryId=source&&BENEFICIARIES[source.beneficiaryId]?source.beneficiaryId:'family';if(form.projectId&&!BENEFICIARIES[source&&source.beneficiaryId])form.beneficiaryId='family';form.projectTouched=false;
  form.showMore=!!record||!!(source&&(source.date&&source.date!==todayStr()||sourceProject));
  const availableProjects=decisions.projects.filter(project=>project.status==='active'||project.id===form.projectId),projectOptions=availableProjects.map(project=>`<option value="${project.id}"${project.id===form.projectId?' selected':''}>${PROJECT_TYPES[project.type].emoji} ${esc(project.name)}${project.id===decisions.currentProjectId?' · 当前':''}</option>`).join('');
  const h=`<div class="overlay" data-action="close-overlay"><div class="sheet" role="dialog" aria-modal="true" aria-label="${record?'修改记录':'新增记录'}">
    <div class="sheet-head"><div class="r1"><div><h3>✏️ ${record?'修改支出':'快速记账'}</h3><p style="font-size:12px;color:#94a3b8;margin-top:3px">${sourceDate}${record?' · 修改后保存':' · 点击分类直接保存'}</p></div><button class="x" data-action="close-modal" aria-label="关闭">✕</button></div></div>
    <div class="sheet-body">
      <div class="record-main"><div class="field"><label for="fAmt">金额</label><div class="amount-box e"><span class="y">¥</span><input id="fAmt" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="0.00" value="${source&&source.amountCents?(source.amountCents/100).toFixed(2):''}"></div></div><div class="field"><label for="fNote">备注</label><input id="fNote" type="text" maxlength="20" placeholder="选填" value="${source?esc(source.note||''):''}"></div></div>
      <div class="record-context" id="recordContext"></div>
      <div class="quick-guidance">${record?'选择分类后点击底部保存':'输入金额后，点击分类即可完成'}</div>
      <div class="field" id="quickField"><label>最近和常用</label><div class="quick-picks" id="quickPicks"></div></div>
      <div class="field"><label>${record?'全部分类 · 选择细分类':'全部分类 · 点击细分类直接保存'}</label><div class="category-groups" id="categoryGroups"></div></div>
      <button class="record-toggle" data-action="toggle-record-section" data-value="more">${form.showMore?'收起更多选项':'日期与专项'}</button>
      <div id="recordMore" class="record-more ${form.showMore?'':'hidden'}"><div class="field"><label for="fProject">所属专项 <span style="color:#cbd5e1;font-weight:500">（选填）</span></label><select id="fProject"><option value="">${availableProjects.length?'日常支出，不关联专项':'暂无进行中的正式专项'}</option>${projectOptions}</select></div><div class="field" style="margin:0"><label for="fDate">日期</label><input id="fDate" type="date" value="${sourceDate}"></div></div>
      ${record?'':`<button id="noSpendButton" class="no-spend-action" data-action="toggle-form-no-spend">${decisions.noSpendDates.includes(sourceDate)?'取消“当日无支出”确认':'确认当日无支出'}</button>`}
    </div>${record?`<div class="sheet-foot"><button class="save-btn e" data-action="save-record">保存修改</button></div>`:''}
  </div></div>`;
  document.getElementById('modals').innerHTML=h;document.body.style.overflow='hidden';
  ensureFormChoice();renderRecordContext();renderQuickChoices();renderCategoryGroups();refreshNoSpendButton();document.querySelector('#modals .x').focus({preventScroll:true});
}
function renderQuickChoices(){
  const recentRecord=recentExpenseRecord(),values=frequentChoices();
  const field=document.getElementById('quickField');
  if(!values.length){field.style.display='none';return;}
  field.style.display='block';
  document.getElementById('quickPicks').innerHTML=values.map(value=>{const[cat,sub]=value.split('/'),item=EXPENSE_CATS[cat],isRecent=!!recentRecord&&value===`${recentRecord.cat}/${recentRecord.sub}`,action=isRecent?(form.id?'select-recent':'recent-save'):(form.id?'select-quick':'quick-save'),detail=isRecent?`<span>${recentRecord.note?`最近一笔 · ${esc(recentRecord.note)}`:'最近一笔'}</span>`:'';return`<button data-action="${action}" data-value="${value}">${item.subs[sub]}${detail}</button>`;}).join('');
}
function renderCategoryGroups(){
  let h='';Object.entries(EXPENSE_CATS).forEach(([cat,c])=>{const subs=Object.entries(c.subs).filter(([sub])=>choiceVisible(cat,sub));if(!subs.length)return;h+=`<div class="category-group"><div class="category-title">${esc(c.name)}</div><div class="sub-list">`;subs.forEach(([sub,name])=>{const on=form.cat===cat&&form.sub===sub;h+=`<button class="${on?'on':''}" style="${on?'background:'+c.color:''}" data-action="select-category-choice" data-value="${cat}/${sub}">${esc(name)}</button>`;});h+='</div></div>';});
  document.getElementById('categoryGroups').innerHTML=h||'<div class="empty" style="padding:12px 0">当前角色没有可用分类，请到“数据—分类管理”中配置。</div>';
}
function toggleRecordSection(value){
  if(value==='more'){form.showMore=!form.showMore;document.getElementById('recordMore').classList.toggle('hidden',!form.showMore);const button=document.querySelector('[data-action="toggle-record-section"][data-value="more"]');if(button)button.textContent=form.showMore?'收起更多选项':'日期与专项';}
}
function refreshProjectForDate(){
  refreshNoSpendButton();if(form.id||form.projectTouched)return;
  const date=document.getElementById('fDate').value,current=projectForId(decisions.currentProjectId),select=document.getElementById('fProject'),applies=projectAppliesOn(current,date);
  select.value=applies?current.id:'';form.projectId=select.value;if(form.projectId)form.beneficiaryId='family';ensureFormChoice();renderRecordContext();renderQuickChoices();renderCategoryGroups();
}
function refreshNoSpendButton(){const button=document.getElementById('noSpendButton'),input=document.getElementById('fDate');if(!button||!input)return;const date=input.value;button.style.display=validDate(date)&&date<=todayStr()?'block':'none';button.textContent=decisions.noSpendDates.includes(date)?'取消“当日无支出”确认':'确认当日无支出';}
function selQuick(value,save=false,useRecentNote=false){const[cat,sub]=value.split('/');if(!validChoice('expense',cat,sub))return;form.cat=cat;form.sub=sub;if(useRecentNote){const input=document.getElementById('fNote'),recentRecord=recentExpenseRecord();if(input&&!input.value.trim()&&recentRecord&&recentRecord.note)input.value=recentRecord.note;}renderCategoryGroups();if(save)doSave();}
function readAmount(){
  const rawAmount=document.getElementById('fAmt').value.trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(rawAmount)){toast('金额最多保留两位小数');return false;}
  const amountCents=Math.round(Number(rawAmount)*100);
  if(!Number.isSafeInteger(amountCents)||amountCents<=0){toast('请输入正确的金额');return false;}
  return amountCents;
}
function doSave(){
  const amountCents=readAmount();if(amountCents===false)return;
  const date=document.getElementById('fDate').value||todayStr();
  if(!validDate(date)||!form.id&&date>todayStr()){toast(date>todayStr()?'不能记录未来支出':'请输入正确的日期');return;}
  const note=document.getElementById('fNote').value.trim();
  const tag=form.sourceTag,selectedProjectId=document.getElementById('fProject').value,projectId=projectForId(selectedProjectId)?selectedProjectId:'';
  const nowIso=new Date().toISOString(),old=form.id?state.records.find(r=>r.id===form.id):null;
  const record={id:old?old.id:uuid(),type:'expense',date,cat:form.cat,sub:form.sub,amountCents,note,tag,projectId,beneficiaryId:form.beneficiaryId,
    createdAt:old?old.createdAt:nowIso,updatedAt:nowIso};
  const next=old?state.records.map(r=>r.id===old.id?record:r):[...state.records,record];
  if(!persist(next))return;
  state.records=next;
  prefs.recent.expense={cat:form.cat,sub:form.sub,beneficiaryId:form.beneficiaryId,projectId};savePrefs();
  const removedNoSpend=decisions.noSpendDates.includes(date);if(removedNoSpend){const oldDates=decisions.noSpendDates;decisions.noSpendDates=oldDates.filter(item=>item!==date);if(!saveDecisions())decisions.noSpendDates=oldDates;}
  state.openYears[date.slice(0,4)]=true;state.openMonths[date.slice(0,7)]=true;
  state.calendarAnchor=date;const savedDate=dateFromString(date);state.year=savedDate.getFullYear();state.month=savedDate.getMonth();
  if(!old){if(addedUndo)clearTimeout(addedUndo.timer);addedUndo={record,removedNoSpend,timer:setTimeout(()=>{addedUndo=null;},12000)};}
  closeModals();render();toast(old?'修改已保存':'已记录，可撤销',old?'':'undo-add');
}
function copyRecord(id){const record=state.records.find(item=>item.id===id);if(record&&record.type==='expense')openRecordForm(null,{...record,date:todayStr()});}
let modalReturnFocus=null;
function syncModalState(){
  const modals=document.getElementById('modals'),app=document.getElementById('app'),dialog=modals.querySelector('[role="dialog"]'),hasModal=!!dialog;
  app.inert=hasModal;document.body.style.overflow=hasModal?'hidden':'';
  if(hasModal){
    if(!modalReturnFocus&&document.activeElement instanceof HTMLElement&&!modals.contains(document.activeElement))modalReturnFocus=document.activeElement;
    if(!dialog.contains(document.activeElement)){const initial=dialog.querySelector('.x,button,input,select,textarea');if(initial)initial.focus({preventScroll:true});}
  }
}
function closeModals(){
  const previous=modalReturnFocus,action=previous&&previous.dataset?previous.dataset.action:'',value=previous&&previous.dataset?previous.dataset.value:'';
  document.getElementById('modals').innerHTML='';syncModalState();
  const restore=()=>{const replacement=action?[...document.querySelectorAll(`[data-action="${action}"]`)].find(item=>(item.dataset.value||'')===(value||'')):null,target=replacement||previous;if(target&&document.contains(target))target.focus({preventScroll:true});};
  restore();setTimeout(restore,0);
  modalReturnFocus=null;
}

/* ============ 分类管理 ============ */
let categoryEditor=null;
function categoryConfigGroup(id){return prefs.categories.find(group=>group.id===id);}
function categoryRoleText(roles){return roles.length===BENEFICIARY_IDS.length?'全部角色':roles.map(role=>BENEFICIARIES[role]).join('、');}
function persistCategoryChange(previous,message){if(!savePrefs()){prefs.categories=previous;EXPENSE_CATS=categoryMap(previous);return false;}render();openCategoryManager();toast(message);return true;}
function openCategoryManager(){
  const active=prefs.categories.filter(group=>group.active),inactive=prefs.categories.filter(group=>!group.active);let groups='';
  active.forEach((group,groupIndex)=>{const activeSubs=group.subs.filter(sub=>sub.active),inactiveSubs=group.subs.filter(sub=>!sub.active);groups+=`<section class="category-manage-group"><div class="category-manage-head"><b>${esc(group.name)}</b><div class="category-manage-actions"><button data-action="move-category-group" data-value="${group.id}/-1"${groupIndex===0?' disabled':''} aria-label="上移 ${esc(group.name)}">↑</button><button data-action="move-category-group" data-value="${group.id}/1"${groupIndex===active.length-1?' disabled':''} aria-label="下移 ${esc(group.name)}">↓</button><button data-action="open-category-name" data-value="rename-group/${group.id}">改名</button><button data-action="toggle-category-group" data-value="${group.id}">停用</button></div></div><div class="category-manage-subs">`;
    activeSubs.forEach((sub,subIndex)=>{groups+=`<div class="category-manage-sub"><span class="name">${esc(sub.name)}<span class="meta">${categoryRoleText(sub.roles)}</span></span><div class="category-manage-actions"><button data-action="move-category-sub" data-value="${group.id}/${sub.id}/-1"${subIndex===0?' disabled':''} aria-label="上移 ${esc(sub.name)}">↑</button><button data-action="move-category-sub" data-value="${group.id}/${sub.id}/1"${subIndex===activeSubs.length-1?' disabled':''} aria-label="下移 ${esc(sub.name)}">↓</button><button data-action="open-category-roles" data-value="${group.id}/${sub.id}">角色</button><button data-action="open-category-name" data-value="rename-sub/${group.id}/${sub.id}">改名</button><button data-action="toggle-category-sub" data-value="${group.id}/${sub.id}">停用</button></div></div>`;});
    if(!activeSubs.length)groups+='<div class="empty" style="padding:8px 0">当前没有启用的细分类</div>';
    groups+=`</div><button class="category-manage-add" data-action="open-category-name" data-value="add-sub/${group.id}">＋ 新增细分类</button>`;
    if(inactiveSubs.length)groups+=`<div class="inactive-list"><div class="planning-note" style="margin:0 0 4px">已停用细分类</div>${inactiveSubs.map(sub=>`<div class="inactive-row"><span>${esc(sub.name)}</span><button data-action="toggle-category-sub" data-value="${group.id}/${sub.id}">恢复</button></div>`).join('')}</div>`;groups+='</section>';});
  const inactiveHtml=inactive.length?`<div class="inactive-list"><div class="planning-note" style="margin:0 0 4px">已停用大类</div>${inactive.map(group=>`<div class="inactive-row"><span>${esc(group.name)}</span><button data-action="toggle-category-group" data-value="${group.id}">恢复</button></div>`).join('')}</div>`:'';
  document.getElementById('modals').innerHTML=`<div class="overlay" data-action="close-overlay"><div class="sheet" role="dialog" aria-modal="true" aria-label="分类管理"><div class="sheet-head"><div class="r1"><div><h3>分类管理</h3><p style="font-size:12px;color:#94a3b8;margin-top:3px">分类共用稳定 ID，可分别设置在哪些角色下显示</p></div><button class="x" data-action="close-modal" aria-label="关闭">✕</button></div></div><div class="sheet-body">${groups}<button class="category-manage-add" data-action="open-category-name" data-value="add-group">＋ 新增大类</button>${inactiveHtml}<p class="planning-note" style="margin:12px 0 0">停用不会删除历史账目；完整备份会保存分类名称、顺序和角色显示设置。</p></div></div></div>`;document.body.style.overflow='hidden';document.querySelector('#modals .x').focus({preventScroll:true});
}
function openCategoryNameForm(value){
  const parts=value.split('/'),kind=parts[0],group=categoryConfigGroup(parts[1]),sub=group&&group.subs.find(item=>item.id===parts[2]);categoryEditor={kind,groupId:parts[1]||'',subId:parts[2]||''};
  const addingGroup=kind==='add-group',addingSub=kind==='add-sub',title=addingGroup?'新增大类':addingSub?'新增细分类':kind==='rename-group'?'修改大类名称':'修改细分类名称',current=kind==='rename-group'&&group?group.name:kind==='rename-sub'&&sub?sub.name:'';
  document.getElementById('modals').innerHTML=`<div class="overlay" data-action="close-overlay"><div class="sheet" role="dialog" aria-modal="true" aria-label="${title}"><div class="sheet-head"><div class="r1"><h3>${title}</h3><button class="x" data-action="open-category-manager" aria-label="返回分类管理">✕</button></div></div><div class="sheet-body"><div class="field"><label for="categoryName">${addingGroup?'大类名称':'分类名称'}</label><input id="categoryName" type="text" maxlength="12" value="${esc(current)}" placeholder="最多 12 个字"></div>${addingGroup?'<div class="field"><label for="categoryFirstSub">首个细分类</label><input id="categoryFirstSub" type="text" maxlength="12" placeholder="例如：其他"></div>':''}</div><div class="sheet-foot"><button class="save-btn e" data-action="save-category-name">保存</button></div></div></div>`;document.body.style.overflow='hidden';document.getElementById('categoryName').focus({preventScroll:true});
}
function saveCategoryName(){
  if(!categoryEditor)return;const name=document.getElementById('categoryName').value.trim().slice(0,12);if(!name){toast('请输入分类名称');return;}const previous=cloneCategoryConfig(prefs.categories),kind=categoryEditor.kind,group=categoryConfigGroup(categoryEditor.groupId);
  if(kind==='add-group'){const first=document.getElementById('categoryFirstSub').value.trim().slice(0,12);if(!first){toast('请输入首个细分类');return;}if(prefs.categories.some(item=>item.name===name)){toast('大类名称已存在');return;}prefs.categories.push({id:`cat-${uuid()}`,name,color:CATEGORY_COLORS[prefs.categories.length%CATEGORY_COLORS.length],active:true,subs:[{id:`sub-${uuid()}`,name:first,active:true,roles:[...BENEFICIARY_IDS]}]});}
  else if(kind==='add-sub'){if(!group)return;if(group.subs.some(item=>item.name===name)){toast('该大类中已有同名分类');return;}group.subs.push({id:`sub-${uuid()}`,name,active:true,roles:[...BENEFICIARY_IDS]});}
  else if(kind==='rename-group'){if(!group)return;if(prefs.categories.some(item=>item.id!==group.id&&item.name===name)){toast('大类名称已存在');return;}group.name=name;}
  else{const sub=group&&group.subs.find(item=>item.id===categoryEditor.subId);if(!sub)return;if(group.subs.some(item=>item.id!==sub.id&&item.name===name)){toast('该大类中已有同名分类');return;}sub.name=name;}
  categoryEditor=null;persistCategoryChange(previous,'分类设置已保存');
}
function moveCategoryGroup(value){const[indexValue,directionValue]=[value.slice(0,value.lastIndexOf('/')),value.slice(value.lastIndexOf('/')+1)],direction=Number(directionValue),active=prefs.categories.filter(group=>group.active),group=categoryConfigGroup(indexValue),position=active.indexOf(group),target=active[position+direction];if(!group||!target)return;const previous=cloneCategoryConfig(prefs.categories),from=prefs.categories.indexOf(group),to=prefs.categories.indexOf(target);prefs.categories.splice(from,1);prefs.categories.splice(to,0,group);persistCategoryChange(previous,'分类顺序已更新');}
function moveCategorySub(value){const parts=value.split('/'),group=categoryConfigGroup(parts[0]),sub=group&&group.subs.find(item=>item.id===parts[1]),direction=Number(parts[2]),active=group?group.subs.filter(item=>item.active):[],position=active.indexOf(sub),target=active[position+direction];if(!sub||!target)return;const previous=cloneCategoryConfig(prefs.categories),from=group.subs.indexOf(sub),to=group.subs.indexOf(target);group.subs.splice(from,1);group.subs.splice(to,0,sub);persistCategoryChange(previous,'分类顺序已更新');}
function toggleCategoryGroup(id){const group=categoryConfigGroup(id);if(!group)return;if(group.active&&prefs.categories.filter(item=>item.active).length<=1){toast('至少保留一个启用的大类');return;}const previous=cloneCategoryConfig(prefs.categories);group.active=!group.active;persistCategoryChange(previous,group.active?'大类已恢复':'大类已停用');}
function toggleCategorySub(value){const[catId,subId]=value.split('/'),group=categoryConfigGroup(catId),sub=group&&group.subs.find(item=>item.id===subId);if(!sub)return;const activeCount=prefs.categories.filter(item=>item.active).reduce((sum,item)=>sum+item.subs.filter(child=>child.active).length,0);if(sub.active&&activeCount<=1){toast('至少保留一个启用的细分类');return;}const previous=cloneCategoryConfig(prefs.categories);sub.active=!sub.active;persistCategoryChange(previous,sub.active?'细分类已恢复':'细分类已停用');}
function openCategoryRoles(value){const[catId,subId]=value.split('/'),group=categoryConfigGroup(catId),sub=group&&group.subs.find(item=>item.id===subId);if(!sub)return;categoryEditor={kind:'roles',groupId:catId,subId};const checks=Object.entries(BENEFICIARIES).map(([id,name])=>`<label><input type="checkbox" name="categoryRole" value="${id}"${sub.roles.includes(id)?' checked':''}>${name}</label>`).join('');document.getElementById('modals').innerHTML=`<div class="overlay" data-action="close-overlay"><div class="sheet" role="dialog" aria-modal="true" aria-label="设置分类角色"><div class="sheet-head"><div class="r1"><div><h3>${esc(sub.name)}</h3><p style="font-size:12px;color:#94a3b8;margin-top:3px">选择这个分类出现在哪些角色页</p></div><button class="x" data-action="open-category-manager" aria-label="返回分类管理">✕</button></div></div><div class="sheet-body"><div class="category-role-list">${checks}</div></div><div class="sheet-foot"><button class="save-btn e" data-action="save-category-roles">保存角色设置</button></div></div></div>`;document.body.style.overflow='hidden';document.querySelector('#modals .x').focus({preventScroll:true});}
function saveCategoryRoles(){if(!categoryEditor)return;const group=categoryConfigGroup(categoryEditor.groupId),sub=group&&group.subs.find(item=>item.id===categoryEditor.subId),roles=[...document.querySelectorAll('input[name="categoryRole"]:checked')].map(input=>input.value).filter(value=>BENEFICIARIES[value]);if(!sub||!roles.length){toast('至少选择一个角色');return;}const previous=cloneCategoryConfig(prefs.categories);sub.roles=roles;categoryEditor=null;persistCategoryChange(previous,'角色显示设置已保存');}

/* ============ 备份 ============ */
function openDataManagement(){
  const backup=backupStatus();document.getElementById('modals').innerHTML=`<div class="overlay" data-action="close-overlay"><div class="sheet" role="dialog" aria-modal="true" aria-label="数据管理"><div class="sheet-head"><div class="r1"><div><h3>☁️ 数据管理</h3><p style="font-size:12px;color:#94a3b8;margin-top:3px">账目、设置和规划都保存在当前浏览器</p></div><button class="x" data-action="close-modal" aria-label="关闭">✕</button></div></div><div class="sheet-body"><p class="backup-status ${backup.warn?'warn':''}">${esc(backup.text)}</p>${storageLocked?`<div class="rescue">⚠️ 检测到数据异常：${esc(recoveryError)}。为避免覆盖原始内容，新增、编辑和删除已暂停。</div>`:''}<div class="backup">${storageLocked?`<button data-action="open-recovery">🛟 数据救援</button>`:`<button data-action="export">⬇️ 导出完整备份</button>`}<button data-action="import-trigger">⬆️ 导入备份</button><button data-action="open-category-manager">分类管理</button></div></div></div></div>`;document.body.style.overflow='hidden';
}
function downloadText(content,filename,type='application/json'){
  const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),0);
}
function exportData(prefix='完整账本备份',showToast=true,mark=true){
  downloadText(JSON.stringify(backupEnvelope(state.records,prefs,decisions),null,2),`${prefix}_${todayStr()}.json`);
  if(mark){
    backupMeta={lastBackupAt:new Date().toISOString(),recordCount:state.records.length,prefsUpdatedAt:prefs.updatedAt,decisionsUpdatedAt:decisions.updatedAt};
    try{localStorage.setItem(META_KEY,JSON.stringify(backupMeta));}catch(error){toast('备份已下载，但备份时间记录失败');return;}
    render();
  }
  if(showToast)toast('已导出完整备份');
}
function openRecovery(){
  document.getElementById('modals').innerHTML=`<div class="overlay" data-action="close-overlay"><div class="sheet" role="dialog" aria-modal="true" aria-label="数据救援"><div class="sheet-head"><div class="r1"><h3>🛟 数据救援</h3><button class="x" data-action="close-modal" aria-label="关闭">✕</button></div></div><div class="sheet-body"><div class="rescue">检测结果：${esc(recoveryError)}。当前成功读取 ${state.records.length} 笔有效记录。</div><p style="font-size:13px;color:#64748b;line-height:1.7">请先下载未经处理的原始内容。确认文件已经保存后，才能用当前有效记录重建本地账本。</p></div><div class="sheet-foot"><div class="backup"><button data-action="download-recovery">⬇️ 下载原始数据</button><button data-action="accept-recovery">保留有效记录</button></div></div></div></div>`;
  document.body.style.overflow='hidden';
}
function downloadRecovery(showToast=true){
  downloadText(recoveryRaw||'',`账本原始数据_${todayStr()}.json`,'text/plain');recoveryDownloaded=true;
  if(showToast)toast('原始数据已下载，请妥善保存');
}
function acceptRecovery(){
  if(!recoveryDownloaded){toast('请先下载原始数据');return;}
  try{localStorage.setItem(KEY,JSON.stringify(envelope(state.records)));}
  catch(error){toast('重建失败：'+error.message);return;}
  storageLocked=false;recoveryRaw='';recoveryError='';recoveryDownloaded=false;closeModals();render();toast('已用有效记录重建账本');
}
let pendingImport=null;
function parseBackup(parsed,name=''){
  const legacy=Array.isArray(parsed),raw=legacy?parsed:parsed&&parsed.records;
  if(!Array.isArray(raw))throw new Error('备份中没有记录数组');
  if(!legacy&&![2,SCHEMA_VERSION].includes(parsed.schemaVersion))throw new Error('账目版本不受支持');
  if(!legacy&&parsed.backupVersion!==undefined&&![1,2,BACKUP_VERSION].includes(parsed.backupVersion))throw new Error('完整备份版本不受支持');
  const hasSettingsField=!legacy&&Object.prototype.hasOwnProperty.call(parsed,'preferences'),hasCategories=hasSettingsField&&Array.isArray(parsed.preferences&&parsed.preferences.categories);
  const normalized=hasSettingsField?normalizePrefs(parsed.preferences):{preferences:defaultPrefs(),ignored:0,supported:false};
  const importCategories=hasSettingsField&&normalized.supported?normalized.preferences.categories:defaultCategoryConfig(),expenseCats=categoryMap(importCategories),result=normalizeRecords(raw,expenseCats);if(result.errors.length)throw new Error(`${result.errors[0]}，共 ${result.errors.length} 条异常`);
  const hasDecisionsField=!legacy&&Object.prototype.hasOwnProperty.call(parsed,'decisions'),normalizedDecisions=hasDecisionsField?normalizeDecisions(parsed.decisions,expenseCats):{decisionData:defaultDecisions(),ignored:0,supported:false};
  const format=legacy?'旧版数组':parsed.backupVersion?`完整备份 v${parsed.backupVersion}`:`账目备份 v${parsed.schemaVersion}`;
  return {records:result.records,preferences:normalized.preferences,categories:importCategories,hasPreferences:hasSettingsField&&normalized.supported,hasCategories:hasCategories&&normalized.supported,preferenceWarnings:normalized.ignored,
    decisions:normalizedDecisions.decisionData,hasDecisions:hasDecisionsField&&normalizedDecisions.supported,decisionWarnings:normalizedDecisions.ignored,
    source:{name,format,backupVersion:legacy?null:parsed.backupVersion||null,exportedAt:legacy?'':parsed.exportedAt||''}};
}
document.getElementById('importFile').addEventListener('change',function(e){
  const file=e.target.files[0];if(!file)return;const reader=new FileReader();
  reader.onload=ev=>{try{
    pendingImport=parseBackup(JSON.parse(ev.target.result),file.name);openImportPreview();
  }catch(error){toast('导入失败：'+error.message);}};
  reader.readAsText(file);e.target.value='';
});
function openImportPreview(){
  const records=pendingImport.records,dates=records.map(r=>r.date).sort(),span=dates.length?`${dates[0]} 至 ${dates[dates.length-1]}`:'无记录';
  const income=sumType(records,'income'),expense=sumType(records,'expense'),currentIds=new Set(state.records.map(r=>r.id));
  const duplicates=records.filter(r=>currentIds.has(r.id)).length;
  const exportedAt=pendingImport.source.exportedAt&&Number.isFinite(Date.parse(pendingImport.source.exportedAt))?new Date(pendingImport.source.exportedAt).toLocaleString('zh-CN'):'未提供';
  const importedPrefs=pendingImport.preferences,favorites=importedPrefs.favorites.expense.length+importedPrefs.favorites.income.length,recent=Number(!!importedPrefs.recent.expense)+Number(!!importedPrefs.recent.income);
  const settingsInfo=pendingImport.hasPreferences?`<div class="summary-grid">${pendingImport.hasCategories?`<div>分类大类<b>${importedPrefs.categories.length} 个</b></div>`:'<div>分类设置<b>保留当前</b></div>'}<div>最近分类<b>${recent} 个</b></div><div>收藏分类<b>${favorites} 个</b></div><div>设置校验<b>${pendingImport.preferenceWarnings?`忽略 ${pendingImport.preferenceWarnings} 项`:'全部通过'}</b></div></div>`:`<p class="backup-status warn" style="margin-top:12px">${pendingImport.preferenceWarnings?'快捷设置版本无法识别，将只导入账目。':'这是旧版账目备份，不包含分类设置。'}</p>`;
  const planningInfo=pendingImport.hasDecisions?`<div class="summary-grid"><div>预算月份<b>${Object.keys(pendingImport.decisions.budgets).length} 个月</b></div><div>正式专项<b>${pendingImport.decisions.projects.length} 个</b></div><div>财务目标<b>${pendingImport.decisions.goals.length} 个</b></div><div>月度复盘<b>${Object.keys(pendingImport.decisions.reviews).length} 个月</b></div><div>无支出确认<b>${pendingImport.decisions.noSpendDates.length} 天</b></div><div>规划校验<b>${pendingImport.decisionWarnings?`忽略 ${pendingImport.decisionWarnings} 项`:'全部通过'}</b></div></div>`:`<p class="backup-status warn" style="margin-top:12px">${pendingImport.decisionWarnings?'规划数据版本无法识别，将保留当前规划。':'此备份不包含规划数据，完整恢复时会保留当前规划。'}</p>`;
  document.getElementById('modals').innerHTML=`<div class="overlay" data-action="close-overlay"><div class="sheet" role="dialog" aria-modal="true" aria-label="确认导入"><div class="sheet-head"><div class="r1"><h3>确认导入</h3><button class="x" data-action="close-modal" aria-label="关闭">✕</button></div></div><div class="sheet-body"><p style="font-size:13px;color:#64748b;line-height:1.7">文件：${esc(pendingImport.source.name)}<br>格式：${esc(pendingImport.source.format)}<br>导出时间：${exportedAt}<br>日期范围：${span}</p><div class="summary-grid"><div>记录数<b>${records.length} 笔</b></div><div>与当前重复<b>${duplicates} 笔</b></div><div>历史收入<b>¥${fmt(income)}</b></div><div>支出合计<b>¥${fmt(expense)}</b></div></div>${settingsInfo}${planningInfo}<p style="font-size:12px;color:#94a3b8;line-height:1.6;margin-top:12px">操作前会自动下载当前完整备份；默认完整恢复账目，并恢复文件中可识别的设置和规划。旧备份缺少的内容会保留当前数据。</p></div><div class="sheet-foot"><div class="import-actions"><button class="full" data-action="apply-import" data-value="full">完整恢复账目与设置</button></div><details class="advanced-import"><summary>高级导入方式</summary><div class="import-actions"><button data-action="apply-import" data-value="merge">合并账目<br>保留当前数据</button><button data-action="apply-import" data-value="replace">覆盖账目<br>设置保持不变</button></div></details></div></div></div>`;
  document.body.style.overflow='hidden';
}
function applyImport(mode){
  if(!pendingImport)return;
  if(storageLocked)downloadRecovery(false);else exportData('导入前完整备份',false,false);
  const incoming=pendingImport.records;
  let next=incoming;
  if(mode==='merge'){
    const map=new Map(state.records.map(r=>[r.id,r]));
    incoming.forEach(r=>{const old=map.get(r.id);if(!old||r.updatedAt>old.updatedAt)map.set(r.id,r);});
    next=[...map.values()];
  }
  if(mode==='replace'&&incoming.some(record=>record.type==='expense'&&!validChoice('expense',record.cat,record.sub))){toast('备份包含当前分类设置无法识别的记录，请使用完整恢复或合并');return;}
  const restoredDecisions=mode==='full'&&pendingImport.hasDecisions?pendingImport.decisions:null;let restoredPrefs=null;
  if(mode==='full')restoredPrefs=pendingImport.hasPreferences?{...pendingImport.preferences,categories:pendingImport.hasCategories?pendingImport.preferences.categories:mergeCategoryConfigs(prefs.categories,pendingImport.categories)}:{...prefs,categories:mergeCategoryConfigs(prefs.categories,pendingImport.categories),updatedAt:new Date().toISOString()};
  else if(mode==='merge'){const categories=mergeCategoryConfigs(prefs.categories,pendingImport.categories);if(JSON.stringify(categories)!==JSON.stringify(prefs.categories))restoredPrefs={...prefs,categories,updatedAt:new Date().toISOString()};}
  if(restoredPrefs||restoredDecisions){if(!persistFullRestore(next,restoredPrefs||prefs,restoredDecisions,storageLocked))return;}else if(!persist(next,storageLocked))return;
  const count=next.length;state.records=next;if(restoredPrefs){prefs=restoredPrefs;EXPENSE_CATS=categoryMap(prefs.categories);}if(restoredDecisions)decisions=restoredDecisions;pendingImport=null;
  if(storageLocked){storageLocked=false;recoveryRaw='';recoveryError='';recoveryDownloaded=false;}
  closeModals();render();toast(mode==='full'?`完整恢复成功，共 ${count} 笔`:`账目导入成功，共 ${count} 笔`);
}
function mergeCategoryConfigs(base,incoming){const merged=cloneCategoryConfig(base);incoming.forEach(group=>{let target=merged.find(item=>item.id===group.id);if(!target){merged.push(cloneCategoryConfig(group));return;}group.subs.forEach(sub=>{if(!target.subs.some(item=>item.id===sub.id))target.subs.push(cloneCategoryConfig(sub));});});return merged;}
let toastTimer;
function toast(msg,undoAction=''){const t=document.getElementById('toast'),button=document.getElementById('toastUndo');document.getElementById('toastMsg').textContent=msg;button.dataset.action=undoAction;t.classList.toggle('undo',!!undoAction);t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),undoAction?12000:1800);}

document.addEventListener('click',event=>{
  const el=event.target.closest('[data-action]');if(!el)return;
  const action=el.dataset.action,value=el.dataset.value,hadModal=!!document.querySelector('#modals [role="dialog"]');
  if(action==='close-overlay'&&event.target!==el)return;
  const actions={
    'set-view':()=>setView(value),'set-tab':()=>setTab(value),'shift':()=>shift(Number(value)),'go-today':goToday,'open-planning':openPlanning,
    'open-project-form':()=>openProjectForm(),'edit-project':()=>openProjectForm(value),'save-project':saveProject,'open-project':()=>openProject(value),'open-project-actions':()=>openProjectActions(value),'set-current-project':()=>{closeModals();setCurrentProject(value);},'set-project-status':()=>{closeModals();setProjectStatus(value);},
    'set-planning-view':()=>setPlanningView(value),'open-goal-form':()=>openGoalForm(),'edit-goal':()=>openGoalForm(value),'save-goal':saveGoal,'open-goal-actions':()=>openGoalActions(value),
    'open-contribution':()=>openContribution(value),'open-contribution-history':()=>openContributionHistory(value),'edit-contribution':()=>{const ids=splitContributionValue(value);openContribution(ids[0],ids[1]);},
    'save-contribution':saveContribution,'confirm-delete-contribution':()=>confirmDeleteContribution(value),'delete-contribution':()=>deleteContribution(value),'set-goal-status':()=>{closeModals();setGoalStatus(value);},
    'save-review':saveReview,'toggle-review-action':()=>toggleReviewAction(value),
    'calendar-shift':()=>shiftCalendar(Number(value)),'toggle-calendar':toggleCalendar,'open-calendar-day':()=>openCalendarDay(value),
    'toggle-year':()=>togY(value),'toggle-month':()=>togM(value),
    'toggle-filters':toggleFilters,'apply-filters':applyFilters,'clear-filters':clearFilters,'save-budget':saveBudget,'copy-previous-budget':copyPreviousBudget,
    'open-add':()=>openRecordForm(),'add-for-date':()=>openRecordForm(null,{date:value}),'open-record-actions':()=>openRecordActions(value),'edit-record':()=>openRecordForm(value),'copy-record':()=>copyRecord(value),'delete-record':()=>{closeModals();delRec(value);},
    'undo-delete':undoDelete,'undo-add':undoAdd,'close-modal':closeModals,'close-overlay':closeModals,
    'select-record-context':()=>selectRecordContext(value),'select-category-choice':()=>selQuick(value,!form.id),'select-quick':()=>selQuick(value),'quick-save':()=>selQuick(value,true),'select-recent':()=>selQuick(value,false,true),'recent-save':()=>selQuick(value,true,true),
    'toggle-record-section':()=>toggleRecordSection(value),'toggle-form-no-spend':toggleFormNoSpend,'save-record':doSave,
    'open-data-management':openDataManagement,'open-category-manager':openCategoryManager,'open-category-name':()=>openCategoryNameForm(value),'save-category-name':saveCategoryName,
    'move-category-group':()=>moveCategoryGroup(value),'move-category-sub':()=>moveCategorySub(value),'toggle-category-group':()=>toggleCategoryGroup(value),'toggle-category-sub':()=>toggleCategorySub(value),'open-category-roles':()=>openCategoryRoles(value),'save-category-roles':saveCategoryRoles,
    'export':()=>exportData(),'import-trigger':()=>document.getElementById('importFile').click(),
    'apply-import':()=>applyImport(value),'open-recovery':openRecovery,'download-recovery':()=>downloadRecovery(),
    'accept-recovery':acceptRecovery
  };
  if(actions[action]){actions[action]();if(!hadModal&&document.querySelector('#modals [role="dialog"]'))modalReturnFocus=el;}
});
document.addEventListener('submit',event=>{if(event.target.id==='filterForm'){event.preventDefault();applyFilters();}});
document.addEventListener('change',event=>{if(event.target.id==='fProject'){form.projectId=event.target.value;if(form.projectId)form.beneficiaryId='family';form.projectTouched=true;ensureFormChoice();renderRecordContext();renderQuickChoices();renderCategoryGroups();}if(event.target.id==='fDate')refreshProjectForDate();if(event.target.id==='projectType'){const field=document.getElementById('projectPeopleField');if(field)field.style.display=event.target.value==='travel'?'block':'none';}});
new MutationObserver(syncModalState).observe(document.getElementById('modals'),{childList:true,subtree:true});
document.addEventListener('keydown',event=>{
  const dialog=document.querySelector('#modals [role="dialog"]');if(!dialog)return;
  if(event.key==='Escape'){closeModals();return;}
  if(event.key!=='Tab')return;
  const focusable=[...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')].filter(item=>item.getClientRects().length);
  if(!focusable.length)return;
  const first=focusable[0],last=focusable[focusable.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
});

render();
if(loaded.notice)setTimeout(()=>toast(loaded.notice),0);
if('serviceWorker' in navigator&&location.protocol!=='file:')window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
