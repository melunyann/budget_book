/* ==========================================================
   おかねびより - app.js
   バイトのシフト管理 + 家計簿カレンダー（localStorage 保存）
   ========================================================== */

const STORAGE_KEY = 'okanebiyori_v1';
const $ = (id) => document.getElementById(id);

const INCOME_CATS  = ['バイト代(手動)', 'お小遣い', '副業', 'プレゼント', 'その他収入'];
const EXPENSE_CATS = ['食費', '交通費', '日用品', '交際費', '趣味・娯楽', '衣服・美容', '通信費', '家賃', 'その他'];
const YOUBI = ['日','月','火','水','木','金','土'];

/* ---------------- State / storage ---------------- */

function defaultState(){
  return {
    settings: {
      hourlyWage: 1100,
      closingDay: 'end',   // 'end' or 1-28
      paydayOffset: 1,     // 0,1,2 ヶ月後
      paydayDay: 25,       // 'end' or 1-31
      characterName: 'アリス',
      themeColor: '#6FB8DE',
      startingBalance: 0,
      illustrationDataUrl: null
    },
    shifts: [],        // {id, date:'YYYY-MM-DD', start:'HH:MM', end:'HH:MM', breakMin, wage(optional)}
    transactions: [],   // {id, date, type:'income'|'expense', category, amount, memo, isBiz}
    events: [],         // {id, date, time:'HH:MM'|null, title, memo}
    shiftPatterns: [],  // {id, name, start, end, breakMin, wage}
    lastShiftInput: null // {start, end, breakMin, wage} 直近に保存したシフトの内容
  };
}

let state = loadState();

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const def = defaultState();
    return {
      settings: Object.assign(def.settings, parsed.settings || {}),
      shifts: parsed.shifts || [],
      transactions: parsed.transactions || [],
      events: parsed.events || [],
      shiftPatterns: parsed.shiftPatterns || [],
      lastShiftInput: parsed.lastShiftInput || null
    };
  }catch(e){
    console.error('load error', e);
    return defaultState();
  }
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}

/* ---------------- Date utils ---------------- */

function pad2(n){ return String(n).padStart(2,'0'); }
function ymd(y,m,d){ return `${y}-${pad2(m)}-${pad2(d)}`; }
function ymdFromDate(dt){ return ymd(dt.getFullYear(), dt.getMonth()+1, dt.getDate()); }
function parseYMD(s){
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d);
}
function daysInMonth(y,m){ return new Date(y, m, 0).getDate(); } // m:1-12
function addMonthsYM(y,m,n){
  const total = (m-1) + n;
  const ny = y + Math.floor(total/12);
  const nm = ((total % 12)+12)%12 + 1;
  return {y:ny, m:nm};
}
function todayStr(){ return ymdFromDate(new Date()); }
function isSameDate(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function fmtYen(n){ return '¥' + Math.round(n).toLocaleString('ja-JP'); }
function fmtSignedYen(n){
  const v = Math.round(n);
  return (v>0? '+':'') + '¥' + v.toLocaleString('ja-JP');
}
function startOfWeek(dt){ // Sunday start
  const d = new Date(dt);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0,0,0,0);
  return d;
}

/* ---------------- Pay calculations ---------------- */

function shiftMinutes(shift){
  const [sh,sm] = shift.start.split(':').map(Number);
  const [eh,em] = shift.end.split(':').map(Number);
  let mins = (eh*60+em) - (sh*60+sm);
  if(mins < 0) mins += 24*60; // overnight shift
  mins -= (Number(shift.breakMin)||0);
  return Math.max(0, mins);
}
function shiftHours(shift){ return shiftMinutes(shift)/60; }
function shiftWage(shift){
  return (shift.wage !== undefined && shift.wage !== null && shift.wage !== '') ? Number(shift.wage) : Number(state.settings.hourlyWage);
}
function shiftPay(shift){
  return Math.floor(shiftHours(shift) * shiftWage(shift));
}

function resolveClosingDay(y,m){
  const c = state.settings.closingDay;
  if(c === 'end') return daysInMonth(y,m);
  return Math.min(Number(c), daysInMonth(y,m));
}
function resolvePaydayDay(y,m){
  const p = state.settings.paydayDay;
  if(p === 'end') return daysInMonth(y,m);
  return Math.min(Number(p), daysInMonth(y,m));
}
// 指定日がどの「締め期間」に属するか -> {y,m} は締め月
function getPeriodForDate(dateStr){
  const d = parseYMD(dateStr);
  const y = d.getFullYear(), m = d.getMonth()+1, day = d.getDate();
  const closing = resolveClosingDay(y,m);
  if(day <= closing) return {y, m};
  const nxt = addMonthsYM(y,m,1);
  return {y:nxt.y, m:nxt.m};
}
// 締め期間 -> 支払日の Date
function getPaydayDate(py,pm){
  const off = Number(state.settings.paydayOffset);
  const {y,m} = addMonthsYM(py,pm,off);
  const day = resolvePaydayDay(y,m);
  return new Date(y, m-1, day);
}
function periodLabel(py,pm){ return `${py}年${pm}月分`; }

// 給料日(YYYY-MM-DD) -> { total, count, periods:[{py,pm}] }
function computePaydayMap(){
  const periodTotals = {}; // key "y-m" -> total
  const periodCounts = {};
  state.shifts.forEach(sh=>{
    const {y,m} = getPeriodForDate(sh.date);
    const key = `${y}-${m}`;
    periodTotals[key] = (periodTotals[key]||0) + shiftPay(sh);
    periodCounts[key] = (periodCounts[key]||0) + 1;
  });
  const map = {};
  Object.keys(periodTotals).forEach(key=>{
    const [py,pm] = key.split('-').map(Number);
    const pd = getPaydayDate(py,pm);
    const pdStr = ymdFromDate(pd);
    if(!map[pdStr]) map[pdStr] = {total:0, count:0, periods:[]};
    map[pdStr].total += periodTotals[key];
    map[pdStr].count += periodCounts[key];
    map[pdStr].periods.push({py,pm});
  });
  return map;
}

