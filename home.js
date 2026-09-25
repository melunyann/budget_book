/* ==========================================================
   おかねびより - home.js
   ホーム画面（キャラクターダッシュボード）
   app.html と同じ localStorage(STORAGE_KEY) を参照・更新する
   ========================================================== */

const STORAGE_KEY = 'okanebiyori_v1';
const $ = (id) => document.getElementById(id);

/* ---------------- state ---------------- */
function defaultState(){
  return {
    settings: {
      hourlyWage: 1100, closingDay: 'end', paydayOffset: 1, paydayDay: 25,
      characterName: 'アリス', themeColor: '#6FB8DE', startingBalance: 0, illustrationDataUrl: null
    },
    shifts: [], transactions: [], events: [], shiftPatterns: [], lastShiftInput: null
  };
}
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
  }catch(e){ console.error('load error', e); return defaultState(); }
}
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
let state = loadState();

/* ---------------- date utils ---------------- */
function pad2(n){ return String(n).padStart(2,'0'); }
function ymd(y,m,d){ return `${y}-${pad2(m)}-${pad2(d)}`; }
function ymdFromDate(dt){ return ymd(dt.getFullYear(), dt.getMonth()+1, dt.getDate()); }
function parseYMD(s){ const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d); }
function daysInMonth(y,m){ return new Date(y,m,0).getDate(); }
function addMonthsYM(y,m,n){ const total=(m-1)+n; const ny=y+Math.floor(total/12); const nm=((total%12)+12)%12+1; return {y:ny,m:nm}; }
function todayStr(){ return ymdFromDate(new Date()); }
function fmtYen(n){ return '¥' + Math.round(n).toLocaleString('ja-JP'); }
function fmtSignedYen(n){ const v=Math.round(n); return (v>0?'+':'') + '¥' + v.toLocaleString('ja-JP'); }
const YOUBI = ['日','月','火','水','木','金','土'];
const YOUBI_EN = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

/* ---------------- pay calc（app.js と同じロジック） ---------------- */
function shiftMinutes(shift){
  const [sh,sm] = shift.start.split(':').map(Number);
  const [eh,em] = shift.end.split(':').map(Number);
  let mins = (eh*60+em) - (sh*60+sm);
  if(mins < 0) mins += 24*60;
  mins -= (Number(shift.breakMin)||0);
  return Math.max(0, mins);
}
function shiftHours(shift){ return shiftMinutes(shift)/60; }
function shiftWage(shift){
  return (shift.wage !== undefined && shift.wage !== null && shift.wage !== '') ? Number(shift.wage) : Number(state.settings.hourlyWage);
}
function shiftPay(shift){ return Math.floor(shiftHours(shift) * shiftWage(shift)); }
function resolveClosingDay(y,m){ const c=state.settings.closingDay; return c==='end' ? daysInMonth(y,m) : Math.min(Number(c),daysInMonth(y,m)); }
function resolvePaydayDay(y,m){ const p=state.settings.paydayDay; return p==='end' ? daysInMonth(y,m) : Math.min(Number(p),daysInMonth(y,m)); }
function getPeriodForDate(dateStr){
  const d=parseYMD(dateStr); const y=d.getFullYear(), m=d.getMonth()+1, day=d.getDate();
  const closing = resolveClosingDay(y,m);
  if(day<=closing) return {y,m};
  const nxt = addMonthsYM(y,m,1); return {y:nxt.y, m:nxt.m};
}
function getPaydayDate(py,pm){
  const off = Number(state.settings.paydayOffset);
  const {y,m} = addMonthsYM(py,pm,off);
  return new Date(y, m-1, resolvePaydayDay(y,m));
}
function computePaydayMap(){
  const periodTotals={}, periodCounts={};
  state.shifts.forEach(sh=>{
    const {y,m} = getPeriodForDate(sh.date);
    const key = `${y}-${m}`;
    periodTotals[key] = (periodTotals[key]||0) + shiftPay(sh);
    periodCounts[key] = (periodCounts[key]||0) + 1;
  });
  const map = {};
  Object.keys(periodTotals).forEach(key=>{
    const [py,pm] = key.split('-').map(Number);
    const pdStr = ymdFromDate(getPaydayDate(py,pm));
    if(!map[pdStr]) map[pdStr] = {total:0, count:0};
    map[pdStr].total += periodTotals[key];
    map[pdStr].count += periodCounts[key];
  });
  return map;
}
function shiftsOnDate(dateStr){ return state.shifts.filter(s=>s.date===dateStr); }
function eventsOnDate(dateStr){
  return state.events.filter(e=>e.date===dateStr).sort((a,b)=>{
    if(!a.time && !b.time) return 0; if(!a.time) return -1; if(!b.time) return 1;
    return a.time < b.time ? -1 : 1;
  });
}
function txnsInMonth(y,m){
  return state.transactions.filter(t=>{ const d=parseYMD(t.date); return d.getFullYear()===y && d.getMonth()+1===m; });
}
function monthLedgerTotals(y,m,paydayMap){
  paydayMap = paydayMap || computePaydayMap();
  let income=0, expense=0;
  Object.keys(paydayMap).forEach(dateStr=>{
    const d = parseYMD(dateStr);
    if(d.getFullYear()===y && d.getMonth()+1===m) income += paydayMap[dateStr].total;
  });
  txnsInMonth(y,m).forEach(t=>{ if(t.type==='income') income += Number(t.amount); else expense += Number(t.amount); });
  return {income, expense};
}
function computeWalletBalance(){
  const today = todayStr();
  let total = Number(state.settings.startingBalance) || 0;
  const paydayMap = computePaydayMap();
  Object.keys(paydayMap).forEach(d=>{ if(d<=today) total += paydayMap[d].total; });
  state.transactions.forEach(t=>{
    if(t.date<=today) total += (t.type==='income' ? Number(t.amount) : -Number(t.amount));
  });
  return total;
}