function rulePreviewText(){
  const s = state.settings;
  const closingTxt = s.closingDay==='end' ? '月末' : `${s.closingDay}日`;
  const offTxt = ['締め月と同じ月','翌月','翌々月'][Number(s.paydayOffset)];
  const paydayTxt = s.paydayDay==='end' ? '月末' : `${s.paydayDay}日`;
  return `例：${closingTxt}締め → ${offTxt}の${paydayTxt}が給料日になります。`;
}

/* ---------------- Derived lookups ---------------- */

function shiftsOnDate(dateStr){ return state.shifts.filter(s=>s.date===dateStr); }
function txnsOnDate(dateStr){ return state.transactions.filter(t=>t.date===dateStr); }
function eventsOnDate(dateStr){
  return state.events.filter(e=>e.date===dateStr).sort((a,b)=>{
    if(!a.time && !b.time) return 0;
    if(!a.time) return 1;
    if(!b.time) return -1;
    return a.time < b.time ? -1 : 1;
  });
}
function shiftsInMonth(y,m){
  return state.shifts.filter(s=>{
    const d = parseYMD(s.date);
    return d.getFullYear()===y && d.getMonth()+1===m;
  });
}
function txnsInMonth(y,m){
  return state.transactions.filter(t=>{
    const d = parseYMD(t.date);
    return d.getFullYear()===y && d.getMonth()+1===m;
  });
}

/* ==========================================================
   ナビゲーション状態
   ========================================================== */
let monthCursor = new Date(); monthCursor.setDate(1);
let weekCursor = startOfWeek(new Date());
let ledgerCursor = new Date(); ledgerCursor.setDate(1);

/* ==========================================================
   タブ切替
   ========================================================== */
document.querySelectorAll('.tab').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    btn.classList.add('active');
    $('view-' + btn.dataset.tab).classList.add('active');
    if(btn.dataset.tab==='month') renderMonth();
    if(btn.dataset.tab==='week') renderWeek();
    if(btn.dataset.tab==='ledger') renderLedger();
    if(btn.dataset.tab==='settings') renderSettings();
  });
});

/* ==========================================================
   月カレンダー描画
   ========================================================== */
function renderMonth(){
  const y = monthCursor.getFullYear(), m = monthCursor.getMonth()+1;
  $('m-label').textContent = `${y}年${m}月`;

  const paydayMap = computePaydayMap();

  // サマリー：今月勤務分
  const mShifts = shiftsInMonth(y,m);
  const mShiftTotal = mShifts.reduce((a,s)=>a+shiftPay(s),0);
  $('m-shift-total').textContent = fmtYen(mShiftTotal);
  $('m-shift-count').textContent = `${mShifts.length}件のシフト`;

  // 次の給料日（今日以降で一番近いもの）
  const today = todayStr();
  const futurePaydays = Object.keys(paydayMap).filter(d=>d>=today).sort();
  if(futurePaydays.length){
    const nd = futurePaydays[0];
    const dObj = parseYMD(nd);
    $('m-next-payday').textContent = `${dObj.getMonth()+1}月${dObj.getDate()}日`;
    $('m-next-payday-amt').textContent = fmtYen(paydayMap[nd].total);
  } else {
    $('m-next-payday').textContent = '-';
    $('m-next-payday-amt').textContent = '予定なし';
  }

  // 家計簿ざっくり合計（当月・支払ベースの収入＋手動取引）
  const {income, expense} = monthLedgerTotals(y,m,paydayMap);
  $('m-income-total').textContent = fmtYen(income);
  $('m-expense-total').textContent = fmtYen(expense);

  // グリッド
  const grid = $('month-grid');
  grid.innerHTML = '';
  const first = new Date(y, m-1, 1);
  const startOffset = first.getDay();
  const totalDays = daysInMonth(y,m);
  const prevYM = m===1 ? {py:y-1, pm:12} : {py:y, pm:m-1};
  const prevMonthDays = daysInMonth(prevYM.py, prevYM.pm);
  const cells = [];

  for(let i=0;i<startOffset;i++){
    const dayNum = prevMonthDays - startOffset + 1 + i;
    cells.push({dateStr:null, dayNum, out:true});
  }
  for(let d=1; d<=totalDays; d++){
    cells.push({dateStr: ymd(y,m,d), dayNum:d, out:false});
  }
  while(cells.length % 7 !== 0){
    cells.push({dateStr:null, dayNum: cells.length - (startOffset+totalDays) + 1, out:true});
  }

  cells.forEach(c=>{
    const cell = document.createElement('div');
    cell.className = 'day-cell' + (c.out?' out':'');
    if(c.dateStr === today) cell.classList.add('today');
    const num = document.createElement('div');
    num.className = 'd-num';
    num.textContent = c.dayNum;
    cell.appendChild(num);

    if(c.dateStr && !c.out){
      const dayShifts = shiftsOnDate(c.dateStr);
      if(dayShifts.length){
        const pay = dayShifts.reduce((a,s)=>a+shiftPay(s),0);
        const pill = document.createElement('div');
        pill.className = 'day-pill shift';
        pill.textContent = fmtYen(pay);
        cell.appendChild(pill);
      }
      if(paydayMap[c.dateStr]){
        const pill = document.createElement('div');
        pill.className = 'day-pill payday';
        pill.textContent = '給料 ' + fmtYen(paydayMap[c.dateStr].total);
        cell.appendChild(pill);
      }
      const dayEvents = eventsOnDate(c.dateStr);
      if(dayEvents.length){
        const pill = document.createElement('div');
        pill.className = 'day-pill event';
        const extra = dayEvents.length>1 ? ` +${dayEvents.length-1}` : '';
        pill.textContent = '📅' + dayEvents[0].title + extra;
        cell.appendChild(pill);
      }
      const dayTxns = txnsOnDate(c.dateStr);
      if(dayTxns.length){
        const dots = document.createElement('div');
        dots.className = 'day-dots';
        dayTxns.slice(0,4).forEach(t=>{
          const dot = document.createElement('span');
          dot.className = 'dot ' + t.type;
          dots.appendChild(dot);
        });
        cell.appendChild(dots);
      }
      cell.addEventListener('click', ()=>openDayModal(c.dateStr));
    } else {
      cell.style.cursor = 'default';
    }
    grid.appendChild(cell);
  });
}

function monthLedgerTotals(y,m,paydayMap){
  paydayMap = paydayMap || computePaydayMap();
  let income = 0, expense = 0;
  Object.keys(paydayMap).forEach(dateStr=>{
    const d = parseYMD(dateStr);
    if(d.getFullYear()===y && d.getMonth()+1===m) income += paydayMap[dateStr].total;
  });
  txnsInMonth(y,m).forEach(t=>{
    if(t.type==='income') income += Number(t.amount);
    else expense += Number(t.amount);
  });
  return {income, expense};
}

$('m-prev').addEventListener('click', ()=>{ monthCursor.setMonth(monthCursor.getMonth()-1); renderMonth(); });
$('m-next').addEventListener('click', ()=>{ monthCursor.setMonth(monthCursor.getMonth()+1); renderMonth(); });

/* ==========================================================
   週カレンダー描画
   ========================================================== */
const WEEK_PX_PER_HOUR = 52;

function renderWeek(){
  const paydayMap = computePaydayMap();
  const start = new Date(weekCursor);
  const end = new Date(weekCursor); end.setDate(end.getDate()+6);
  const fmtShort = (d)=> `${d.getMonth()+1}/${d.getDate()}`;
  $('w-label').textContent = `${fmtShort(start)} - ${fmtShort(end)}`;

  const today = todayStr();
  const dayInfos = [];
  let weekShiftTotal = 0, weekIncome = 0, weekExpense = 0;

  // その週の全シフトから表示範囲(時間帯)を決める。シフトが無ければ 9:00-18:00 をデフォルトに。
  let rangeStart = 9, rangeEnd = 18;
  const weekShifts = [];
  for(let i=0;i<7;i++){
    const d = new Date(start); d.setDate(d.getDate()+i);
    const dateStr = ymdFromDate(d);
    shiftsOnDate(dateStr).forEach(s=>{
      const [sh,sm] = s.start.split(':').map(Number);
      const [eh,em] = s.end.split(':').map(Number);
      let endHour = eh + em/60; if(endHour <= sh + sm/60) endHour += 24; // overnight
      weekShifts.push({dateStr, s, startHour: sh+sm/60, endHour});
    });
  }
  if(weekShifts.length){
    rangeStart = Math.floor(Math.min(...weekShifts.map(w=>w.startHour), rangeStart));
    rangeEnd = Math.ceil(Math.max(...weekShifts.map(w=>w.endHour), rangeEnd));
  }
  rangeStart = Math.max(0, rangeStart - 1);
  rangeEnd = Math.min(30, rangeEnd + 1); // 30時までは深夜シフトも一応許容
  const totalHours = rangeEnd - rangeStart;
  const gridHeight = Math.round(totalHours * WEEK_PX_PER_HOUR);

  // ---- 曜日ヘッダー ----
  const headRow = $('week-head-row');
  headRow.innerHTML = '';
  const axisSpacer = document.createElement('div');
  axisSpacer.className = 'week-head-cell hd-axis';
  headRow.appendChild(axisSpacer);

  for(let i=0;i<7;i++){
    const d = new Date(start); d.setDate(d.getDate()+i);
    const dateStr = ymdFromDate(d);
    const isToday = dateStr === today;
    const dayTxns = txnsOnDate(dateStr);
    const isPayday = !!paydayMap[dateStr];
    if(isPayday) weekIncome += paydayMap[dateStr].total;
    dayTxns.forEach(t=>{ if(t.type==='income') weekIncome += Number(t.amount); else weekExpense += Number(t.amount); });

    const cell = document.createElement('div');
    cell.className = 'week-head-cell' + (isToday ? ' today' : '');
    let html = `<div class="wh-day">${YOUBI[d.getDay()]}</div><div class="wh-num">${d.getDate()}</div>`;
    if(dayTxns.length){
      html += '<div class="wh-dots">' + dayTxns.slice(0,4).map(t=>`<span class="dot ${t.type}"></span>`).join('') + '</div>';
    }
    if(isPayday){ html += `<div class="wh-payday">給料日</div>`; }
    const dayEvents = eventsOnDate(dateStr);
    if(dayEvents.length){
      html += '<div class="wh-events">' + dayEvents.slice(0,2).map(ev=>`<div class="wh-event-chip">${ev.time?ev.time+' ':''}${ev.title}</div>`).join('') +
        (dayEvents.length>2 ? `<div class="wh-event-chip">+${dayEvents.length-2}件</div>` : '') + '</div>';
    }
    cell.innerHTML = html;
    cell.addEventListener('click', ()=> openDayModal(dateStr));
    headRow.appendChild(cell);
    dayInfos.push({dateStr, isToday});
  }

  // ---- 時間軸 ----
  const axis = $('week-axis');
  axis.innerHTML = '';
  axis.style.height = gridHeight + 'px';
  for(let h = Math.ceil(rangeStart); h <= Math.floor(rangeEnd); h++){
    const label = document.createElement('div');
    label.className = 'axis-label';
    label.style.top = Math.round((h - rangeStart) * WEEK_PX_PER_HOUR) + 'px';
    label.textContent = (h % 24) + '時';
    axis.appendChild(label);
  }

  // ---- 日ごとのカラム ----
  const track = $('week-days-track');
  track.innerHTML = '';
  track.style.height = gridHeight + 'px';
  const lineBg = `repeating-linear-gradient(to bottom, var(--border), var(--border) 1px, transparent 1px, transparent ${WEEK_PX_PER_HOUR}px)`;

  dayInfos.forEach(info=>{
    const col = document.createElement('div');
    col.className = 'week-day-col' + (info.isToday ? ' today-col' : '');
    col.style.backgroundImage = lineBg;
    col.addEventListener('click', ()=> openDayModal(info.dateStr));

    weekShifts.filter(w=>w.dateStr===info.dateStr).forEach(w=>{
      const pay = shiftPay(w.s);
      weekShiftTotal += pay;
      const top = Math.round((w.startHour - rangeStart) * WEEK_PX_PER_HOUR);
      const height = Math.max(22, Math.round((w.endHour - w.startHour) * WEEK_PX_PER_HOUR) - 2);
      const block = document.createElement('div');
      block.className = 'week-shift-block';
      block.style.top = top + 'px';
      block.style.height = height + 'px';
      block.innerHTML = `<span class="wsb-time">${w.s.start}-${w.s.end}</span>${fmtYen(pay)}`;
      block.addEventListener('click', (e)=>{ e.stopPropagation(); openDayModal(info.dateStr); });
      col.appendChild(block);
    });
    track.appendChild(col);
  });

  $('week-empty-note').style.display = weekShifts.length ? 'none' : 'block';
  $('w-shift-total').textContent = fmtYen(weekShiftTotal);
  $('w-balance').textContent = fmtSignedYen(weekIncome - weekExpense);
}