/* ---------------- テーマカラー ---------------- */
function hexToRgb(hex){
  hex = hex.replace('#','');
  if(hex.length===3) hex = hex.split('').map(c=>c+c).join('');
  const num = parseInt(hex,16);
  return { r:(num>>16)&255, g:(num>>8)&255, b:num&255 };
}
function rgbToHsl(r,g,b){
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  let h,s,l=(max+min)/2;
  if(max===min){ h=s=0; }
  else{
    const d = max-min;
    s = l>0.5 ? d/(2-max-min) : d/(max+min);
    switch(max){
      case r: h=(g-b)/d+(g<b?6:0); break;
      case g: h=(b-r)/d+2; break;
      default: h=(r-g)/d+4;
    }
    h/=6;
  }
  return {h:h*360, s:s*100, l:l*100};
}
function hslToHex(h,s,l){
  h/=360; s/=100; l/=100;
  let r,g,b;
  if(s===0){ r=g=b=l; }
  else{
    const hue2rgb=(p,q,t)=>{ if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
    const q = l<0.5 ? l*(1+s) : l+s-l*s;
    const p = 2*l-q;
    r=hue2rgb(p,q,h+1/3); g=hue2rgb(p,q,h); b=hue2rgb(p,q,h-1/3);
  }
  const toHex = x => Math.round(x*255).toString(16).padStart(2,'0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
function hexToRgba(hex, alpha){
  const {r,g,b} = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}
function applyTheme(hex){
  if(!/^#[0-9a-fA-F]{6}$/.test(hex)) hex = '#6FB8DE';
  const {r,g,b} = hexToRgb(hex);
  const {h,s,l} = rgbToHsl(r,g,b);
  const root = document.documentElement.style;
  root.setProperty('--acc', hex);
  root.setProperty('--acc-light', hslToHex(h, Math.min(100,s+4), Math.min(88,Math.max(l+22,68))));
  root.setProperty('--acc-dark', hslToHex(h, Math.min(100,s+8), Math.max(28,l-16)));
  root.setProperty('--acc-soft', hexToRgba(hex, 0.20));
  root.setProperty('--acc-glow', hexToRgba(hex, 0.42));
}

/* ---------------- イラスト画像の縮小保存 ---------------- */
function readAndResizeImage(file, maxDim, cb){
  const reader = new FileReader();
  reader.onload = ()=>{
    const img = new Image();
    img.onload = ()=>{
      let w = img.width, h = img.height;
      if(w > h && w > maxDim){ h = Math.round(h * maxDim / w); w = maxDim; }
      else if(h >= w && h > maxDim){ w = Math.round(w * maxDim / h); h = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(canvas.toDataURL('image/jpeg', 0.86));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* ---------------- 表示：日付・グリーティング ---------------- */
function renderDate(){
  const now = new Date();
  $('hp-year').textContent = now.getFullYear() + '年';
  $('hp-md').textContent = `${pad2(now.getMonth()+1)}.${pad2(now.getDate())}`;
  $('hp-dow').textContent = YOUBI_EN[now.getDay()];

  const todayShifts = shiftsOnDate(todayStr());
  const todayEvents = eventsOnDate(todayStr());
  let greeting;
  if(todayShifts.length) greeting = '今日はお仕事の日。無理しすぎないでね。';
  else if(todayEvents.length) greeting = '今日は予定があるみたい。準備はできてる？';
  else greeting = '今日はゆっくりできそうだね。';
  $('hp-greeting').textContent = greeting;
}

/* ---------------- 表示：今日のスケジュール ---------------- */
function buildTodaySchedule(){
  const items = [];
  shiftsOnDate(todayStr()).forEach(s=>{
    items.push({ time:s.start, sortKey:s.start, title:`仕事`, isWork:true, sub:`${s.start}-${s.end}` });
  });
  eventsOnDate(todayStr()).forEach(e=>{
    items.push({ time:e.time || '終日', sortKey:e.time || '00:00', title:e.title, isWork:false, sub:e.memo || '' });
  });
  items.sort((a,b)=> a.sortKey < b.sortKey ? -1 : (a.sortKey > b.sortKey ? 1 : 0));
  return items;
}
function renderSchedule(){
  const items = buildTodaySchedule();
  const list = $('hp-schedule-list');
  list.innerHTML = '';
  if(!items.length){
    list.innerHTML = '<div class="sch-empty">今日の予定はまだ登録されていません。</div>';
  } else {
    items.forEach(it=>{
      const row = document.createElement('div');
      row.className = 'sch-item' + (it.isWork ? ' work' : '');
      row.innerHTML = `<div class="sch-time">${it.time}</div><div class="sch-title">${it.title}${it.isWork ? ' <span class="star">★</span>' : ''}</div>`;
      list.appendChild(row);
    });
  }

  // NEXT：今日の残り予定から一番近いもの（時刻指定のものを優先し、無ければ終日予定）
  const nowHM = pad2(new Date().getHours()) + ':' + pad2(new Date().getMinutes());
  const timedUpcoming = items.filter(it => it.time !== '終日' && it.sortKey >= nowHM);
  const allDay = items.filter(it => it.time === '終日');
  const next = timedUpcoming[0] || allDay[0] || null;
  if(next){
    $('hp-next-item').innerHTML = `<span class="ni-time">${next.time}</span>${next.title}`;
  } else {
    $('hp-next-item').textContent = '今日はもう予定はありません';
  }
  return next;
}

/* ---------------- 表示：吹き出し・バナー ---------------- */
function renderSpeech(nextItem){
  const name = state.settings.characterName || 'アリス';
  $('hp-char-name').textContent = name;
  let msg;
  if(nextItem && nextItem.isWork){
    msg = `おかえり、\n今日は${nextItem.time}からお仕事なんだよね。\n帰ってきたら家計簿も忘れずにつけようね。`;
  } else if(nextItem){
    msg = `おかえり、\n${nextItem.time !== '終日' ? nextItem.time + 'から' : ''}「${nextItem.title}」があるんだったよね。\n準備は大丈夫？`;
  } else {
    msg = `おかえり、\n今日はもう特に予定はなさそう。\nゆっくり休んでね。`;
  }
  $('hp-speech-text').textContent = msg;
  $('hp-greet-banner').textContent = nextItem ? '今日もがんばろうね。' : '今日もお疲れさま。';
}

/* ---------------- 表示：お金まわり ---------------- */
function renderMoney(){
  const wallet = computeWalletBalance();
  $('hp-wallet').textContent = fmtYen(wallet);
  $('hp-wallet-mini').textContent = fmtYen(wallet);

  const now = new Date();
  const paydayMap = computePaydayMap();
  const {income, expense} = monthLedgerTotals(now.getFullYear(), now.getMonth()+1, paydayMap);
  const bal = income - expense;
  const balEl = $('hp-month-balance');
  balEl.textContent = fmtSignedYen(bal);
  balEl.className = 'mr-val ' + (bal>=0 ? 'pos' : 'neg');

  const todayStrV = todayStr();
  const future = Object.keys(paydayMap).filter(d=>d>=todayStrV).sort();
  if(future.length){
    const d = parseYMD(future[0]);
    $('hp-next-payday').textContent = `${pad2(d.getMonth()+1)}/${pad2(d.getDate())}(${YOUBI[d.getDay()]})`;
  } else {
    $('hp-next-payday').textContent = '予定なし';
  }
}

/* ---------------- 表示：お知らせ ---------------- */
function renderNotices(){
  const wrap = $('hp-notice-list');
  wrap.innerHTML = '';
  const notices = [];
  const now = new Date();
  const todayStrV = todayStr();

  // 今週のシフト
  const weekEndStr = ymdFromDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()+7));
  const upcomingShifts = state.shifts.filter(s => s.date >= todayStrV && s.date <= weekEndStr);
  if(upcomingShifts.length){
    const nearest = upcomingShifts.slice().sort((a,b)=> a.date<b.date?-1:1)[0];
    const d = parseYMD(nearest.date);
    notices.push({ icon:'🕒', text:`今週のシフトが${upcomingShifts.length}件登録されています`, date:`${pad2(d.getMonth()+1)}/${pad2(d.getDate())}` });
  }

  // 支出の増加（今月 vs 先月）
  const thisMonthTotals = monthLedgerTotals(now.getFullYear(), now.getMonth()+1);
  const prevYM = addMonthsYM(now.getFullYear(), now.getMonth()+1, -1);
  const prevMonthTotals = monthLedgerTotals(prevYM.y, prevYM.m);
  if(prevMonthTotals.expense > 0 && thisMonthTotals.expense > prevMonthTotals.expense * 1.15){
    const pct = Math.round((thisMonthTotals.expense/prevMonthTotals.expense - 1) * 100);
    notices.push({ icon:'📈', text:`支出が先月より増えています(+${pct}%)`, date:`${pad2(now.getMonth()+1)}/${pad2(now.getDate())}` });
  }

  // 月末リマインド
  const lastDay = daysInMonth(now.getFullYear(), now.getMonth()+1);
  if(now.getDate() >= lastDay - 4){
    notices.push({ icon:'🗒️', text:`${now.getMonth()+1}月の収支を確認しましょう`, date:`${pad2(now.getMonth()+1)}/${pad2(lastDay)}` });
  }

  if(!notices.length){
    wrap.innerHTML = '<div class="notice-empty">特にお知らせはありません。今日もお疲れさま。</div>';
    $('hp-notif-dot') && ($('hp-notif-dot').style.display = 'none');
    return;
  }
  notices.slice(0,3).forEach(n=>{
    const row = document.createElement('div');
    row.className = 'notice-row';
    row.innerHTML = `<span class="ni-ic">${n.icon}</span><span>${n.text}</span><span class="ni-date">${n.date}</span>`;
    wrap.appendChild(row);
  });
}

/* ---------------- 表示：レベル（記録数に応じたおまけ要素） ---------------- */
function renderLevel(){
  const total = state.shifts.length + state.transactions.length + state.events.length;
  const lv = Math.floor(total/10) + 1;
  const progress = total % 10;
  $('hp-lv').textContent = lv;
  $('hp-lv-next').textContent = (10 - progress);
  $('hp-lv-fill').style.width = (progress/10*100) + '%';
}

/* ---------------- 表示：イラスト ---------------- */
function renderIllust(){
  const url = state.settings.illustrationDataUrl;
  const bg = $('hp-illust-bg');
  const empty = $('hp-illust-empty');
  if(url){
    bg.style.backgroundImage = `url('${url}')`;
    empty.style.display = 'none';
  } else {
    bg.style.backgroundImage = 'none';
    empty.style.display = 'flex';
  }
  $('hp-mini-avatar').style.backgroundImage = url ? `url('${url}')` : 'none';
}

/* ---------------- 全体再描画 ---------------- */
function renderAll(){
  applyTheme(state.settings.themeColor || '#6FB8DE');
  renderDate();
  const next = renderSchedule();
  renderSpeech(next);
  renderMoney();
  renderNotices();
  renderLevel();
  renderIllust();
}

/* ---------------- 予定追加（app.html へ） ---------------- */
$('hp-add-schedule').addEventListener('click', ()=>{
  location.href = 'app.html?tab=month&openToday=1';
});

/* ---------------- ボトムナビ ---------------- */
document.querySelectorAll('.nav-item').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    if(btn.dataset.href){ location.href = btn.dataset.href; }
    else if(btn.dataset.action === 'settings'){ openSettingsModal(); }
  });
});

/* ---------------- 画像アップロード（ホーム画面の空状態から直接） ---------------- */
$('hp-illust-upload-btn').addEventListener('click', ()=> $('hp-illust-input').click());
$('hp-illust-input').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  readAndResizeImage(file, 1600, (dataUrl)=>{
    state.settings.illustrationDataUrl = dataUrl;
    saveState();
    renderIllust();
    showToast('イラストを設定しました');
  });
  e.target.value = '';
});