$('w-prev').addEventListener('click', ()=>{ weekCursor.setDate(weekCursor.getDate()-7); renderWeek(); });
$('w-next').addEventListener('click', ()=>{ weekCursor.setDate(weekCursor.getDate()+7); renderWeek(); });

/* ==========================================================
   家計簿タブ描画（月表示 / 年表示、経費の絞り込み）
   ========================================================== */
let ledgerMode = 'month';   // 'month' | 'year'
let ledgerFilter = 'all';   // 'all' | 'biz' | 'nonbiz'
let yearCursor = new Date().getFullYear();

function matchesBizFilter(t){
  if(ledgerFilter==='all') return true;
  if(ledgerFilter==='biz') return !!t.isBiz;
  return !t.isBiz; // 'nonbiz'
}

function renderCatBars(container, emptyEl, txns, labelExtra){
  container.innerHTML = '';
  if(!txns.length){ emptyEl.style.display = 'block'; return; }
  emptyEl.style.display = 'none';
  const byCat = {};
  txns.forEach(t=>{ byCat[t.category] = (byCat[t.category]||0) + Number(t.amount); });
  const max = Math.max(...Object.values(byCat));
  Object.entries(byCat).sort((a,b)=>b[1]-a[1]).forEach(([cat,amt])=>{
    const row = document.createElement('div');
    row.className = 'cat-bar-row';
    row.innerHTML = `<div class="cat-bar-top"><span class="cn">${cat}</span><span>${fmtYen(amt)}</span></div>
      <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${Math.max(6,(amt/max)*100)}%;"></div></div>`;
    container.appendChild(row);
  });
}

function renderLedger(){
  if(ledgerMode==='month') renderLedgerMonth(); else renderLedgerYear();
}

function renderLedgerMonth(){
  const y = ledgerCursor.getFullYear(), m = ledgerCursor.getMonth()+1;
  $('l-label').textContent = `${y}年${m}月`;
  const paydayMap = computePaydayMap();
  const {income, expense} = monthLedgerTotals(y,m,paydayMap);
  let shiftPortion = 0;
  Object.keys(paydayMap).forEach(dateStr=>{
    const d = parseYMD(dateStr);
    if(d.getFullYear()===y && d.getMonth()+1===m) shiftPortion += paydayMap[dateStr].total;
  });
  const bizTotal = txnsInMonth(y,m).filter(t=>t.type==='expense' && t.isBiz).reduce((a,t)=>a+Number(t.amount),0);

  $('l-income').textContent = fmtYen(income);
  $('l-income-sub').textContent = `バイト代 ${fmtYen(shiftPortion)} 含む`;
  $('l-expense').textContent = fmtYen(expense);
  $('l-biz-sub').textContent = `うち経費 ${fmtYen(bizTotal)}`;
  const balEl = $('l-balance');
  balEl.textContent = fmtSignedYen(income-expense);
  balEl.style.color = (income-expense)>=0 ? 'var(--blue-dark)' : 'var(--pink-dark)';

  // カテゴリ内訳（支出・絞り込み反映）
  const filteredExpense = txnsInMonth(y,m).filter(t=>t.type==='expense' && matchesBizFilter(t));
  renderCatBars($('l-cat-bars'), $('l-cat-empty'), filteredExpense);

  // 履歴リスト（支払日イベント＋収入は常に表示／支出は絞り込みを反映）
  const listEl = $('l-list');
  listEl.innerHTML = '';
  const events = [];
  Object.keys(paydayMap).forEach(dateStr=>{
    const d = parseYMD(dateStr);
    if(d.getFullYear()===y && d.getMonth()+1===m){
      events.push({date:dateStr, type:'payday', amount:paydayMap[dateStr].total, category:'給料日', memo:`${paydayMap[dateStr].count}件のシフト分`});
    }
  });
  txnsInMonth(y,m).forEach(t=>{
    if(t.type==='expense' && !matchesBizFilter(t)) return;
    events.push({date:t.date, type:t.type, amount:Number(t.amount), category:t.category, memo:t.memo, id:t.id, isBiz:t.isBiz});
  });

  if(!events.length){
    listEl.innerHTML = '<div class="empty-note">条件に合う記録がありません</div>';
    return;
  }
  events.sort((a,b)=> a.date < b.date ? 1 : -1);
  let lastDate = null;
  events.forEach(ev=>{
    if(ev.date !== lastDate){
      const head = document.createElement('div');
      head.className = 'ledger-date-head';
      const d = parseYMD(ev.date);
      head.textContent = `${d.getMonth()+1}月${d.getDate()}日(${YOUBI[d.getDay()]})`;
      listEl.appendChild(head);
      lastDate = ev.date;
    }
    const item = document.createElement('div');
    const isIncome = ev.type==='income' || ev.type==='payday';
    item.className = 'ledger-item ' + (isIncome?'income':'expense');
    const icon = ev.type==='payday' ? '💰' : (isIncome ? '📥' : '📤');
    const bizTag = ev.isBiz ? ' <span style="font-size:10px;color:var(--pink-dark);">🧾経費</span>' : '';
    item.innerHTML = `
      <div class="ledger-cat-icon">${icon}</div>
      <div class="ledger-mid"><div class="lc">${ev.category}${bizTag}</div><div class="lm">${ev.memo||''}</div></div>
      <div class="ledger-amt">${isIncome?'+':'-'}${fmtYen(ev.amount)}</div>
    `;
    if(ev.id){
      item.style.cursor = 'pointer';
      item.addEventListener('click', ()=> openAddModal(ev.date, 'txn', ev.id));
      const delBtn = document.createElement('button');
      delBtn.className = 'ledger-del';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', (e)=>{ e.stopPropagation(); deleteTxn(ev.id); });
      item.appendChild(delBtn);
    }
    listEl.appendChild(item);
  });
}

function renderLedgerYear(){
  const y = yearCursor;
  $('y-label').textContent = `${y}年`;
  const paydayMap = computePaydayMap();

  let yearIncome = 0, yearExpense = 0, yearShiftPortion = 0;
  const monthRows = [];
  for(let m=1; m<=12; m++){
    const {income, expense} = monthLedgerTotals(y,m,paydayMap);
    yearIncome += income; yearExpense += expense;
    Object.keys(paydayMap).forEach(dateStr=>{
      const d = parseYMD(dateStr);
      if(d.getFullYear()===y && d.getMonth()+1===m) yearShiftPortion += paydayMap[dateStr].total;
    });
    monthRows.push({m, income, expense});
  }
  const yearBizTotal = state.transactions.filter(t=>{
    const d = parseYMD(t.date);
    return t.type==='expense' && t.isBiz && d.getFullYear()===y;
  }).reduce((a,t)=>a+Number(t.amount),0);

  $('y-income').textContent = fmtYen(yearIncome);
  $('y-income-sub').textContent = `バイト代 ${fmtYen(yearShiftPortion)} 含む`;
  $('y-expense').textContent = fmtYen(yearExpense);
  $('y-biz-sub').textContent = `うち経費 ${fmtYen(yearBizTotal)}`;
  const balEl = $('y-balance');
  balEl.textContent = fmtSignedYen(yearIncome - yearExpense);
  balEl.style.color = (yearIncome-yearExpense)>=0 ? 'var(--blue-dark)' : 'var(--pink-dark)';

  // 収入の内訳（項目ごと）：バイト代(給料日ベース) + 手動収入カテゴリ
  const incomeRows = [];
  if(yearShiftPortion>0) incomeRows.push({category:'バイト代(給料日ベース)', amount:yearShiftPortion});
  const manualIncome = state.transactions.filter(t=> t.type==='income' && parseYMD(t.date).getFullYear()===y);
  const incByCat = {};
  manualIncome.forEach(t=>{ incByCat[t.category] = (incByCat[t.category]||0) + Number(t.amount); });
  Object.entries(incByCat).forEach(([cat,amt])=> incomeRows.push({category:cat, amount:amt}));
  renderCatBars($('y-income-bars'), $('y-income-empty'), incomeRows.map(r=>({category:r.category, amount:r.amount})));

  // 支出の内訳（項目ごと・絞り込み反映）
  const yearExpenseTxns = state.transactions.filter(t=> t.type==='expense' && parseYMD(t.date).getFullYear()===y && matchesBizFilter(t));
  renderCatBars($('y-expense-bars'), $('y-expense-empty'), yearExpenseTxns);

  // 月ごとの推移テーブル
  const tbody = $('y-month-table');
  tbody.innerHTML = '';
  const curM = (new Date()).getMonth()+1, curY = (new Date()).getFullYear();
  monthRows.forEach(r=>{
    const tr = document.createElement('tr');
    if(y===curY && r.m===curM) tr.className = 'cur-month';
    const bal = r.income - r.expense;
    tr.innerHTML = `<td>${r.m}月</td><td class="inc">${fmtYen(r.income)}</td><td class="exp">${fmtYen(r.expense)}</td><td>${fmtSignedYen(bal)}</td>`;
    tbody.appendChild(tr);
  });
}

$('l-prev').addEventListener('click', ()=>{ ledgerCursor.setMonth(ledgerCursor.getMonth()-1); renderLedger(); });
$('l-next').addEventListener('click', ()=>{ ledgerCursor.setMonth(ledgerCursor.getMonth()+1); renderLedger(); });
$('y-prev').addEventListener('click', ()=>{ yearCursor -= 1; renderLedger(); });
$('y-next').addEventListener('click', ()=>{ yearCursor += 1; renderLedger(); });

$('l-mode-seg').querySelectorAll('button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    $('l-mode-seg').querySelectorAll('button').forEach(b=>b.classList.remove('active','income'));
    btn.classList.add('active','income');
    ledgerMode = btn.dataset.mode;
    $('ledger-month-view').style.display = ledgerMode==='month' ? 'block' : 'none';
    $('ledger-year-view').style.display = ledgerMode==='year' ? 'block' : 'none';
    renderLedger();
  });
});

function setLedgerFilter(f){
  ledgerFilter = f;
  [$('l-filter-seg'), $('y-filter-seg')].forEach(seg=>{
    seg.querySelectorAll('button').forEach(b=> b.classList.toggle('active', b.dataset.f===f));
  });
  renderLedger();
}
[$('l-filter-seg'), $('y-filter-seg')].forEach(seg=>{
  seg.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click', ()=> setLedgerFilter(btn.dataset.f));
  });
});

/* ==========================================================
   設定タブ
   ========================================================== */
function renderSettings(){
  $('s-wage').value = state.settings.hourlyWage;
  $('s-closing').value = state.settings.closingDay;
  $('s-offset').value = state.settings.paydayOffset;
  $('s-payday').value = state.settings.paydayDay;
  $('s-rule-preview').textContent = rulePreviewText();
}
[$('s-closing'), $('s-offset'), $('s-payday')].forEach(el=>{
  el.addEventListener('change', ()=>{
    // ライブプレビューだけ更新（保存は明示的に）
    const tmp = Object.assign({}, state.settings, {
      closingDay: $('s-closing').value,
      paydayOffset: $('s-offset').value,
      paydayDay: $('s-payday').value
    });
    const backup = state.settings;
    state.settings = tmp;
    $('s-rule-preview').textContent = rulePreviewText();
    state.settings = backup;
  });
});

$('s-save').addEventListener('click', ()=>{
  state.settings.hourlyWage = Number($('s-wage').value) || 0;
  state.settings.closingDay = $('s-closing').value;
  state.settings.paydayOffset = $('s-offset').value;
  state.settings.paydayDay = $('s-payday').value;
  saveState();
  showToast('設定を保存しました');
  renderSettings();
  renderMonth(); renderWeek(); renderLedger();
});