/* ---------------- キャラクター設定モーダル ---------------- */
const THEME_PRESETS = ['#6FB8DE','#F2617E','#9C8FE0','#8FD48A','#F6C667','#E0879C'];

function openSettingsModal(){
  $('hp-settings-name').value = state.settings.characterName || '';
  $('hp-settings-color').value = state.settings.themeColor || '#6FB8DE';
  $('hp-settings-balance').value = state.settings.startingBalance || 0;
  renderSettingsPreview();
  renderThemeSwatches();
  $('hp-settings-modal').classList.add('show');
}
function renderSettingsPreview(){
  const prev = $('hp-settings-preview');
  const url = state.settings.illustrationDataUrl;
  if(url){ prev.style.backgroundImage = `url('${url}')`; prev.textContent = ''; }
  else { prev.style.backgroundImage = 'none'; prev.textContent = '未設定'; }
}
function renderThemeSwatches(){
  const wrap = $('hp-theme-swatches');
  wrap.innerHTML = '';
  THEME_PRESETS.forEach(hex=>{
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'theme-swatch';
    sw.style.background = hex;
    sw.addEventListener('click', ()=>{ $('hp-settings-color').value = hex; applyTheme(hex); });
    wrap.appendChild(sw);
  });
}
$('hp-settings-btn').addEventListener('click', openSettingsModal);
$('hp-char-settings-open').addEventListener('click', openSettingsModal);
$('hp-settings-close').addEventListener('click', ()=>{
  $('hp-settings-modal').classList.remove('show');
  applyTheme(state.settings.themeColor || '#6FB8DE'); // ライブプレビューを保存前の色に戻す
});
$('hp-settings-modal').addEventListener('click', (e)=>{ if(e.target.id==='hp-settings-modal'){ $('hp-settings-modal').classList.remove('show'); applyTheme(state.settings.themeColor || '#6FB8DE'); } });
$('hp-settings-color').addEventListener('input', (e)=> applyTheme(e.target.value)); // ライブプレビュー

$('hp-settings-upload-btn').addEventListener('click', ()=> $('hp-illust-input').click());
$('hp-settings-remove-btn').addEventListener('click', ()=>{
  if(confirm('イラストを削除しますか？')){
    state.settings.illustrationDataUrl = null;
    saveState();
    renderSettingsPreview();
    renderIllust();
    showToast('イラストを削除しました');
  }
});
// ホーム空状態からの選択でも「設定モーダルを開いていた場合」プレビューを更新できるよう、input change 側でも反映
$('hp-illust-input').addEventListener('change', ()=>{
  setTimeout(renderSettingsPreview, 50);
});

$('hp-settings-save').addEventListener('click', ()=>{
  state.settings.characterName = $('hp-settings-name').value.trim() || 'アリス';
  state.settings.themeColor = $('hp-settings-color').value;
  state.settings.startingBalance = Number($('hp-settings-balance').value) || 0;
  saveState();
  $('hp-settings-modal').classList.remove('show');
  showToast('保存しました');
  renderAll();
});

/* ---------------- トースト ---------------- */
let toastTimer = null;
function showToast(msg){
  const t = $('hp-toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> t.classList.remove('show'), 1800);
}

/* ---------------- 初期化 ---------------- */
renderAll();