$('s-export').addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `okanebiyori_backup_${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});
$('s-import-btn').addEventListener('click', ()=> $('s-import-file').click());
$('s-import-file').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const parsed = JSON.parse(reader.result);
      const def = defaultState();
      state = {
        settings: Object.assign(def.settings, parsed.settings||{}),
        shifts: parsed.shifts || [],
        transactions: parsed.transactions || [],
        events: parsed.events || [],
        shiftPatterns: parsed.shiftPatterns || [],
        lastShiftInput: parsed.lastShiftInput || null
      };
      saveState();
      showToast('データを読み込みました');
      renderSettings(); renderMonth(); renderWeek(); renderLedger();
    }catch(err){
      alert('読み込みに失敗しました。正しいJSONファイルか確認してください。');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});
$('s-clear').addEventListener('click', ()=>{
  if(confirm('本当にすべてのデータを削除しますか？この操作は取り消せません。')){
    state = defaultState();
    saveState();
    showToast('データを削除しました');
    renderSettings(); renderMonth(); renderWeek(); renderLedger();
  }
});

/* ==========================================================
   トースト
   ========================================================== */
let toastTimer = null;
function showToast(msg){
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> t.classList.remove('show'), 1800);
}

/* ==========================================================
   追加モーダル（シフト / 収支 / 予定）※編集にも対応
   ========================================================== */
let currentTxnType = 'income';
let currentTxnCat = INCOME_CATS[0];
let currentTxnIsBiz = false;
let editContext = null; // {kind:'shift'|'txn'|'event', id}

function fillCategoryChips(){
  const wrap = $('tf-cats');
  wrap.innerHTML = '';
  const cats = currentTxnType==='income' ? INCOME_CATS : EXPENSE_CATS;
  if(!cats.includes(currentTxnCat)) currentTxnCat = cats[0];
  cats.forEach(cat=>{
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (cat===currentTxnCat ? ' active '+currentTxnType : '');
    chip.textContent = cat;
    chip.addEventListener('click', ()=>{ currentTxnCat = cat; fillCategoryChips(); });
    wrap.appendChild(chip);
  });
  $('tf-biz-field').style.display = currentTxnType==='expense' ? 'block' : 'none';
  if(currentTxnType!=='expense') currentTxnIsBiz = false;
  updateBizToggleUI();
}
function updateBizToggleUI(){
  $('tf-biz-toggle').classList.toggle('active', currentTxnIsBiz);
}
$('tf-biz-toggle').addEventListener('click', ()=>{
  currentTxnIsBiz = !currentTxnIsBiz;
  updateBizToggleUI();
});

function setTxnSegUI(type){
  $('tf-seg').querySelectorAll('button').forEach(b=>{
    b.classList.remove('active','income','expense');
    if(b.dataset.type===type) b.classList.add('active', type);
  });
}
$('tf-seg').querySelectorAll('button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    currentTxnType = btn.dataset.type;
    setTxnSegUI(currentTxnType);
    fillCategoryChips();
  });
});

function openAddModal(dateStr, mode, editId){
  editContext = editId ? {kind:mode, id:editId} : null;
  $('sf-date').value = dateStr;
  $('tf-date').value = dateStr;
  $('ef-date').value = dateStr;
  $('form-shift').style.display = 'none';
  $('form-txn').style.display = 'none';
  $('form-event').style.display = 'none';
  if(mode==='shift'){ showShiftForm(editId); }
  else if(mode==='txn'){ showTxnForm(editId); }
  else if(mode==='event'){ showEventForm(editId); }
  $('modal-add').classList.add('show');
}

function showShiftForm(editId){
  $('add-modal-title').textContent = editId ? 'シフトを編集' : 'バイトのシフトを追加';
  $('form-shift').style.display = 'block';
  $('form-txn').style.display = 'none';
  $('form-event').style.display = 'none';
  renderShiftPatternChips();
  if(editId){
    const s = state.shifts.find(x=>x.id===editId);
    if(s){
      $('sf-date').value = s.date;
      $('sf-start').value = s.start;
      $('sf-end').value = s.end;
      $('sf-break').value = s.breakMin;
      $('sf-wage').value = (s.wage===null || s.wage===undefined) ? '' : s.wage;
    }
  } else {
    const last = state.lastShiftInput;
    $('sf-start').value = last ? last.start : '09:00';
    $('sf-end').value = last ? last.end : '17:00';
    $('sf-break').value = last ? last.breakMin : 0;
    $('sf-wage').value = (last && last.wage!=null) ? last.wage : '';
  }
  $('sf-save').textContent = editId ? 'この内容で更新する' : 'シフトを保存';
  updateShiftPreview();
}

function showTxnForm(editId){
  $('add-modal-title').textContent = editId ? '収入・支出を編集' : '収入・支出を追加';
  $('form-shift').style.display = 'none';
  $('form-txn').style.display = 'block';
  $('form-event').style.display = 'none';
  if(editId){
    const t = state.transactions.find(x=>x.id===editId);
    if(t){
      currentTxnType = t.type;
      currentTxnCat = t.category;
      currentTxnIsBiz = !!t.isBiz;
      $('tf-amount').value = t.amount;
      $('tf-memo').value = t.memo || '';
    }
  } else {
    currentTxnIsBiz = false;
    $('tf-amount').value = '';
    $('tf-memo').value = '';
  }
  setTxnSegUI(currentTxnType);
  fillCategoryChips();
  $('tf-save').textContent = editId ? 'この内容で更新する' : '保存する';
}

function showEventForm(editId){
  $('add-modal-title').textContent = editId ? '予定を編集' : '予定を追加';
  $('form-shift').style.display = 'none';
  $('form-txn').style.display = 'none';
  $('form-event').style.display = 'block';
  if(editId){
    const ev = state.events.find(x=>x.id===editId);
    if(ev){
      $('ef-title').value = ev.title;
      $('ef-time').value = ev.time || '';
      $('ef-memo').value = ev.memo || '';
    }
  } else {
    $('ef-title').value = '';
    $('ef-time').value = '';
    $('ef-memo').value = '';
  }
  $('ef-save').textContent = editId ? 'この内容で更新する' : '予定を保存';
}

$('qa-shift').addEventListener('click', ()=>{ editContext=null; showShiftForm(); });
$('qa-txn').addEventListener('click', ()=>{ editContext=null; showTxnForm(); });
$('qa-event').addEventListener('click', ()=>{ editContext=null; showEventForm(); });
$('fab-add').addEventListener('click', ()=> openAddModal(todayStr(), 'shift'));
$('add-modal-close').addEventListener('click', ()=> $('modal-add').classList.remove('show'));
$('modal-add').addEventListener('click', (e)=>{ if(e.target.id==='modal-add') $('modal-add').classList.remove('show'); });
$('ef-clear-time').addEventListener('click', ()=> { $('ef-time').value=''; });

function updateShiftPreview(){
  const tmp = { start:$('sf-start').value, end:$('sf-end').value, breakMin:$('sf-break').value, wage:$('sf-wage').value };
  const h = shiftHours(tmp);
  const pay = shiftPay(tmp);
  $('sf-hours').textContent = h.toFixed(1) + 'h';
  $('sf-pay').textContent = fmtYen(pay);
}
['sf-start','sf-end','sf-break','sf-wage'].forEach(id=> $(id).addEventListener('input', updateShiftPreview));

/* ---- よく使うシフトパターン ---- */
function renderShiftPatternChips(){
  const wrap = $('sf-pattern-chips');
  wrap.innerHTML = '';
  if(!state.shiftPatterns.length){
    wrap.innerHTML = '<span style="font-size:11px;color:var(--text-faint);">まだ保存されたパターンはありません</span>';
    return;
  }
  state.shiftPatterns.forEach(p=>{
    const box = document.createElement('span');
    box.className = 'pattern-chip-wrap';
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = `${p.name}(${p.start}-${p.end})`;
    chip.addEventListener('click', ()=>{
      $('sf-start').value = p.start; $('sf-end').value = p.end;
      $('sf-break').value = p.breakMin; $('sf-wage').value = (p.wage==null?'':p.wage);
      updateShiftPreview();
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'chip-del';
    del.textContent = '✕';
    del.addEventListener('click', (e)=>{
      e.stopPropagation();
      if(confirm(`「${p.name}」を削除しますか？`)){
        state.shiftPatterns = state.shiftPatterns.filter(x=>x.id!==p.id);
        saveState();
        renderShiftPatternChips();
      }
    });
    box.appendChild(chip); box.appendChild(del);
    wrap.appendChild(box);
  });
}
$('sf-save-pattern').addEventListener('click', ()=>{
  const start = $('sf-start').value, end = $('sf-end').value;
  if(!start || !end){ alert('時刻を入力してから保存してください'); return; }
  const name = prompt('パターン名を入力してください（例: 早番、週末シフトなど）', '');
  if(!name || !name.trim()) return;
  state.shiftPatterns.push({
    id: uid(), name: name.trim(), start, end,
    breakMin: Number($('sf-break').value)||0,
    wage: $('sf-wage').value === '' ? null : Number($('sf-wage').value)
  });
  saveState();
  renderShiftPatternChips();
  showToast('パターンを保存しました');
});

/* ---- 保存処理（新規追加／編集どちらも対応） ---- */
$('sf-save').addEventListener('click', ()=>{
  const date = $('sf-date').value;
  if(!date){ alert('日付を選んでください'); return; }
  const start = $('sf-start').value, end = $('sf-end').value;
  if(!start || !end){ alert('時刻を入力してください'); return; }
  const breakMin = Number($('sf-break').value)||0;
  const wage = $('sf-wage').value === '' ? null : Number($('sf-wage').value);

  if(editContext && editContext.kind==='shift'){
    const s = state.shifts.find(x=>x.id===editContext.id);
    if(s){ s.date=date; s.start=start; s.end=end; s.breakMin=breakMin; s.wage=wage; }
  } else {
    state.shifts.push({ id: uid(), date, start, end, breakMin, wage });
  }
  state.lastShiftInput = { start, end, breakMin, wage };
  saveState();
  const wasEdit = !!editContext;
  editContext = null;
  $('modal-add').classList.remove('show');
  showToast(wasEdit ? 'シフトを更新しました' : 'シフトを保存しました');
  renderMonth(); renderWeek(); renderLedger();
  if($('modal-day').classList.contains('show')) openDayModal(date);
});

$('tf-save').addEventListener('click', ()=>{
  const date = $('tf-date').value;
  const amount = Number($('tf-amount').value);
  if(!date){ alert('日付を選んでください'); return; }
  if(!amount || amount<=0){ alert('金額を入力してください'); return; }
  const isBiz = currentTxnType==='expense' ? currentTxnIsBiz : false;

  if(editContext && editContext.kind==='txn'){
    const t = state.transactions.find(x=>x.id===editContext.id);
    if(t){ t.date=date; t.type=currentTxnType; t.category=currentTxnCat; t.amount=amount; t.memo=$('tf-memo').value.trim(); t.isBiz=isBiz; }
  } else {
    state.transactions.push({
      id: uid(), date, type: currentTxnType, category: currentTxnCat,
      amount, memo: $('tf-memo').value.trim(), isBiz
    });
  }
  saveState();
  const wasEdit = !!editContext;
  editContext = null;
  $('modal-add').classList.remove('show');
  $('tf-amount').value = ''; $('tf-memo').value = '';
  showToast(wasEdit ? '更新しました' : '保存しました');
  renderMonth(); renderWeek(); renderLedger();
  if($('modal-day').classList.contains('show')) openDayModal(date);
});

$('ef-save').addEventListener('click', ()=>{
  const date = $('ef-date').value;
  const title = $('ef-title').value.trim();
  if(!date){ alert('日付を選んでください'); return; }
  if(!title){ alert('予定のタイトルを入力してください'); return; }
  const time = $('ef-time').value || null;
  const memo = $('ef-memo').value.trim();

  if(editContext && editContext.kind==='event'){
    const ev = state.events.find(x=>x.id===editContext.id);
    if(ev){ ev.date=date; ev.title=title; ev.time=time; ev.memo=memo; }
  } else {
    state.events.push({ id: uid(), date, title, time, memo });
  }
  saveState();
  const wasEdit = !!editContext;
  editContext = null;
  $('modal-add').classList.remove('show');
  showToast(wasEdit ? '予定を更新しました' : '予定を保存しました');
  renderMonth(); renderWeek(); renderLedger();
  if($('modal-day').classList.contains('show')) openDayModal(date);
});

/* ==========================================================
   日別詳細モーダル
   ========================================================== */
let currentDayStr = null;

function openDayModal(dateStr){
  currentDayStr = dateStr;
  const d = parseYMD(dateStr);
  $('day-modal-title').textContent = `${d.getMonth()+1}月${d.getDate()}日(${YOUBI[d.getDay()]})`;
  renderDayDetail(dateStr);
  $('modal-day').classList.add('show');
}
function renderDayDetail(dateStr){
  const wrap = $('day-detail-list');
  wrap.innerHTML = '';
  const paydayMap = computePaydayMap();
  const dayShifts = shiftsOnDate(dateStr);
  const dayEvents = eventsOnDate(dateStr);
  const dayTxns = txnsOnDate(dateStr);
  const payday = paydayMap[dateStr];

  if(!dayShifts.length && !dayEvents.length && !dayTxns.length && !payday){
    wrap.innerHTML = '<div class="empty-note">この日の記録はまだありません</div>';
    return;
  }
  if(payday){
    const row = document.createElement('div');
    row.className = 'day-detail-item';
    row.innerHTML = `<div class="ddi-main"><div class="ddi-t">💰 給料日</div><div class="ddi-s">${payday.count}件のシフト分</div></div>`;
    const amt = document.createElement('span'); amt.style.fontWeight='800'; amt.style.color='var(--blue-dark)';
    amt.textContent = fmtYen(payday.total);
    row.appendChild(amt);
    wrap.appendChild(row);
  }
  dayEvents.forEach(ev=>{
    const row = document.createElement('div');
    row.className = 'day-detail-item event';
    row.innerHTML = `<div class="ddi-main"><div class="ddi-t">📅 ${ev.time ? ev.time+' ' : ''}${ev.title}</div><div class="ddi-s">${ev.memo||''}</div></div>`;
    const actions = document.createElement('div');
    actions.className = 'ddi-actions';
    const edit = document.createElement('button');
    edit.className = 'edit-btn'; edit.textContent = '編集';
    edit.addEventListener('click', ()=> openAddModal(dateStr, 'event', ev.id));
    const del = document.createElement('button');
    del.textContent = '削除';
    del.addEventListener('click', ()=> deleteEvent(ev.id));
    actions.appendChild(edit); actions.appendChild(del);
    row.appendChild(actions);
    wrap.appendChild(row);
  });
  dayShifts.forEach(s=>{
    const row = document.createElement('div');
    row.className = 'day-detail-item';
    row.innerHTML = `<div class="ddi-main"><div class="ddi-t">バイト ${s.start}-${s.end}</div><div class="ddi-s">${shiftHours(s).toFixed(1)}h・時給${fmtYen(shiftWage(s))}・${fmtYen(shiftPay(s))}</div></div>`;
    const actions = document.createElement('div');
    actions.className = 'ddi-actions';
    const edit = document.createElement('button');
    edit.className = 'edit-btn'; edit.textContent = '編集';
    edit.addEventListener('click', ()=> openAddModal(dateStr, 'shift', s.id));
    const del = document.createElement('button');
    del.textContent = '削除';
    del.addEventListener('click', ()=> deleteShift(s.id));
    actions.appendChild(edit); actions.appendChild(del);
    row.appendChild(actions);
    wrap.appendChild(row);
  });
  dayTxns.forEach(t=>{
    const row = document.createElement('div');
    row.className = 'day-detail-item';
    const bizTag = t.isBiz ? ' <span style="color:var(--pink-dark);font-weight:700;">🧾経費</span>' : '';
    row.innerHTML = `<div class="ddi-main"><div class="ddi-t">${t.type==='income'?'📥':'📤'} ${t.category}${bizTag}</div><div class="ddi-s">${t.memo||''}　${(t.type==='expense'?'-':'+')}${fmtYen(t.amount)}</div></div>`;
    const actions = document.createElement('div');
    actions.className = 'ddi-actions';
    const edit = document.createElement('button');
    edit.className = 'edit-btn'; edit.textContent = '編集';
    edit.addEventListener('click', ()=> openAddModal(dateStr, 'txn', t.id));
    const del = document.createElement('button');
    del.textContent = '削除';
    del.addEventListener('click', ()=> deleteTxn(t.id));
    actions.appendChild(edit); actions.appendChild(del);
    row.appendChild(actions);
    wrap.appendChild(row);
  });
}
$('day-modal-close').addEventListener('click', ()=> $('modal-day').classList.remove('show'));
$('modal-day').addEventListener('click', (e)=>{ if(e.target.id==='modal-day') $('modal-day').classList.remove('show'); });
$('day-add-shift').addEventListener('click', ()=> openAddModal(currentDayStr, 'shift'));
$('day-add-txn').addEventListener('click', ()=> openAddModal(currentDayStr, 'txn'));
$('day-add-event').addEventListener('click', ()=> openAddModal(currentDayStr, 'event'));

function deleteShift(id){
  state.shifts = state.shifts.filter(s=>s.id!==id);
  saveState();
  showToast('削除しました');
  renderDayDetail(currentDayStr);
  renderMonth(); renderWeek(); renderLedger();
}
function deleteTxn(id){
  state.transactions = state.transactions.filter(t=>t.id!==id);
  saveState();
  showToast('削除しました');
  if($('modal-day').classList.contains('show')) renderDayDetail(currentDayStr);
  renderMonth(); renderWeek(); renderLedger();
}
function deleteEvent(id){
  state.events = state.events.filter(e=>e.id!==id);
  saveState();
  showToast('削除しました');
  if($('modal-day').classList.contains('show')) renderDayDetail(currentDayStr);
  renderMonth(); renderWeek(); renderLedger();
}

/* ==========================================================
   初期化
   ========================================================== */
renderMonth();
renderWeek();
renderLedger();
renderSettings();

// ホーム画面(index.html)から ?tab=week のように渡された場合、そのタブを開く。
// ?openToday=1 が付いていれば、今日の日別詳細モーダルも自動で開く。
(function applyUrlParams(){
  const params = new URLSearchParams(location.search);
  const tabParam = params.get('tab');
  if(tabParam){
    const btn = [...document.querySelectorAll('.tab')].find(b=>b.dataset.tab===tabParam);
    if(btn) btn.click();
  }
  if(params.get('openToday')==='1'){
    openDayModal(todayStr());
  }
})();
