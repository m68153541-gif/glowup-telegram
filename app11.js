/* =====================================================================
   GLOW UP — Telegram Mini App (веб-версия)
   Меню, магазин 3D-НФТ, мины, ячейки, продажа. 3D через Three.js (локально).
   ===================================================================== */

// ---------- Настройки ----------
const ADMIN_ID   = 8513244807;         // Telegram ID админа
const DONATE_BOT = 'gLOWOPPBOT';       // бот для доната
const DONATE_MIN = 5;                  // минимум звёзд
const LOC2_LEVEL = 50;                 // уровень для второй локации
const LOC2_BOOST = 1.00678;            // +0.678% к шансам
let isAdmin = false;
const KEY_PRICE   = 100;
const KEY_PACKS   = [ {n:1, price:100}, {n:5, price:500}, {n:10, price:1000} ];
const GIFT_INTERVAL = 24*60*60*1000;  // раз в 24 часа
const GIFT_KEYS     = 3;               // 3 ключа за подарок
const LEVEL_XP      = 150;             // звёзд на 1 уровень
// Токен Telegram-бота (тестовый). Используется для серверных вызовов Telegram Bot API.
const BOT_TOKEN   = '9079841137:AAGFVzPLH2-3bgsYDu-yBL587CzbEXTQ1g4';

const DEFAULT_STATE = {
  stars: 0,
  keys: 0,
  owned: [],            // id купленных моделей
  cellsOpened: [],
  userNFT: null,        // модель у ника
  mined: { lastMineTime: 0 },   // для мины — пока просто хранит последнее
  marketLock: {},       // modelId -> ts когда можно выставить на рынок
  cellResetAt: 0,       // ts автоматического сброса ячеек (14:00 МСК)
  cellForceReset: false,
  gift: { lastClaim: 0 },   // ts последнего получения ежедневного подарка
  level: 1,              // уровень игрока
  levelXp: 0,            // опыт текущего уровня (0..150)
  usedCodes: {},         // активированные коды (чтобы не фармить повторно)
  firstSeen: 0,          // ts первого захода (для «часов в игре»)
  gamesPlayed: 0,        // сыграно раундов в играх
  gifts: {},             // инвентарь подарков: id -> количество
  giftStarter: false,    // выданы ли стартовые подарки
};

const MODEL_CATALOG = [
  { id:'1', name:'DianaLovis', rarity:'legendary', price:1000, model:'assets/DianaLovis.glb', image:'assets/фон_модели_DianaLovis.png' },
  { id:'2', name:'LerwaxiMi', rarity:'epic',      price:2500, model:'assets/LerwaxiMi.glb', image:'assets/фон_модели_LerwaxiMi.png' },
  { id:'3', name:'Sweaty',     rarity:'common',   price:900,  model:'assets/Sweaty.glb', image:'assets/фон_модели_Sweaty.png' },
  { id:'4', name:'lilgoga',    rarity:'epic',     price:1500, model:'assets/lilgoga.glb', image:'assets/фон_модели_lilgoga.png' },
];

// ---------- Ячейки: 30, два больших приза 300-500, остальные мелкие ----------
const CELL_COUNT = 30;
const CELL_RESET_COST = 300;
const CELL_AUTO_HOUR = 14;   // 14:00 МСК

// генерация случайного пула ячеек (у каждого игрока свой)
function genCellPool(){
  // 2 больших приза 300..500, 4 средних ключей, 4*10/30 звёзд, остальные пусто
  const arr = [];
  for(let i=0;i<CELL_COUNT;i++) arr.push({ type:'none', stars:0, icon:'•' });
  const big = [];
  for(let i=0;i<2;i++) big.push({ type:'big', stars: 300 + Math.floor(Math.random()*201), icon:'💎' });
  for(let i=0;i<4;i++) arr.push({ type:'key', stars:0, icon:'🔑' });
  for(let i=0;i<4;i++) arr.push({ type:'stars', stars:10, icon:'⭐' });
  for(let i=0;i<4;i++) arr.push({ type:'stars', stars:30, icon:'⭐' });
  arr.splice(0, 0+big[0]);
  // проще: собрать список результатов и перемешать
  const tmp = [];
  big.forEach(b=>tmp.push(b));
  for(let i=0;i<4;i++) tmp.push({ type:'key', stars:0, icon:'🔑' });
  for(let i=0;i<4;i++) tmp.push({ type:'stars', stars:10, icon:'⭐' });
  for(let i=0;i<4;i++) tmp.push({ type:'stars', stars:30, icon:'⭐' });
  while(tmp.length<CELL_COUNT) tmp.push({ type:'none', stars:0, icon:'•' });
  for(let i=tmp.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [tmp[i],tmp[j]]=[tmp[j],tmp[i]]; }
  return tmp;
}

// ---------- Время обновления ячеек ----------
function nextCellResetTs(){
  // следующий 14:00 МСК (UTC+3)
  const now = new Date();
  const ms = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0, 0, 0).getTime();
  const offset = 3 * 3600 * 1000; // МСК = UTC+3, но Date() локальный — используем локальный час из настроек
  return ms + (cellResetOffsetHoursDiff()); // упрощено ниже
}
function cellResetOffsetHoursDiff(){
  // если сейчас в системе часовой пояс, считаем до 14:00 локально игрока = 14:00 МСК у всех
  return 0;
}
function computeNextReset(){
  const now = new Date();
  let ts = new Date(now.getFullYear(), now.getMonth(), now.getDate(), CELL_AUTO_HOUR, 0, 0, 0).getTime();
  if (ts <= now.getTime()) ts += 24*3600*1000;
  return ts;
}

// ---------- Ёмкость для пула ячеек (персистент) ----------
let cellPool = [];

function ensureCellPool(){
  try{
    const saved = localStorage.getItem('celupool');
    if(saved){ cellPool = JSON.parse(saved); }
  }catch(_){}
  if(cellPool.length !== CELL_COUNT){
    cellPool = genCellPool();
    try{ localStorage.setItem('celupool', JSON.stringify(cellPool)); }catch(_){}
  }
}

let state = null, tg = null, isTG = false;

// ---------- DOM ----------
const $ = s=>document.querySelector(s);
const el = {
  avatarImg:$('#avatarImg'), avatarPh:$('#avatarPh'),
  userName:$('#userName'), userHandle:$('#userHandle'),
  levelFill:$('#levelFill'), levelNum:$('#levelNum'),
  avatar:$('#avatar'), profileModal:$('#profileModal'), profileClose:$('#profileClose'),
  nftChip:$('#nftChip'), nftCanvas:$('#nftCanvas'),
  balVal:$('#balVal'), balValShop:$('#balValShop'),
  balBtn:$('#balBtn'), balBtnShop:$('#balBtnShop'),
  keyCountTop:$('#keyCountTop'),
  openOneBtn:$('#openOneBtn'), keyShopBtn:$('#keyShopBtn'), keyBtnTop:$('#keyBtnTop'),
  shopGrid:$('#shopGrid'),
  cellsRack:$('#cellsRack'), cellTimer:$('#cellTimer'), cellResetBtn:$('#cellResetBtn'),
  codeInput:$('#codeInput'), codeApplyBtn:$('#codeApplyBtn'), donateBtn:$('#donateBtn'),
  nftModal:$('#nftModal'), modalMedia:$('#modalMedia'), modalTitle:$('#modalTitle'),
  modalPrice:$('#modalPrice'), modalActions:$('#modalActions'), modalClose:$('#modalClose'),
  viewerModal:$('#viewerModal'), viewerStage:$('#viewerStage'), viewerTitle:$('#viewerTitle'),
  viewerLoading:$('#viewerLoading'), viewerClose:$('#viewerClose'),
  keyShopModal:$('#keyShopModal'), keyShopBalance:$('#keyShopBalance'), keyShopClose:$('#keyShopClose'),
  priceModal:$('#priceModal'), priceInput:$('#priceInput'), priceOkBtn:$('#priceOkBtn'), priceCancelBtn:$('#priceCancelBtn'), priceClose:$('#priceClose'),
  prizeModal:$('#prizeModal'), prizeItem:$('#prizeItem'), prizeText:$('#prizeText'), prizeContinue:$('#prizeContinue'),
  minesBet:$('#minesBet'), minesMineBtns:null, minesGrid:$('#minesGrid'), minesCashout:$('#minesCashout'),
  minesStart:$('#minesStart'), minesBalance:$('#minesBalance'), minesMultiplier:$('#minesMultiplier'),
  // подарок
  giftFab:$('#giftFab'), giftClaimBtn:$('#giftClaimBtn'), giftTimer:$('#giftTimer'), giftHero:$('#giftHero'),
  // карта
  mapBtn:$('#mapBtn'), mapModal:$('#mapModal'), mapClose:$('#mapClose'),
  // кейсы
  casesBalance:$('#casesBalance'), caseGrid:$('#caseGrid'),
  caseModal:$('#caseModal'), caseReel:$('#caseReel'), caseResult:$('#caseResult'), caseClaim:$('#caseClaim'),
  // колесо
  wheelBalance:$('#wheelBalance'), wheelBet:$('#wheelBet'), wheelSpin:$('#wheelSpin'), wheel:$('#wheel'),
  // напёрстки
  cupsBalance:$('#cupsBalance'), cupsBet:$('#cupsBet'), cupsStart:$('#cupsStart'), cupsRow:$('#cupsRow'), cupsHint:$('#cupsHint'),
  // кости
  diceBalance:$('#diceBalance'), dice1:$('#dice1'), dice2:$('#dice2'), diceBet:$('#diceBet'), diceRoll:$('#diceRoll'),
  // дартс
  dartsBalance:$('#dartsBalance'), dartsBoard:$('#dartsBoard'), dart:$('#dart'), dartsBet:$('#dartsBet'), dartsThrow:$('#dartsThrow'),
  // выше-ниже
  hiloBalance:$('#hiloBalance'), hiloCur:$('#hiloCur'), hiloNext:$('#hiloNext'), hiloBet:$('#hiloBet'), hiloPull:$('#hiloPull'),
  // плинко
  plinkoBalance:$('#plinkoBalance'), plinkoCanvas:$('#plinkoCanvas'), plinkoBet:$('#plinkoBet'), plinkoDrop:$('#plinkoDrop'),
  // апгрейдер
  upBalance:$('#upBalance'), upBet:$('#upBet'), upChanceStars:$('#upChanceStars'), upTargetStars:$('#upTargetStars'),
  upFromGifts:$('#upFromGifts'), upToGifts:$('#upToGifts'), upChanceGifts:$('#upChanceGifts'),
  upDial:$('#upDial'), upSector:$('#upSector'), upPointer:$('#upPointer'), upGo:$('#upGo'), upHistory:$('#upHistory'),
  upStarsPane:$('#upStarsPane'), upGiftsPane:$('#upGiftsPane'),
  toasts:$('#toasts'),
};

// ---------- Telegram ----------
function initTelegram(){
  if (window.Telegram && window.Telegram.WebApp){
    tg = window.Telegram.WebApp; isTG = true;
    try{
      tg.ready();
      tg.expand();
      tg.enableClosingConfirmation && tg.enableClosingConfirmation();
    }catch(_){}
    const u = tg.initDataUnsafe && tg.initDataUnsafe.user;
    if (u){
      state.tgId = u.id; state.tgUsername = u.username || '';
      isAdmin = (Number(u.id) === ADMIN_ID);
      trackOnline(u.id);
      el.userName.textContent = u.first_name || 'Игрок';
      el.userHandle.textContent = u.username ? '@'+u.username : 'id '+u.id;
      cloudPull(()=>{ try{ renderBalance(); renderLevel(); renderNFT(); renderCells(); renderLocUI(); }catch(_){} });
      if (u.photo_url){ el.avatarImg.src=u.photo_url; el.avatarImg.style.display='block'; el.avatarPh.style.display='none'; }
      try{
        // точный фон под Telegram
        const dark = tg.colorScheme === 'dark';
        tg.setHeaderColor && tg.setHeaderColor(dark ? '#0a0a0f' : '#f3f2ee');
        tg.setBackgroundColor && tg.setBackgroundColor(dark ? '#0a0a0f' : '#f3f2ee');
      }catch(_){}
    }
    // скрыть системную кнопку Телеграма — у нас своя навигация
    try{ tg.MainButton && tg.MainButton.hide(); }catch(_){}
  }
}
// кнопка «назад» в шапке Telegram (нативная, слева) — включаем
function tgSetBack(cb){
  if (tg && isTG && tg.BackButton){
    try{ tg.BackButton.show(); tg.BackButton.onClick(cb); }catch(_){}
  }
}
function tgHideBack(){
  if (tg && isTG && tg.BackButton){
    try{ tg.BackButton.hide(); }catch(_){}
  }
}

// ---------- Онлайн (тихий учёт) ----------
function trackOnline(uid){
  try{
    const KEY='glowup_online_v1'; const now=Date.now();
    const map=JSON.parse(localStorage.getItem(KEY)||'{}');
    if(uid) map[uid]=now;
    Object.keys(map).forEach(k=>{ if(now-map[k] > 5*60*1000) delete map[k]; });
    localStorage.setItem(KEY, JSON.stringify(map));
    state.onlineCount = Object.keys(map).length;
  }catch(_){}
}

// ---------- Локации ----------
function chanceBoost(){ return state.loc===2 ? LOC2_BOOST : 1; }
function bonusHit(){ return state.loc===2 && Math.random() < (LOC2_BOOST-1); }
function renderLocUI(){
  const b=document.getElementById('locBanner'); if(b) b.style.display=(state.loc===2)?'flex':'none';
  const back=document.getElementById('locBackBtn'); if(back) back.style.display=(state.loc===2)?'flex':'none';
  const grid=document.querySelector('.menu-grid'); if(grid) grid.classList.toggle('loc2-order', state.loc===2);
  const mark=document.getElementById('mapMark2');
  if(mark){
    const open=(state.level||1)>=LOC2_LEVEL;
    mark.classList.toggle('locked', !open);
    mark.classList.toggle('gold', open);
    mark.title = open ? 'Локация 2' : ('Откроется на '+LOC2_LEVEL+' уровне');
  }
}
function setLoc(n){
  state.loc=n; save();
  document.body.classList.toggle('loc2', n===2);
  renderLocUI();
}
function teleportTo(n){
  const ov=document.getElementById('locTransition');
  if(!ov){ setLoc(n); return; }
  ov.classList.add('play');
  setTimeout(()=>setLoc(n), 650);
  setTimeout(()=>ov.classList.remove('play'), 1400);
}

// ---------- Админ ----------
function grantStars(v){
  if(!isAdmin) return;
  v=parseInt(v,10)||0;
  if(v<=0){ toast('Введите сумму'); return; }
  state.stars += v; save(); renderBalance();
  toast('+'+v+' ⭐ зачислено', true);
}
function openAdmin(){
  if(!isAdmin){ return; }
  const m=document.getElementById('adminModal'); if(m) m.classList.add('open');
}
function closeAdmin(){ const m=document.getElementById('adminModal'); if(m) m.classList.remove('open'); }

// ---------- Донат ----------
function donateDeep(amount){
  amount=Math.max(DONATE_MIN, parseInt(amount,10)||DONATE_MIN);
  const url='https://t.me/'+DONATE_BOT+'?start=donate_'+amount;
  try{
    if(window.Telegram && Telegram.WebApp && Telegram.WebApp.openTelegramLink) Telegram.WebApp.openTelegramLink(url);
    else window.open(url,'_blank');
  }catch(_){ window.open(url,'_blank'); }
}

// ---------- Облако (Telegram CloudStorage) ----------
const CS_KEY='glowup_save_v1';
function csApi(){ try{ return (window.Telegram && Telegram.WebApp && Telegram.WebApp.CloudStorage) || null; }catch(_){ return null; } }
let csTimer=null;
function slimState(){
  const o=Object.assign({}, state);
  delete o.onlineCount;
  if(Array.isArray(o.cellsOpened) && o.cellsOpened.length>80) o.cellsOpened=o.cellsOpened.slice(-80);
  return o;
}
function cloudPush(){
  const cs=csApi(); if(!cs) return;
  if(csTimer) clearTimeout(csTimer);
  csTimer=setTimeout(()=>{
    try{
      let raw=JSON.stringify({t:Date.now(), s:slimState()});
      if(raw.length>3800){
        const s2=slimState(); delete s2.history; delete s2.upLog; delete s2.cellsOpened;
        raw=JSON.stringify({t:Date.now(), s:s2});
      }
      if(raw.length>4000){ const s3=slimState(); delete s3.history; delete s3.upLog; delete s3.cellsOpened; delete s3.gifts; raw=JSON.stringify({t:Date.now(), s:s3}); }
      cs.setItem(CS_KEY, raw, ()=>{});
    }catch(_){}
  }, 1200);
}
function cloudPull(after){
  const cs=csApi(); if(!cs) return;
  try{
    cs.getItem(CS_KEY, (err, val)=>{
      if(err || !val){ cloudPush(); return; }
      try{
        const o=JSON.parse(val);
        if(o && o.s && (o.t||0) > (state.updatedAt||0)){
          state = Object.assign({}, state, o.s);
          try{ localStorage.setItem('es3d_v3', JSON.stringify(state)); }catch(_){}
          if(typeof after==='function') after();
        } else { cloudPush(); }
      }catch(_){ cloudPush(); }
    });
  }catch(_){}
}

// ---------- Состояние ----------
function save(){ state.updatedAt=Date.now(); try{ localStorage.setItem('es3d_v3', JSON.stringify(state)); }catch(_){} cloudPush(); }
function load(){
  try{
    const raw = localStorage.getItem('es3d_v3');
    state = raw ? Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_STATE)), JSON.parse(raw)) : JSON.parse(JSON.stringify(DEFAULT_STATE));
    if (state.stars===undefined) state.stars=0;
  }catch(_){ state = JSON.parse(JSON.stringify(DEFAULT_STATE)); }
  ensureCellPool();
}
function model(id){ return MODEL_CATALOG.find(m=>m.id===id); }
function ownedCount(id){ return (state.owned||[]).filter(x=>x===id).length; }
function renderBalance(){
  el.balVal.textContent = state.stars;
  el.balValShop.textContent = state.stars;
  el.keyCountTop.textContent = state.keys;
  if (el.casesBalance) el.casesBalance.textContent = state.stars;
  if (el.wheelBalance) el.wheelBalance.textContent = state.stars;
  if (el.cupsBalance) el.cupsBalance.textContent = state.stars;
  if (el.minesBalance) el.minesBalance.textContent = state.stars;
  if (el.diceBalance) el.diceBalance.textContent = state.stars;
  if (el.dartsBalance) el.dartsBalance.textContent = state.stars;
  if (el.hiloBalance) el.hiloBalance.textContent = state.stars;
  if (el.plinkoBalance) el.plinkoBalance.textContent = state.stars;
  if (el.upBalance) el.upBalance.textContent = state.stars;
  const badge = document.querySelector('[data-badge="keys"]');
  if (badge) badge.textContent = state.keys + ' 🔑';
}

// ---------- Уровень ----------
function renderLevel(){
  const lv = state.level||1;
  const xp = state.levelXp||0;
  if(el.levelNum) el.levelNum.textContent = lv + ' ур.';
  if(el.levelFill) el.levelFill.style.width = Math.min(100, Math.round(xp/LEVEL_XP*100)) + '%';
}
function addXp(amount){
  amount = Math.round(amount||0);
  if(amount<=0) return;
  state.level = state.level||1;
  state.levelXp = (state.levelXp||0) + amount;
  let leveled=false;
  while(state.levelXp >= LEVEL_XP){ state.levelXp -= LEVEL_XP; state.level++; leveled=true; }
  save(); renderLevel();
  if(leveled) toast('Новый уровень: '+state.level+'!', true);
}

// ---------- Профиль / статистика ----------
function fmtHours(ms){
  const h=ms/3600000;
  if(h<1) return Math.max(1, Math.round(ms/60000))+' мин';
  if(h<24) return (Math.round(h*10)/10)+' ч';
  return Math.floor(h)+' ч';
}
function countGame(){ state.gamesPlayed=(state.gamesPlayed||0)+1; save(); }
function openProfile(){
  const name=(el.userName.textContent||'Игрок').trim();
  const handle=(el.userHandle.textContent||'@').trim();
  const pn=document.getElementById('profName'), ph=document.getElementById('profHandle');
  if(pn) pn.textContent=name;
  if(ph) ph.textContent=handle;
  const pa=document.getElementById('profAvatar');
  const ai=document.getElementById('avatarImg');
  if(pa){
    if(ai && ai.style.display!=='none' && ai.getAttribute('src')){ pa.innerHTML='<img src="'+ai.getAttribute('src')+'" alt="">'; }
    else { pa.textContent=name.charAt(0).toUpperCase()||'И'; }
  }
  const set=(id,v)=>{ const n=document.getElementById(id); if(n) n.textContent=v; };
  set('statLevel', state.level||1);
  set('statHours', fmtHours(Date.now()-(state.firstSeen||Date.now())));
  set('statGames', state.gamesPlayed||0);
  set('statStars', state.stars);
  set('statKeys', state.keys);
  set('statXp', (state.levelXp||0)+'/'+LEVEL_XP);
  const med=document.getElementById('adminMedal'); if(med) med.style.display=isAdmin?'flex':'none';
  if(el.profileModal) el.profileModal.classList.add('open');
}

// ---------- Навигация ----------
function goto(name){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const t = document.getElementById('screen-'+name);
  if (!t) return;
  t.classList.add('active');
  if (name==='shop') renderShop();
  if (name==='cells') renderCells();
  if (name==='mines') renderMines();
  if (name==='cases') renderCases();
  if (name==='wheel') renderWheel();
  if (name==='cups') renderCups();
  if (name==='dice') renderDice();
  if (name==='darts') renderDarts();
  if (name==='hilo') renderHilo();
  if (name==='plinko') renderPlinko();
  if (name==='upgrade') renderUpgrade();
  if (name==='gift') renderGiftScreen();
  if (name==='menu') renderGiftFab();
  // нативная кнопка «назад» Telegram на подэкранах
  if (name === 'menu') tgHideBack();
  else {
    if (isTG && !window.__tgBackHooked){
      tgSetBack(()=>goBack());
      window.__tgBackHooked = true;
    }
  }
}
function goBack(){ goto('menu'); }

// ---------- ТОСТЫ ----------
function toast(msg, gold){
  const t = document.createElement('div');
  t.className='toast'+(gold?' gold':''); t.textContent=msg;
  el.toasts.appendChild(t);
  setTimeout(()=>{ t.classList.add('out'); setTimeout(()=>t.remove(),300); }, 2200);
}

/* =====================================================================
   3D МОДУЛЬ (локальный Three.js из assets/vendor)
   ===================================================================== */
let THREEmod=null, GLTFLoaderCls=null, OrbitControlsCls=null, meshoptDecoderRef=null, threeInitDone=false;
let webglOK = null; // null=не проверено, true/false

function hasWebGL(){
  if (webglOK !== null) return webglOK;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
    webglOK = !!gl;
  } catch(e){ webglOK = false; }
  return webglOK;
}

async function threeReady(){
  if (threeInitDone) return true;
  if (!hasWebGL()){ console.warn('3D недоступен: WebGL выключен'); return false; }
  try{
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
    THREEmod=THREE; GLTFLoaderCls=GLTFLoader; OrbitControlsCls=OrbitControls; meshoptDecoderRef=MeshoptDecoder;
    threeInitDone=true;
    return true;
  }catch(e){ console.warn('3D недоступен:', e); return false; }
}

// fallback: показать картинку вместо 3D (если WebGL нет или модель не загрузилась)
function fallbackImage(container, modelId){
  if (!container) return;
  const m = model(modelId);
  container.innerHTML = '';
  const img = document.createElement('img');
  img.src = m ? m.image : '';
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;background:#fff';
  container.appendChild(img);
}

/**
 * Рендер 3D. opts: { spin, orbit, light, small, stage }
 */
function makeViewer(container, modelId, opts){
  opts = opts || {};
  const THREE = THREEmod, GLTFLoader = GLTFLoaderCls, OrbitControls = OrbitControlsCls;
  if (!THREE) return null;
  const w = Math.max(container.clientWidth||120, 60);
  const h = Math.max(container.clientHeight||120, 60);

  // оптимизация для мобильных: ниже pixelRatio = легче GPU (важно в Telegram)
  const PR = opts.mini ? 1.5 : 2.0;
  const renderer = new THREE.WebGLRenderer({ antialias:!!opts.orbit, alpha:true, preserveDrawingBuffer:true });
  renderer.setPixelRatio(Math.max(1, Math.min(window.devicePixelRatio||1, PR)));
  renderer.setClearColor(0x000000, 0);
  // корректный цвет и мягкий тонмаппинг — модели выглядят чище, без «грязи»
  try{
    if(THREE.SRGBColorSpace!==undefined) renderer.outputColorSpace = THREE.SRGBColorSpace;
    if(THREE.ACESFilmicToneMapping!==undefined){ renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1; }
  }catch(_){}
  renderer.setSize(w,h);
  container.innerHTML='';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, w/h, 0.05, 50);
  camera.position.set(0, 0.4, 2.9);

  // светлый фон (чтобы тёмную модель было видно) — прозрачный, на него ложат CSS-градиент
  scene.background = null;

  const hem = new THREE.HemisphereLight(0xffffff, 0xffffff, 1.4); scene.add(hem);
  const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(3,4,5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xa98bff, 0.7); fill.position.set(-3,1,-2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0x5fe3e0, 0.5); rim.position.set(0,-1,-3); scene.add(rim);

  // лёгкий подиум (опционально), полупрозрачный светлый
  const podium = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.28, 0.12, 48),
    new THREE.MeshStandardMaterial({ color:0xffffff, metalness:.3, roughness:.5, transparent:true, opacity:.35 })
  );
  podium.position.y = -0.55;
  scene.add(podium);

  let group=null, controls=null, raf=true;

  const dispose = () => {
    raf=false;
    try{ if(controls) controls.dispose(); }catch(_){}
    try{ renderer.dispose(); }catch(_){}
    if(renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  };

  const loader = new GLTFLoader();
  if (meshoptDecoderRef) loader.setMeshoptDecoder(meshoptDecoderRef);
  loader.load(modelId, (gltf)=>{
    group = gltf.scene;
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x,size.y,size.z)||1;
    const s = (opts.small ? 1.0 : 1.4) / maxDim;
    group.scale.setScalar(s);
    group.position.y -= center.y*s;
    group.position.y += (opts.small ? 0.1 : 0.12);
    group.position.x -= center.x*s;
    group.position.z -= center.z*s;
    scene.add(group);

    if (opts.orbit && OrbitControls){
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping=true; controls.dampingFactor=.08;
      controls.enableZoom=true; controls.minDistance=1.3; controls.maxDistance=7;
      controls.autoRotate=!!opts.spin; controls.autoRotateSpeed=2.0;
      controls.target.set(0,0.1,0);
    } else if (group){
      group.rotation.y = -0.6;
    }
    if (opts.stage && opts.stage.onload) opts.stage.onload();
  }, undefined, (err)=>{
    console.warn('GLB fail', err);
    if (opts.stage && opts.stage.onerror) opts.stage.onerror();
  });

  let lastT=0;
  const loop = (t)=>{
    if(!raf) return;
    requestAnimationFrame(loop);
    if(document.hidden) return;
    if(opts.mini){
      const menu=document.getElementById('screen-menu');
      if(menu && !menu.classList.contains('active')) return;  // не рендерим НФТ вне меню
      if(lastT && ((t||0)-lastT) < 30) return;                // ~30 fps для чипа
    }
    const dt = lastT ? Math.min((t||0)-lastT, 120) : 16.67;
    lastT = t||0;
    if(controls) controls.update();
    else if(group && opts.spin) group.rotation.y += 0.006 * (dt/16.67);
    renderer.render(scene,camera);
  };
  requestAnimationFrame(loop);

  return { dispose, el: renderer.domElement };
}

/* ---------- НФТ у ника (3D без фона, круглая, вращается) ---------- */
let nftViewer=null;
function renderNFT(){
  const mid = state.userNFT || null;
  const badge = el.nftChip.querySelector('.nft-chip-badge');
  // пустое состояние: не зависеть от раннего выхода — применяем сразу
  if (!mid){
    el.nftChip.classList.add('empty');
    el.nftChip.classList.remove('gold');
    if (el.nftChip.dataset.id === '') return; // уже пусто
    el.nftChip.dataset.id = '';
    if (nftViewer){ try{ nftViewer.dispose(); }catch(_){} nftViewer=null; }
    el.nftCanvas.innerHTML='';
    badge.textContent='НФТ';
    return;
  }
  if (el.nftChip.dataset.id === mid) return; // без пересоздания
  el.nftChip.dataset.id = mid;
  if (nftViewer){ try{ nftViewer.dispose(); }catch(_){} nftViewer=null; }
  el.nftCanvas.innerHTML='';
  el.nftChip.classList.remove('empty');
  // подсветка краёв: №1 золотая, остальные зелёные
  el.nftChip.classList.toggle('gold', mid === '1');
  const m = model(mid); if(!m) return;
  badge.textContent = m.price+' ⭐';
  threeReady().then(ok=>{
    if(state.userNFT!==mid) return;
    if(!ok){ el.nftCanvas.style.background=''; fallbackImage(el.nftCanvas, mid); return; } // WebGL нет -> картинка
    el.nftCanvas.style.background = '';   // без фона — просто модель
    const wrap=document.createElement('div'); wrap.style.cssText='position:absolute;inset:0;width:100%;height:100%'; el.nftCanvas.appendChild(wrap);
    const v = makeViewer(wrap, m.model, { spin:true, small:true, mini:true });
    // если 3D-модель не смогла отрисоваться через время — fallback на картинку
    setTimeout(()=>{
      if(!v || !v.el || v.el.width<=0) fallbackImage(el.nftCanvas, mid);
    }, 3000);
    nftViewer = v;
  });
}

/* ---------- Просмотр на стенде ---------- */
function openViewer(modelId){
  const m=model(modelId); if(!m) return;
  el.viewerTitle.textContent = m.name;
  el.viewerStage.className = 'viewer-stage bg' + modelId;   // свой фон под модель
  el.viewerLoading.style.display='flex';
  el.viewerModal.classList.add('open');
  el.viewerModal._v=undefined;
  threeReady().then(ok=>{
    el.viewerStage.innerHTML='';
    if(!ok){ el.viewerLoading.style.display='none'; fallbackImage(el.viewerStage, modelId); return; } // WebGL нет -> картинка
    const cnvWrap=document.createElement('div');
    cnvWrap.style.cssText='position:absolute;inset:0';
    el.viewerStage.appendChild(cnvWrap);
    const podiumDiv=document.createElement('div'); podiumDiv.className='podium'; el.viewerStage.appendChild(podiumDiv);
    el.viewerLoading.style.display='none';
    const onload=()=>{ const l=el.viewerStage.querySelector('.viewer-loading'); if(l) l.style.display='none'; };
    const v=makeViewer(cnvWrap, m.model, { spin:false, orbit:true, stage:{onload} });
    el.viewerModal._v=v;
    onload();
    // если через время модель не отрисовалась — fallback на картинку
    setTimeout(()=>{
      if(!v || !v.el || v.el.width<=0) fallbackImage(el.viewerStage, modelId);
    }, 3000);
  });
}
function closeViewer(){
  try{ if(el.viewerModal._v) el.viewerModal._v.dispose(); }catch(_){}
  el.viewerModal._v=undefined;
  el.viewerModal.classList.remove('open');
}

/* ---------- 3D превью на карточке ---------- */
function previewInto(node, modelId, onReady){
  const m=model(modelId);
  threeReady().then(ok=>{
    node.innerHTML='';
    if(!ok){ fallbackImage(node, modelId); if(onReady) onReady(node); return; }
    const wrap=document.createElement('div'); wrap.className='view3d'; node.appendChild(wrap);
    const v = makeViewer(wrap, m.model, { spin:true, small:true });
    if(onReady) onReady(node);
    setTimeout(()=>{ if(!v || !v.el || v.el.width<=0) fallbackImage(node, modelId); }, 3000);
  });
}

/* =====================================================================
   МАГАЗИН
   ===================================================================== */
function shopCard(m){
  const owned = ownedCount(m.id)>0;
  const d=document.createElement('div');
  d.className='item-card';
  const badge = owned
    ? `<span class="item-badge rarity-${m.rarity}">В коллекции</span>`
    : `<span class="item-badge rarity-${m.rarity}">${m.rarity==='epic'?'Эпик':'Обычный'}</span>`;
  d.innerHTML = `
    <div class="item-media">
      <div class="poster-holder" style="position:absolute;inset:0;z-index:1;width:100%;height:100%"><img class="poster" src="${m.image}" alt="${m.name}" loading="lazy" style="width:100%;height:100%;object-fit:cover"/></div>
      <div class="item-view3d" data-p3d="${m.id}"></div>
    </div>
    <div class="item-body">
      <div class="item-name">${m.name}</div>
      <div class="item-price"><span class="ic"></span>${m.price}</div>
      <div class="item-actions">
        <button class="mini-buy" data-buy="${m.id}">${owned?'Просмотр':'Купить'}</button>
        <button class="mini-3d" data-p3d-btn="${m.id}">3D</button>
      </div>
    </div>`;
  return d;
}
function renderShop(){
  el.shopGrid.innerHTML='';
  MODEL_CATALOG.forEach(m=>{
    const c=shopCard(m);
    c.addEventListener('click',(e)=>{
      const buy=e.target.closest('[data-buy]');
      const p3d=e.target.closest('[data-p3d-btn]');
      const detail=e.target.closest('.item-media');
      if(buy){ e.stopPropagation(); if(ownedCount(buy.dataset.buy)>0) openModal(buy.dataset.buy); else buyNFT(buy.dataset.buy); return; }
      if(p3d){ e.stopPropagation(); openViewer(p3d.dataset.p3dBtn); return; }
      const back=e.target.closest('[data-card-back]');
      if(back){ e.stopPropagation(); c.classList.remove('viewing'); const node=c.querySelector(`[data-p3d]`); if(node){ node.innerHTML=''; if(node._v){try{node._v.dispose();}catch(_){}} } return; }
      e.stopPropagation(); openModal(m.id);
    });
    el.shopGrid.appendChild(c);
  });
}
function buyNFT(modelId){
  const m=model(modelId); if(!m) return;
  const owned = ownedCount(modelId)>0;
  if(state.stars < m.price){ toast('Недостаточно звёзд'); return; }
  state.stars -= m.price;
  state.owned.push(m.id);
  state.userNFT = modelId;        // купленная модель встаёт НФТ-чипом в 3D
  save(); renderBalance(); renderShop(); renderNFT();
  closeModal(); toast('Покупка успешна: '+m.name+' — теперь у тебя!', true);
}

/* =====================================================================
   МОДАЛКА НФТ
   ===================================================================== */
let currentModalModel=null;
function openModal(modelId){
  const m=model(modelId); if(!m) return;
  currentModalModel=modelId;
  const owned = ownedCount(modelId)>0;
  el.modalTitle.textContent = m.name;
  el.modalPrice.innerHTML = owned
    ? '<span class="ic" style="display:inline-block;width:12px;height:12px;background:#7ee0a3;border-radius:50%;margin-right:6px"></span>Приобретено'
    : 'Цена: '+m.price+' звёзд';
  el.modalMedia.innerHTML = '';
  const poster=document.createElement('img'); poster.className='poster'; poster.src=m.image; el.modalMedia.appendChild(poster);
  el.modalActions.innerHTML='';

  if(!owned){
    const buy=document.createElement('button'); buy.className='action-btn buy'; buy.textContent='Купить за '+m.price+' ⭐';
    buy.addEventListener('click',()=>buyNFT(modelId)); el.modalActions.appendChild(buy);
  } else {
    const use=document.createElement('button'); use.className='action-btn green'; use.textContent='Поставить рядом с ником';
    use.addEventListener('click',()=>{ state.userNFT=modelId; save(); renderNFT(); toast('НФТ теперь рядом с ником',true); });
    el.modalActions.appendChild(use);
    const sell=document.createElement('button'); sell.className='action-btn purple'; sell.textContent='Продать игре';
    sell.addEventListener('click',()=>sellToGame(modelId)); el.modalActions.appendChild(sell);
    // на рынок только через 24ч после покупки
    const lock = state.marketLock[modelId] || 0;
    const now = Date.now();
    const canMarket = !lock || (now >= lock);
    const mk=document.createElement('button'); mk.className='action-btn dark';
    if(canMarket){ mk.textContent='Выставить на рынок'; mk.addEventListener('click',()=>sellToMarket(modelId)); }
    else {
      const hrs = Math.ceil((lock-now)/3600000);
      mk.textContent='Рынок откроется через '+hrs+' ч';
      mk.disabled=true;
    }
    el.modalActions.appendChild(mk);
  }
  const v3d=document.createElement('button'); v3d.className='action-btn dark'; v3d.textContent='Посмотреть 3D';
  v3d.addEventListener('click',()=>openViewer(modelId)); el.modalActions.appendChild(v3d);

  el.nftModal.classList.add('open');
}
function closeModal(){ el.nftModal.classList.remove('open'); currentModalModel=null; }

/* =====================================================================
   ПРОДАЖА
   ===================================================================== */
function sellToGame(modelId){
  const m=model(modelId); if(!m) return;
  const idx=(state.owned||[]).lastIndexOf(modelId);
  if(idx<0) return;
  const low = Math.round(m.price*0.5);
  state.owned.splice(idx,1);
  state.stars += low;
  if(state.userNFT===modelId) state.userNFT=null;
  save(); renderBalance(); renderShop(); renderNFT(); closeModal();
  toast('Продано игре за '+low+' ⭐');
}
function sellToMarket(modelId){
  const m=model(modelId); if(!m) return;
  const idx=(state.owned||[]).lastIndexOf(modelId);
  if(idx<0) return;
  el.priceInput.value = Math.round(m.price*0.8);
  el.priceModal.classList.add('open');
  el.priceInput._model=modelId;
}
function confirmSellToMarket(){
  const modelId = el.priceInput._model;
  const m=model(modelId); if(!m){ closePriceModal(); return; }
  const idx=(state.owned||[]).lastIndexOf(modelId);
  if(idx<0){ closePriceModal(); return; }
  const p = parseInt(el.priceInput.value,10);
  if(isNaN(p)||p<=0){ toast('Цена должна быть больше 0'); return; }
  state.owned.splice(idx,1);
  // пока рынка нет — просто возвращаем половину и помечаем
  state.stars += Math.round(p*0.5);
  if(state.userNFT===modelId) state.userNFT=null;
  save(); renderBalance(); renderShop(); renderNFT(); closeModal(); closePriceModal();
  toast('Модель продана. Рынок появится позже.');
}
function closePriceModal(){ el.priceModal.classList.remove('open'); el.priceInput._model=null; }

/* =====================================================================
   ЯЧЕЙКИ
   ===================================================================== */
let cellResetTimer=null;
function computeNextReset(){
  const now=new Date();
  let ts = new Date(now.getFullYear(), now.getMonth(), now.getDate(), CELL_AUTO_HOUR, 0, 0, 0).getTime();
  // локальное 14:00 = МСК только если часовой пояс +3; для МСК+0 коррекция. Используем UTC+3:
  const nowUTC = Date.now();
  const msk = nowUTC + 3*3600000;
  const d = new Date(msk);
  let next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), CELL_AUTO_HOUR, 0, 0)).getTime() - 3*3600000;
  if(next <= nowUTC) next += 24*3600000;
  return next;
}
function renderCells(){
  el.cellsRack.innerHTML='';
  // проверка автосброса
  const now=Date.now();
  if(state.cellResetAt && now>=state.cellResetAt){
    state.cellResetAt = computeNextReset();
    state.cellsOpened=[];
    cellPool = genCellPool();
    save();
  }
  for(let i=0;i<CELL_COUNT;i++){
    const num=i+1;
    const opened=state.cellsOpened.includes(num);
    const cell=document.createElement('div'); cell.className='cell'+(opened?' opened':'');
    cell.dataset.cell=num;
    const inner=document.createElement('div'); inner.className='cell-inner';
    if(opened){
      const res=cellPool[i];
      inner.innerHTML=`<span class="res">${res.icon}</span><span class="cell-num">${num}</span>`;
      cell.appendChild(inner);
    } else {
      // вид банковского сейфа: дверца, ручка-диск, номер, маленький замок
      inner.innerHTML = `
        <span class="safe-handle"></span>
        <span class="safe-lock"></span>
        <span class="cell-num">${num}</span>`;
      cell.appendChild(inner);
      cell.addEventListener('click',()=>openCell(num));
    }
    el.cellsRack.appendChild(cell);
  }
  // таймер
  if(!state.cellResetAt) state.cellResetAt = computeNextReset();
  updateCellTimer();
}
function updateCellTimer(){
  const target = state.cellResetAt || computeNextReset();
  const left = Math.max(0, target-Date.now());
  const h=Math.floor(left/3600000), m=Math.floor((left%3600000)/60000), s=Math.floor((left%60000)/1000);
  if(el.cellTimer) el.cellTimer.textContent = 'Обновление через: '+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
  if(left<=0){ renderCells(); }
}
let openingCell=false;
function openCell(num){
  if(openingCell) return;
  if(state.keys<=0){ toast('Нужны ключи!'); return; }
  if(state.cellsOpened.includes(num)) return;
  state.keys--; countGame(); renderBalance();
  const res=cellPool[num-1];
  openingCell=true;
  state.cellsOpened.push(num);
  save();
  const cellEl=el.cellsRack.querySelector(`[data-cell="${num}"]`);
  if(cellEl) cellEl.classList.add('reveal-glow','pulse');
  setTimeout(()=>{ renderCells(); showPrize(res); }, 500);
}
function showPrize(res){
  if(res.type==='big'||res.type==='stars'){ state.stars+=res.stars; addXp(res.stars); renderBalance(); }
  else if(res.type==='key'){ state.keys+=1; renderBalance(); }
  save();
  const texts={ key:'Ты нашёл ключ! 🔑', big:'ДЖЕКПОТ! 💎 +'+res.stars, stars:'+'+res.stars+' звёзд', none:'Пусто…' };
  el.prizeItem.textContent = res.icon;
  el.prizeText.textContent = texts[res.type]||'';
  el.prizeModal.classList.add('open');
}
function closePrize(){ el.prizeModal.classList.remove('open'); openingCell=false; }
function forceResetCells(){
  if(state.stars<CELL_RESET_COST){ toast('Нужно '+CELL_RESET_COST+' звёзд'); return; }
  if(state.cellsOpened.length<CELL_COUNT){ toast('Открой все ячейки или дождись обновления'); return; }
  state.stars-=CELL_RESET_COST;
  state.cellsOpened=[];
  cellPool=genCellPool();
  state.cellResetAt=computeNextReset();
  save(); renderBalance(); renderCells();
  toast('Ячейки обновлены за '+CELL_RESET_COST+' ⭐', true);
}

/* ---------- Магазин ключей ---------- */
function openKeyShop(){
  el.keyShopBalance.textContent=state.stars;
  el.keyShopModal.classList.add('open');
}
function closeKeyShop(){ el.keyShopModal.classList.remove('open'); }
function buyKeys(pack){
  const kp=KEY_PACKS.find(x=>x.n===pack); if(!kp) return;
  if(state.stars<kp.price){ toast('Недостаточно звёзд'); return; }
  state.stars-=kp.price; state.keys+=kp.n;
  save(); renderBalance(); el.keyShopBalance.textContent=state.stars;
  toast('+'+kp.n+' 🔑', true);
}

/* =====================================================================
   МИНЫ
   ===================================================================== */
let mineState = { grid:null, opened:[], totalMines:3, bet:0, active:false, multiplier:1 };
const MINE_GRID = 5*5;
function multiplierFor(mines, opened){
  // возрастающий множитель (ещё в 2 раза меньше прошлой версии)
  const base = 1 + mines*0.0135;
  if(opened<=0) return Math.round(base*100)/100;
  const growth = opened * (0.01 + mines*0.0235);
  return Math.round((base+growth)*100)/100;
}
function renderMines(){
  el.minesGrid.innerHTML='';
  el.minesBalance.textContent = state.stars;
  // блокируем ставку и выбор мин во время активной игры
  const busy = mineState.active;
  el.minesBet.disabled = busy;
  el.minesStart.disabled = busy;
  document.querySelectorAll('.mine-count-btn').forEach(b=>{ b.disabled = busy; });
  if(busy){ el.minesStart.textContent='Идёт игра…'; } else { el.minesStart.textContent='Играть'; }
  if(!mineState.active){
    el.minesMultiplier.textContent = 'x' + multiplierFor(mineState.totalMines, 0);
    el.minesCashout.disabled = true;
    el.minesCashout.textContent='Забрать выигрыш';
    return;
  }
  for(let i=0;i<MINE_GRID;i++){
    const cell=document.createElement('button'); cell.className='mine-cell';
    cell.dataset.i=i;
    if(mineState.opened.includes(i)){
      const isMine = mineState.grid[i]===1;
      cell.classList.add('revealed', isMine?'mine':'safe');
      cell.textContent = isMine?'💣':'';
    }
    cell.addEventListener('click',()=>openMine(i));
    el.minesGrid.appendChild(cell);
  }
  const realMines = mineState.effectiveMines || mineState.totalMines;
  el.minesMultiplier.textContent = 'x' + multiplierFor(realMines, mineState.opened.length);
  el.minesCashout.disabled = mineState.opened.length===0;
  el.minesCashout.textContent = 'Забрать ' + Math.floor(mineState.bet * multiplierFor(realMines, mineState.opened.length)) + ' ⭐';
}
function startMines(){
  if(mineState.active) return;         // блокировка повторного старта во время игры
  const bet = parseInt(el.minesBet.value,10);
  if(isNaN(bet)||bet<1){ toast('Ставка от 1 звёзды'); return; }
  if(bet>state.stars){ toast('Недостаточно звёзд'); return; }
  mineState.bet=bet;
  mineState.totalMines = parseInt(document.querySelector('.mine-count-btn.active').dataset.mines, 10);
  // шанс на мину растёт со ставкой: чем больше ставка, тем больше скрытых мин
  let effectiveMines = mineState.totalMines;
  const extra = Math.min(9, Math.floor(bet / 200));   // +1 мина каждые 200 звёзд, максимум +9
  effectiveMines += extra;
  if (effectiveMines > MINE_GRID - 3) effectiveMines = MINE_GRID - 3;
  // сгенерировать поле с эффективным числом мин
  const arr=new Array(MINE_GRID).fill(0);
  let placed=0;
  while(placed<effectiveMines){ const i=Math.floor(Math.random()*MINE_GRID); if(arr[i]===0){ arr[i]=1; placed++; } }
  mineState.grid=arr;
  mineState.effectiveMines = effectiveMines;
  mineState.opened=[];
  mineState.active=true;
  state.stars-=bet; countGame(); save(); renderBalance();
  renderMines();
}
function openMine(i){
  if(!mineState.active || mineState.opened.includes(i)) return;
  if(mineState.grid[i]===1 && bonusHit()) mineState.grid[i]=0;
  if(mineState.grid[i]===1){
    mineState.opened.push(i);
    renderMines();
    setTimeout(()=>{
      toast('💣 Ты подорвался! Ставка проиграна');
      mineState.active=false; renderMines();
    },700);
    return;
  }
  mineState.opened.push(i);
  renderMines();
}
function cashoutMines(){
  if(!mineState.active || mineState.opened.length===0) return;
  const realMines = mineState.effectiveMines || mineState.totalMines;
  const w=Math.floor(mineState.bet * multiplierFor(realMines, mineState.opened.length));
  state.stars+=w; addXp(w); save(); renderBalance();
  mineState.active=false;
  toast('Ты забрал '+w+' ⭐!', true);
  renderMines(); renderBalance();
}

/* =====================================================================
   НАГРАДЫ / КОД
   ===================================================================== */
function donatePreset(amount){ donateDeep(amount); }

/* =====================================================================
   ЕЖЕДНЕВНЫЙ ПОДАРОК (3 ключа раз в 24 часа)
   ===================================================================== */
function giftReady(){
  const last = (state.gift && state.gift.lastClaim) || 0;
  if (!last) return true;                 // первый заход — подарок доступен
  return Date.now() - last >= GIFT_INTERVAL;
}
function giftLeft(){
  const last = (state.gift && state.gift.lastClaim) || 0;
  if (!last) return 0;
  return Math.max(0, GIFT_INTERVAL - (Date.now()-last));
}
function fmtHMS(ms){
  const left=Math.max(0,ms);
  const h=Math.floor(left/3600000), m=Math.floor((left%3600000)/60000), s=Math.floor((left%60000)/1000);
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}
function renderGiftFab(){
  if(!el.giftFab) return;
  const ready = giftReady();
  el.giftFab.classList.toggle('ready', ready);
  el.giftFab.title = ready ? 'Забрать подарок: 3 ключа!' : 'Подарок через '+fmtHMS(giftLeft());
}
function renderGiftScreen(){
  const ready = giftReady();
  if (el.giftClaimBtn){
    el.giftClaimBtn.disabled = !ready;
    el.giftClaimBtn.textContent = ready ? 'Забрать 3 ключа' : 'Уже забрано';
  }
  if (el.giftHero) el.giftHero.style.filter = ready ? '' : 'grayscale(.55) opacity(.7)';
  updateGiftTimer();
}
function updateGiftTimer(){
  if(!el.giftTimer) return;
  if (giftReady()) el.giftTimer.textContent = 'Подарок ждёт тебя — забирай!';
  else el.giftTimer.textContent = 'Следующий подарок через: '+fmtHMS(giftLeft());
}
function claimGift(){
  if(!giftReady()){ toast('Подарок уже забран, приходи позже'); return; }
  state.keys += GIFT_KEYS;
  state.gift = { lastClaim: Date.now() };
  save(); renderBalance(); renderGiftFab(); renderGiftScreen();
  toast('+'+GIFT_KEYS+' 🔑 забрано!', true);
}

/* =====================================================================
   КЕЙСЫ (звёзды и ключи, окупаемость ниже 1)
   ===================================================================== */
const CASES = [
  { id:'bronze', name:'Бронзовый кейс', sub:'100 ⭐ · частые мелкие призы', price:100,
    icon:'📦', accent:'linear-gradient(150deg,#c98a4b,#8a5a2b)',
    prizes:[
      {type:'stars', amount:30,  w:40, ico:'⭐'},
      {type:'stars', amount:50,  w:25, ico:'⭐'},
      {type:'stars', amount:70,  w:15, ico:'⭐'},
      {type:'stars', amount:120, w:10, ico:'⭐'},
      {type:'stars', amount:200, w:6,  ico:'⭐'},
      {type:'stars', amount:500, w:3,  ico:'💎'},
      {type:'key',   count:1,    w:1,  ico:'🔑'},
    ]},
  { id:'silver', name:'Серебряный кейс', sub:'500 ⭐ · шанс на крупный приз', price:500,
    icon:'🎁', accent:'linear-gradient(150deg,#b9c2d0,#6d7688)',
    prizes:[
      {type:'stars', amount:150, w:35, ico:'⭐'},
      {type:'stars', amount:250, w:25, ico:'⭐'},
      {type:'stars', amount:350, w:18, ico:'⭐'},
      {type:'stars', amount:550, w:10, ico:'⭐'},
      {type:'stars', amount:800, w:7,  ico:'⭐'},
      {type:'stars', amount:1500,w:3,  ico:'💎'},
      {type:'key',   count:2,    w:1.5,ico:'🔑'},
      {type:'stars', amount:5000,w:0.5,ico:'👑'},
    ]},
  { id:'gold', name:'Золотой кейс', sub:'1000 ⭐ · редкий джекпот 10000 ⭐', price:1000,
    icon:'🏆', accent:'linear-gradient(150deg,#ffd76a,#c99a2b)',
    prizes:[
      {type:'stars', amount:350, w:30, ico:'⭐'},
      {type:'stars', amount:550, w:25, ico:'⭐'},
      {type:'stars', amount:750, w:18, ico:'⭐'},
      {type:'stars', amount:1100,w:12, ico:'⭐'},
      {type:'stars', amount:1600,w:8,  ico:'💎'},
      {type:'stars', amount:2600,w:4,  ico:'💎'},
      {type:'key',   count:3,    w:2,  ico:'🔑'},
      {type:'stars', amount:10000,w:1, ico:'👑'},
    ]},
];
function pickPrize(c){
  const total=c.prizes.reduce((a,p)=>a+(p.w||0),0);
  let r=Math.random()*total;
  for(const p of c.prizes){ if((r-=p.w)<=0) return p; }
  return c.prizes[c.prizes.length-1];
}
function prizeLabel(p){
  return p.type==='key' ? (p.count+' 🔑') : (p.amount+' ⭐');
}
const CASE_IMG = { bronze:'assets/кейс_бронзовый.jpg', silver:'assets/кейс_серебряный.jpg', gold:'assets/кейс_золотой.jpg' };
function renderCases(){
  if(!el.caseGrid) return;
  el.caseGrid.innerHTML='';
  CASES.forEach(c=>{
    const d=document.createElement('div');
    d.className='case-card'; d.style.setProperty('--accent', c.accent);
    d.innerHTML = `
      <div class="case-thumb"><img src="${CASE_IMG[c.id]}" alt=""></div>
      <div class="case-meta">
        <div class="case-name">${c.name}</div>
        <div class="case-sub">${c.sub}</div>
        <div class="case-price"><span class="ic"></span>${c.price}</div>
      </div>
      <button class="case-open" data-case="${c.id}">Открыть</button>`;
    el.caseGrid.appendChild(d);
  });
}
let caseBusy=false;
function openCase(id){
  if(caseBusy) return;
  const c=CASES.find(x=>x.id===id); if(!c) return;
  if(state.stars < c.price){ toast('Недостаточно звёзд'); return; }
  state.stars -= c.price; countGame(); save(); renderBalance();
  caseBusy=true;
  let prize = pickPrize(c);
  if(bonusHit() && Array.isArray(c.prizes)){ const best=c.prizes.slice().sort((a,b)=>(b.amount||0)-(a.amount||0))[0]; if(best) prize=best; }
  const TILE_W=92, GAP=10, WIN_INDEX=34;
  el.caseReel.style.transition='none';
  el.caseReel.style.transform='translateX(0)';
  el.caseReel.innerHTML='';
  for(let i=0;i<40;i++){
    const tile=document.createElement('div');
    tile.className='case-tile'+(prize.type==='key'?' key':'');
    if(i===WIN_INDEX){
      tile.classList.add('win');
      tile.innerHTML='<span class="ct-ico">'+prize.ico+'</span>'+prizeLabel(prize);
    } else {
      const rp=c.prizes[Math.floor(Math.random()*c.prizes.length)];
      tile.innerHTML='<span class="ct-ico">'+rp.ico+'</span>'+prizeLabel(rp);
    }
    el.caseReel.appendChild(tile);
  }
  el.caseResult.textContent='';
  el.caseModal.classList.add('open');
  requestAnimationFrame(()=>{ requestAnimationFrame(()=>{
    const wrapW = el.caseReel.parentElement.clientWidth;
    const target = WIN_INDEX*(TILE_W+GAP) + TILE_W/2 - wrapW/2 + 9;
    el.caseReel.style.transition='transform 4.2s cubic-bezier(.12,.86,.16,1)';
    el.caseReel.style.transform='translateX('+(-target)+'px)';
  });});
  setTimeout(()=>{
    if(prize.type==='key') state.keys += prize.count;
    else { state.stars += prize.amount; addXp(prize.amount); }
    save(); renderBalance();
    el.caseResult.textContent = 'Выпало: '+prizeLabel(prize);
    caseBusy=false;
  }, 4400);
}

/* =====================================================================
   КОЛЕСО УДАЧИ (множитель x0.1 … x3)
   ===================================================================== */
const WHEEL_SEGS = [
  {m:0.1, c:'#2b2b45'}, {m:0.2, c:'#a98bff'}, {m:0.2, c:'#2b2b45'},
  {m:0.3, c:'#7657e8'}, {m:0.3, c:'#2b2b45'}, {m:0.4, c:'#5fe3e0'},
  {m:0.5, c:'#2b2b45'}, {m:0.7, c:'#3a9fd0'}, {m:1,   c:'#2b2b45'},
  {m:1.5, c:'#ffd76a'}, {m:2,   c:'#ff9d3f'}, {m:3,   c:'#ff5f6d'},
];
function wheelGradient(){
  const n=WHEEL_SEGS.length, seg=360/n;
  return 'conic-gradient(from -90deg, '+WHEEL_SEGS.map((s,i)=>`${s.c} ${i*seg}deg ${(i+1)*seg}deg`).join(',')+')';
}
let wheelBusy=false, wheelAngle=0;
function renderWheel(){
  if(!el.wheel) return;
  el.wheel.style.background = wheelGradient();
  el.wheel.style.transition='none';
  el.wheel.style.transform='rotate(0deg)';
  wheelAngle=0; wheelBusy=false;
  // подписи секторов: что выпадет
  if(!el.wheel.querySelector('.wheel-label')){
    const n=WHEEL_SEGS.length, seg=360/n;
    WHEEL_SEGS.forEach((s,i)=>{
      const d=document.createElement('div');
      d.className='wheel-label';
      d.style.transform='rotate('+(i*seg+seg/2)+'deg)';
      d.innerHTML='<span>x'+s.m+'</span>';
      el.wheel.appendChild(d);
    });
  }
}
function spinWheel(){
  if(wheelBusy) return;
  const bet=parseInt(el.wheelBet.value,10);
  if(isNaN(bet)||bet<1){ toast('Ставка от 1 звезды'); return; }
  if(bet>state.stars){ toast('Недостаточно звёзд'); return; }
  state.stars-=bet; countGame(); save(); renderBalance();
  wheelBusy=true;
  let idx = Math.floor(Math.random()*WHEEL_SEGS.length);
  if(bonusHit()){ let bi=0; WHEEL_SEGS.forEach((s,i)=>{ if(s.m>WHEEL_SEGS[bi].m) bi=i; }); idx=bi; }
  const seg = 360/WHEEL_SEGS.length;
  const segCenter = idx*seg + seg/2;
  const curMod = ((wheelAngle%360)+360)%360;
  let delta = ((360 - segCenter) - curMod);
  delta = ((delta%360)+360)%360;
  const spins = 6 + Math.floor(Math.random()*3);
  const target = wheelAngle + spins*360 + delta;
  wheelAngle = target;
  el.wheel.style.transition='transform 4s cubic-bezier(.15,.9,.15,1)';
  el.wheel.style.transform='rotate('+target+'deg)';
  setTimeout(()=>{
    const segData=WHEEL_SEGS[idx];
    const win=Math.round(bet*segData.m);
    state.stars+=win; addXp(win); save(); renderBalance();
    if(segData.m>=1) toast('x'+segData.m+'! Выигрыш '+win+' ⭐', true);
    else if(win<bet) toast('x'+segData.m+' — '+win+' ⭐ (меньше ставки)');
    else toast('x'+segData.m+' — '+win+' ⭐');
    wheelBusy=false;
  }, 4200);
}

/* =====================================================================
   НАПЁРСТКИ (1 из 3, выплата x2.6)
   ===================================================================== */
const CUPS_PAYOUT = 2.6;
let cupsState = { active:false, busy:false, ballCup:0, bet:0, cupPos:[0,1,2] };
function renderCups(){
  if(!el.cupsRow) return;
  const cups=[...el.cupsRow.querySelectorAll('.cup')];
  cups.forEach((c,i)=>{ c.style.left=(i*(100/3))+'%'; c.disabled=true; });
  cupsState.active=false; cupsState.busy=false; cupsState.cupPos=[0,1,2];
  if(el.cupsHint) el.cupsHint.textContent='Нажми «Играть», запомни стакан с шариком и угадай после перемешивания.';
}
function startCups(){
  if(cupsState.busy) return;
  const bet=parseInt(el.cupsBet.value,10);
  if(isNaN(bet)||bet<1){ toast('Ставка от 1 звезды'); return; }
  if(bet>state.stars){ toast('Недостаточно звёзд'); return; }
  state.stars-=bet; countGame(); save(); renderBalance();
  cupsState={ active:true, busy:true, ballCup:Math.floor(Math.random()*3), bet, cupPos:[0,1,2] };
  const cups=[...el.cupsRow.querySelectorAll('.cup')];
  cups.forEach((c,i)=>{ c.style.left=(i*(100/3))+'%'; c.classList.remove('peek','reveal','hit'); c.disabled=true; });
  if(el.cupsHint) el.cupsHint.textContent='Запоминай, где шарик…';
  cups[cupsState.ballCup].classList.add('peek');
  setTimeout(()=>{
    cups.forEach(c=>c.classList.remove('peek'));
    shuffleCups(cups).then(()=>{
      cupsState.busy=false;
      cups.forEach(c=>c.disabled=false);
      if(el.cupsHint) el.cupsHint.textContent='Где шарик? Нажми на стакан!';
    });
  }, 800);
}
function shuffleCups(cups){
  return new Promise(resolve=>{
    let swaps=0;
    const doSwap=()=>{
      if(swaps>=6){ resolve(); return; }
      let a=Math.floor(Math.random()*3), b=Math.floor(Math.random()*3);
      while(b===a) b=Math.floor(Math.random()*3);
      const sa=cupsState.cupPos[a], sb=cupsState.cupPos[b];
      cupsState.cupPos[a]=sb; cupsState.cupPos[b]=sa;
      cups[a].style.left=(sb*(100/3))+'%';
      cups[b].style.left=(sa*(100/3))+'%';
      swaps++;
      setTimeout(doSwap, 170);
    };
    doSwap();
  });
}
function pickCup(cupIndex){
  if(!cupsState.active || cupsState.busy) return;
  cupsState.busy=true;
  const cups=[...el.cupsRow.querySelectorAll('.cup')];
  cups.forEach(c=>c.disabled=true);
  let win = cupIndex===cupsState.ballCup;
  if(!win && bonusHit()){ cupsState.ballCup=cupIndex; win=true; }
  cups[cupsState.ballCup].classList.add('reveal');
  if(win) cups[cupIndex].classList.add('hit');
  let payout=0;
  if(win){ payout=Math.round(cupsState.bet*CUPS_PAYOUT); state.stars+=payout; addXp(payout); save(); renderBalance(); }
  cupsState.active=false;
  if(el.cupsHint) el.cupsHint.textContent = win ? ('Точно! +'+payout+' ⭐') : 'Мимо… шарик был под другим стаканом.';
  if(win) toast('Угадал! +'+payout+' ⭐', true); else toast('Не угадал. Попробуй ещё');
  // после игры стаканы возвращаются на свои места, шарик остаётся виден
  setTimeout(()=>{
    cups.forEach((c,i)=>{ c.style.left=(i*(100/3))+'%'; });
    cupsState.cupPos=[0,1,2];
    if(win) cups[cupIndex].classList.remove('hit');
  }, 800);
  setTimeout(()=>{ cupsState.busy=false; }, 400);
}

/* =====================================================================
   КОСТИ УДАЧИ (меньше/больше 7 — x1.9, ровно 7 — x4.5)
   ===================================================================== */
const DICE_PIPS = { 1:[4], 2:[0,8], 3:[0,4,8], 4:[0,2,6,8], 5:[0,2,4,6,8], 6:[0,2,3,5,6,8] };
function dieHTML(v){
  let h='';
  const on = DICE_PIPS[v]||[];
  for(let i=0;i<9;i++) h += '<span class="pip'+(on.includes(i)?'':' off')+'"></span>';
  return h;
}
function renderDie(node,v){ if(node) node.innerHTML=dieHTML(v); }
let dicePick='high', diceBusy=false;
function renderDice(){
  if(el.dice1 && !el.dice1.innerHTML) renderDie(el.dice1,1);
  if(el.dice2 && !el.dice2.innerHTML) renderDie(el.dice2,1);
  document.querySelectorAll('.dice-choice').forEach(b=>b.classList.toggle('active', b.dataset.pick===dicePick));
}
function rollDice(){
  if(diceBusy) return;
  const bet=parseInt(el.diceBet.value,10);
  if(isNaN(bet)||bet<1){ toast('Ставка от 1 звезды'); return; }
  if(bet>state.stars){ toast('Недостаточно звёзд'); return; }
  state.stars-=bet; countGame(); save(); renderBalance();
  diceBusy=true;
  const d1=el.dice1, d2=el.dice2;
  d1.classList.add('rolling'); d2.classList.add('rolling');
  const spin=setInterval(()=>{ renderDie(d1,1+Math.floor(Math.random()*6)); renderDie(d2,1+Math.floor(Math.random()*6)); },80);
  setTimeout(()=>{
    clearInterval(spin);
    d1.classList.remove('rolling'); d2.classList.remove('rolling');
    let v1=1+Math.floor(Math.random()*6), v2=1+Math.floor(Math.random()*6);
    if(bonusHit()){
      if(dicePick==='low' && v1+v2>=7){ v1=1; v2=1+Math.floor(Math.random()*5); }
      else if(dicePick==='high' && v1+v2<=7){ v1=6; v2=2+Math.floor(Math.random()*5); }
      else if(dicePick!=='low' && dicePick!=='high' && v1+v2!==7){ v1=1+Math.floor(Math.random()*6); v2=7-v1; if(v2<1){v2=6;v1=1;} if(v2>6){v2=6;v1=1;} }
    }
    renderDie(d1,v1); renderDie(d2,v2);
    const sum=v1+v2;
    let win=false, mult=1.9;
    if(dicePick==='low') win = sum<7;
    else if(dicePick==='high') win = sum>7;
    else { mult=4.5; win = sum===7; }
    const payout = win ? Math.round(bet*mult) : 0;
    if(win){ state.stars+=payout; addXp(payout); save(); renderBalance(); toast('Выпало '+v1+'+'+v2+'='+sum+'. Победа +'+payout+' ⭐', true); }
    else toast('Выпало '+v1+'+'+v2+'='+sum+'. Не угадал');
    diceBusy=false;
  }, 1200);
}

/* =====================================================================
   ДАРТС (яблочко x8 … мимо x0)
   ===================================================================== */
let dartsBusy=false;
function renderDarts(){
  if(el.dart){ el.dart.style.transition='none'; el.dart.style.left='50%'; el.dart.style.top='92%'; el.dart.style.opacity='0'; }
}
function throwDart(){
  if(dartsBusy) return;
  const bet=parseInt(el.dartsBet.value,10);
  if(isNaN(bet)||bet<1){ toast('Ставка от 1 звезды'); return; }
  if(bet>state.stars){ toast('Недостаточно звёзд'); return; }
  state.stars-=bet; countGame(); save(); renderBalance();
  dartsBusy=true;
  const dart=el.dart;
  dart.style.transition='none'; dart.style.left='50%'; dart.style.top='92%'; dart.style.opacity='1';
  void dart.offsetWidth;
  dart.style.transition='left .7s cubic-bezier(.2,.8,.2,1), top .7s cubic-bezier(.2,.8,.2,1)';
  let rr=Math.sqrt(Math.random());            // равномерно по площади
  if(bonusHit()) rr=0.06;
  const ang=Math.random()*Math.PI*2;
  const R=44;                                  // % от центра
  dart.style.left=(50 + Math.cos(ang)*rr*R)+'%';
  dart.style.top =(50 + Math.sin(ang)*rr*R)+'%';
  let mult=0, label='';
  if(rr<0.12){mult=8;label='Яблочко';}
  else if(rr<0.35){mult=2.5;label='Центр';}
  else if(rr<0.6){mult=1.2;label='Среднее';}
  else if(rr<0.9){mult=0.6;label='Край';}
  else {mult=0;label='Мимо';}
  setTimeout(()=>{
    const payout=Math.round(bet*mult);
    if(payout>0){ state.stars+=payout; addXp(payout); save(); renderBalance(); }
    if(mult>=1) toast(label+'! x'+mult+' +'+payout+' ⭐', true);
    else if(mult>0) toast(label+': x'+mult+' — '+payout+' ⭐ (меньше ставки)');
    else toast('Мимо! Дротик не попал в цель');
    dartsBusy=false;
  }, 800);
}

/* =====================================================================
   ВЫШЕ-НИЖЕ (карты: выше/ниже, x1.9)
   ===================================================================== */
const CARD_RANKS=['2','3','4','5','6','7','8','9','10','J','Q','K'];
const CARD_SUITS=[{s:'♠',red:false},{s:'♥',red:true},{s:'♦',red:true},{s:'♣',red:false}];
let hiloPick='high', hiloBusy=false, hiloCur=null;
function setCard(node,r,s){
  if(!node) return;
  node.className='card'+(CARD_SUITS[s].red?' red':'');
  node.innerHTML='<span class="c-rank">'+CARD_RANKS[r]+'</span><span class="c-suit">'+CARD_SUITS[s].s+'</span>';
}
function renderHilo(){
  if(!hiloCur) hiloCur={r:Math.floor(Math.random()*CARD_RANKS.length), s:Math.floor(Math.random()*4)};
  setCard(el.hiloCur,hiloCur.r,hiloCur.s);
  if(el.hiloNext){ el.hiloNext.className='card back'; el.hiloNext.innerHTML=''; }
  document.querySelectorAll('.dice-choice[data-hilo]').forEach(b=>b.classList.toggle('active', b.dataset.hilo===hiloPick));
}
function pullHilo(){
  if(hiloBusy) return;
  const bet=parseInt(el.hiloBet.value,10);
  if(isNaN(bet)||bet<1){ toast('Ставка от 1 звезды'); return; }
  if(bet>state.stars){ toast('Недостаточно звёзд'); return; }
  state.stars-=bet; countGame(); save(); renderBalance();
  hiloBusy=true;
  const nr=Math.floor(Math.random()*CARD_RANKS.length), ns=Math.floor(Math.random()*4);
  if(el.hiloNext){ el.hiloNext.className='card back'; el.hiloNext.innerHTML=''; }
  setTimeout(()=>{
    setCard(el.hiloNext,nr,ns);
    if(el.hiloNext) el.hiloNext.classList.add('flip');
    const curV=hiloCur.r+2, nextV=nr+2;
    let win=false;
    if(hiloPick==='high') win = nextV>curV; else win = nextV<curV;
    const payout = win ? Math.round(bet*1.9) : 0;
    if(win){ state.stars+=payout; addXp(payout); save(); renderBalance(); toast('Победа! +'+payout+' ⭐', true); }
    else if(nextV===curV) toast('Равные карты — не повезло');
    else toast('Не угадал');
    setTimeout(()=>{
      hiloCur={r:nr,s:ns};
      setCard(el.hiloCur,nr,ns);
      if(el.hiloNext){ el.hiloNext.className='card back'; el.hiloNext.innerHTML=''; }
      hiloBusy=false;
    }, 950);
  }, 320);
}

/* =====================================================================
   ПЛИНКО (шарик по колышкам; края x8, центр x0.3; EV ~0.82)
   ===================================================================== */
const PLINKO_MULT=[8,2.5,1.2,0.6,0.3,0.6,1.2,2.5,8];
const PLINKO_ROWS=8;
let plinkoBusy=false;
function plinkoGeom(W,H){
  const slots=PLINKO_MULT.length;
  const slotW=(W-24)/slots;
  const slotY=H-34;
  const top=16;
  const rowH=(slotY-top-8)/(PLINKO_ROWS+1);
  const x0=12+slotW*4.5;
  const half=slotW/2;
  return {slots,slotW,slotY,top,rowH,x0,half};
}
function rr(ctx,x,y,w,h,r){r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function drawBoard(ctx,W,H,ball,flashSlot){
  const G=plinkoGeom(W,H);
  ctx.clearRect(0,0,W,H);
  for(let i=0;i<G.slots;i++){
    const x=12+G.slotW*(i+0.5);
    const isEdge=(i===0||i===G.slots-1);
    ctx.fillStyle = flashSlot===i ? '#ffd76a' : (isEdge?'#5a3fbf':'#242438');
    ctx.strokeStyle='rgba(255,255,255,.18)';ctx.lineWidth=1;
    rr(ctx, x-(G.slotW-4)/2, G.slotY, G.slotW-4, 24, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = flashSlot===i? '#1a1000':'#cfc8ff';
    ctx.font='bold 11px Unbounded, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('x'+PLINKO_MULT[i], x, G.slotY+12);
  }
  for(let r=0;r<PLINKO_ROWS;r++){
    const y=G.top+(r+1)*G.rowH;
    for(let k=-(r+1);k<=(r+1);k+=2){
      const x=G.x0+k*G.half;
      ctx.beginPath();ctx.arc(x,y,3.2,0,Math.PI*2);
      ctx.fillStyle='rgba(255,255,255,.78)';
      ctx.shadowColor='rgba(160,190,255,.8)';ctx.shadowBlur=8;ctx.fill();ctx.shadowBlur=0;
    }
  }
  if(ball){
    ctx.beginPath();ctx.arc(ball.x,ball.y,9,0,Math.PI*2);
    const grd=ctx.createRadialGradient(ball.x-3,ball.y-3,2,ball.x,ball.y,10);
    grd.addColorStop(0,'#fff');grd.addColorStop(0.5,'#ffd76a');grd.addColorStop(1,'#e8892a');
    ctx.fillStyle=grd;ctx.shadowColor='rgba(255,215,106,.9)';ctx.shadowBlur=16;ctx.fill();ctx.shadowBlur=0;
  }
}
function renderPlinko(){
  plinkoBusy=false;
  const cv=el.plinkoCanvas; if(!cv) return;
  const W=Math.max(280, Math.round(cv.getBoundingClientRect().width||300));
  const H=Math.round(W*1.05);
  const dpr=Math.min(window.devicePixelRatio||1,2);
  cv.width=W*dpr;cv.height=H*dpr;cv.style.height=H+'px';
  const ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
  cv._ctx=ctx;cv._W=W;cv._H=H;
  const G=plinkoGeom(W,H);
  drawBoard(ctx,W,H,{x:G.x0,y:G.top},null);
}
function dropPlinko(){
  if(plinkoBusy) return;
  const bet=parseInt(el.plinkoBet.value,10);
  if(isNaN(bet)||bet<1){toast('Ставка от 1 звезды');return;}
  if(bet>state.stars){toast('Недостаточно звёзд');return;}
  state.stars-=bet;countGame();save();renderBalance();
  plinkoBusy=true;
  const cv=el.plinkoCanvas;
  if(!cv || !cv._ctx) renderPlinko();
  const ctx=cv._ctx,W=cv._W,H=cv._H,G=plinkoGeom(W,H);
  const pts=[{x:G.x0,y:G.top}];
  let x=G.x0,rights=0;
  for(let r=0;r<PLINKO_ROWS;r++){
    const dir=Math.random()<0.5?-1:1;
    if(dir>0)rights++;
    x+=dir*G.half;
    pts.push({x:x,y:G.top+(r+1)*G.rowH});
  }
  const slot=rights;
  const start=performance.now(),seg=140,total=seg*(pts.length-1);
  let settled=false;
  function settle(){
    if(settled) return; settled=true;
    drawBoard(ctx,W,H,{x:12+G.slotW*(slot+0.5),y:G.slotY+12},slot);
    finishPlinko(slot,bet);
  }
  function frame(t){
    if(settled) return;
    let p=(t-start)/total; if(!isFinite(p)) p=1; p=Math.max(0,Math.min(1,p));
    const gg=p*(pts.length-1);
    const i=Math.max(0,Math.min(pts.length-2,Math.floor(gg)));
    const f=gg-i,a=pts[i],b=pts[i+1];
    const bx=a.x+(b.x-a.x)*f, by=a.y+(b.y-a.y)*f-Math.sin(f*Math.PI)*4;
    drawBoard(ctx,W,H,{x:bx,y:by},null);
    if(p<1) requestAnimationFrame(frame); else settle();
  }
  requestAnimationFrame(frame);
  setTimeout(settle, total+600); // страховка, если кадры не идут
}
function finishPlinko(slot,bet){
  const mult=PLINKO_MULT[slot];
  const payout=Math.round(bet*mult);
  if(payout>0){ state.stars+=payout; if(typeof addXp==='function') addXp(payout); save(); renderBalance(); }
  if(mult>=1) toast('x'+mult+'! +'+payout+' ⭐', true);
  else if(payout>0) toast('x'+mult+' — '+payout+' ⭐ (меньше ставки)');
  setTimeout(function(){ plinkoBusy=false; },500);
}

/* =====================================================================
   АПГРЕЙДЕР (шанс = ставка/цель × 0.95, «стрелка»)
   ===================================================================== */
const GIFTS = [
  { id:'bear',   name:'Мишка',  val:50,   img:'assets/подарок_мишка.jpg' },
  { id:'duck',   name:'Уточка', val:150,  img:'assets/подарок_уточка.jpg' },
  { id:'cake',   name:'Тортик', val:400,  img:'assets/подарок_торт.jpg' },
  { id:'crown',  name:'Корона', val:1000, img:'assets/подарок_корона.jpg' },
  { id:'rocket', name:'Ракета', val:3000, img:'assets/подарок_ракета.jpg' },
];
function giftById(id){ return GIFTS.find(g=>g.id===id); }
function giftCount(id){ return (state.gifts && state.gifts[id])||0; }
function seedGifts(){
  if(!state.giftStarter){
    state.gifts = state.gifts || {};
    state.gifts['bear'] = (state.gifts['bear']||0) + 2;
    state.giftStarter = true; save();
  }
}
let upBet=50, upMult=2, upBusy=false, upSrc='stars', upNftTarget=null;
const UP_MULTS=[1.5,2,2.5,3,4,5,6,7,8,9,10];
const UP_CHANCE={1.5:.40,2:.30,2.5:.22,3:.18,4:.12,5:.09,6:.07,7:.06,8:.05,9:.04,10:.035};
const UP_RING_C=2*Math.PI*82;
function upNft(){ return state.userNFT? MODEL_CATALOG.find(m=>m.id===state.userNFT):null; }
function upChanceVal(){
  if(upSrc==='nft'){
    const from=upNft();
    if(!from||!upNftTarget) return 0;
    if(upNftTarget.kind==='balance') return Math.min(.97,.30*chanceBoost());
    const to=MODEL_CATALOG.find(m=>m.id===upNftTarget.id);
    if(!to||to.price<=from.price) return 0;
    return Math.min(.97, from.price/to.price*.55*chanceBoost());
  }
  return Math.min(.97,(UP_CHANCE[upMult]||.03)*chanceBoost());
}
function upTargetVal(){
  if(upSrc==='nft'){
    const from=upNft(); if(!from) return 0;
    if(upNftTarget&&upNftTarget.kind==='balance') return from.price;
    const to=upNftTarget? MODEL_CATALOG.find(m=>m.id===upNftTarget.id):null;
    return to? to.price:0;
  }
  return Math.max(Math.round(upBet*upMult), upBet+1);
}
function openBetModal(){
  const m=document.getElementById('upBetModal'); const inp=document.getElementById('upBetInput');
  if(inp){ inp.max=Math.max(1,state.stars); inp.value=upBet; }
  const nft=upNft();
  const wrap=document.getElementById('upBetNftWrap');
  if(wrap) wrap.style.display = nft?'block':'none';
  if(nft){
    const img=document.getElementById('upBetNftImg'); if(img) img.src=nft.image;
    const nm=document.getElementById('upBetNftName'); if(nm) nm.textContent=nft.name;
    const pr=document.getElementById('upBetNftPrice'); if(pr) pr.textContent=nft.price+' ⭐';
  }
  if(m) m.classList.add('open');
}
function closeBetModal(){ const m=document.getElementById('upBetModal'); if(m) m.classList.remove('open'); }
function applyBet(v){ v=parseInt(v,10)||1; v=Math.max(1,v); if(state.stars>0 && v>state.stars) v=state.stars; upBet=v; upSrc='stars'; upNftTarget=null; closeBetModal(); renderUpgrade(); }
function openTgtModal(){
  const m=document.getElementById('upTgtModal'), g=document.getElementById('upTgtGrid');
  if(!m||!g) return;
  g.innerHTML='';
  if(upSrc==='nft' && upNft()){
    const from=upNft();
    const bal=document.createElement('button');
    bal.className='up-opt';
    bal.innerHTML='<span>Баланс ×2</span><span class="o-val">+'+from.price+' ⭐</span><span class="o-chance">30%</span>';
    bal.addEventListener('click',()=>{ upNftTarget={kind:'balance'}; closeTgtModal(); renderUpgrade(); });
    g.appendChild(bal);
    MODEL_CATALOG.filter(x=>x.price>from.price).forEach(x=>{
      const ch=Math.min(55, from.price/x.price*55);
      const d=document.createElement('button');
      d.className='up-opt';
      d.innerHTML='<img src="'+x.image+'" alt=""><span>'+x.name+'</span><span class="o-val">'+x.price+' ⭐</span><span class="o-chance">'+ch.toFixed(1)+'%</span>';
      d.addEventListener('click',()=>{ upNftTarget={kind:'nft',id:x.id}; closeTgtModal(); renderUpgrade(); });
      g.appendChild(d);
    });
  } else {
    UP_MULTS.forEach(M=>{
      const payout=Math.max(Math.round(upBet*M), upBet+1);
      const ch=(UP_CHANCE[M]||.03)*100;
      const d=document.createElement('button');
      d.className='up-opt';
      d.innerHTML='<span>×'+M+'</span><span class="o-val">'+payout+' ⭐</span><span class="o-chance">'+ch.toFixed(1)+'%</span>';
      d.addEventListener('click',()=>{ upMult=M; closeTgtModal(); renderUpgrade(); });
      g.appendChild(d);
    });
  }
  m.classList.add('open');
}
function closeTgtModal(){ const m=document.getElementById('upTgtModal'); if(m) m.classList.remove('open'); }
function renderUpQuick(){
  const box=document.getElementById('upQuick'); if(!box) return;
  box.innerHTML='';
  const owned=GIFTS.filter(g=>giftCount(g.id)>0);
  if(!owned.length){ box.style.display='none'; return; }
  box.style.display='flex';
  owned.slice(0,6).forEach(g=>{
    const b=document.createElement('button');
    b.className='up-qchip'+(upFrom&&upFrom.kind==='gift'&&upFrom.id===g.id?' sel':'');
    b.innerHTML='<img src="'+g.img+'" alt=""><span>'+g.val+' ⭐</span><span class="q-mult">x2</span>';
    b.addEventListener('click',()=>{ upFrom={kind:'gift',id:g.id}; if(upToVal()&&upToVal()<=g.val) upTo=null; renderUpgrade(); });
    box.appendChild(b);
  });
}
function openUpPick(mode){
  upPickMode=mode;
  const m=document.getElementById('upPickModal'), g=document.getElementById('upPickGrid'), t=document.getElementById('upPickTitle');
  if(!m||!g) return;
  if(t) t.textContent = mode==='src'?'Ваш подарок':'Хочу получить';
  g.innerHTML='';
  const sv=mode==='dst'?upFromVal():0;
  GIFTS.forEach(gf=>{
    if(mode==='src' && giftCount(gf.id)<=0) return;
    if(mode==='dst' && sv && gf.val<=sv) return;
    const d=document.createElement('button');
    d.className='up-opt';
    let extra='';
    if(mode==='src') extra='<span class="o-cnt">×'+giftCount(gf.id)+'</span>';
    else if(sv>0) extra='<span class="o-chance">'+((sv/gf.val*0.96)*100).toFixed(1)+'%</span>';
    d.innerHTML='<img src="'+gf.img+'" alt=""><span>'+gf.name+'</span><span class="o-val">'+gf.val+' ⭐</span>'+extra;
    d.addEventListener('click',()=>{
      if(mode==='src'){ upFrom={kind:'gift',id:gf.id}; if(upToVal()&&upToVal()<=gf.val) upTo=null; }
      else { upTo={kind:'gift',id:gf.id}; }
      closeUpPick(); renderUpgrade();
    });
    g.appendChild(d);
  });
  if(mode==='src'){
    const d=document.createElement('button');
    d.className='up-opt';
    d.innerHTML='<span class="o-star">⭐</span><span>Звёзды</span><span class="o-val">'+upStar+' ⭐</span>';
    d.addEventListener('click',()=>{ upFrom={kind:'stars'}; closeUpPick(); renderUpgrade(); });
    g.appendChild(d);
  } else {
    UP_STAR_TARGETS.forEach(amt=>{
      if(sv && amt<=sv) return;
      const d=document.createElement('button');
      d.className='up-opt';
      const ch=sv?((sv/amt*0.96*chanceBoost())*100).toFixed(1)+'%':'';
      d.innerHTML='<span class="o-star">⭐</span><span>'+amt+' звёзд</span>'+(ch?'<span class="o-chance">'+ch+'</span>':'');
      d.addEventListener('click',()=>{ upTo={kind:'stars',amount:amt}; closeUpPick(); renderUpgrade(); });
      g.appendChild(d);
    });
  }
  m.classList.add('open');
}
function closeUpPick(){ const m=document.getElementById('upPickModal'); if(m) m.classList.remove('open'); }
function upChanceStars(){ return Math.min(.97, 0.95/upMult*chanceBoost()); }
function upTargetStarsVal(){ const bet=parseInt(el.upBet.value,10)||0; return Math.round(bet*upMult); }
function currentChance(){
  if(upTab==='stars') return upChanceStars();
  if(upFrom&&upTo){ const f=giftById(upFrom), t=giftById(upTo); if(f&&t) return f.val/t.val*0.95; }
  return 0;
}
function updateDial(){
  const ch=Math.max(0,Math.min(1,currentChance()));
  const pct=(ch*100).toFixed(2);
  if(el.upSector){ el.upSector.style.background='conic-gradient(from -90deg,#2fa85f 0 '+pct+'%,#23233a '+pct+'% 100%)'; }
}
function renderUpHistory(){
  if(!el.upHistory) return;
  el.upHistory.innerHTML='';
  upLog.slice(-8).reverse().forEach(h=>{
    const d=document.createElement('div');
    d.className='up-h '+(h.win?'win':'lose');
    d.innerHTML='<span>'+(h.win?'Победа':'Проигрыш')+' · '+(h.chance*100).toFixed(1)+'%</span><span>'+(h.win?'+'+h.winVal:'-'+h.loseVal)+'</span>';
    el.upHistory.appendChild(d);
  });
}
function renderGiftPicker(){
  if(!el.upFromGifts) return;
  el.upFromGifts.innerHTML='';
  const owned=GIFTS.filter(g=>giftCount(g.id)>0);
  if(owned.length===0){
    el.upFromGifts.innerHTML='<div class="cells-note" style="grid-column:1/-1">Нет подарков — выиграй их в апгрейде.</div>';
  }
  owned.forEach(g=>{
    const d=document.createElement('div');
    d.className='up-gift'+(upFrom===g.id?' sel':'');
    d.innerHTML='<img src="'+g.img+'" alt=""><div class="g-name">'+g.name+'</div><div class="g-val">'+g.val+' ⭐</div><span class="g-cnt">'+giftCount(g.id)+'</span>';
    d.addEventListener('click',()=>{ upFrom=g.id; if(upTo && giftById(upTo).val<=g.val) upTo=null; renderUpgrade(); });
    el.upFromGifts.appendChild(d);
  });
  el.upToGifts.innerHTML='';
  const fromG=upFrom?giftById(upFrom):null;
  GIFTS.filter(g=>!fromG || g.val>fromG.val).forEach(g=>{
    const d=document.createElement('div');
    d.className='up-gift'+(upTo===g.id?' sel':'')+(!fromG?' dis':'');
    d.innerHTML='<img src="'+g.img+'" alt=""><div class="g-name">'+g.name+'</div><div class="g-val">'+g.val+' ⭐</div>';
    d.addEventListener('click',()=>{ if(!fromG) return; upTo=g.id; renderUpgrade(); });
    el.upToGifts.appendChild(d);
  });
  if(el.upChanceGifts){
    if(fromG && upTo){ el.upChanceGifts.textContent=(fromG.val/giftById(upTo).val*0.95*100).toFixed(1)+'%'; }
    else el.upChanceGifts.textContent='—';
  }
}
function renderUpgrade(){
  const bal=document.getElementById('upBalance'); if(bal) bal.textContent=state.stars;
  const nft=upSrc==='nft'?upNft():null;
  const ch=upChanceVal(), pct=ch*100, pctTxt=(pct>0?pct.toFixed(2).replace('.',','):'0')+' %';
  const arc=document.getElementById('upRingArc'); if(arc) arc.style.strokeDasharray=(ch*UP_RING_C)+' '+UP_RING_C;
  const cp=document.getElementById('upChancePct'); if(cp){ cp.style.display=nft?'none':'block'; cp.textContent=pctTxt; }
  const cpSub=document.querySelector('.up-pct-sub'); if(cpSub) cpSub.style.display=nft?'none':'block';
  const img=document.getElementById('upNftImg');
  if(img){ img.style.display=nft?'block':'none'; if(nft) img.src=nft.image; }
  const cl=document.getElementById('upChance'); if(cl) cl.textContent=pctTxt;
  const cwrap=document.querySelector('.up-chance-line'); if(cwrap) cwrap.style.display=nft?'none':'block';
  const sv=document.getElementById('upSrcVal'); const tv=document.getElementById('upTgtVal');
  const amtRow=document.querySelector('.up-amount-row'); const chips=document.getElementById('upChips');
  const target=upTargetVal();
  if(nft){
    if(sv) sv.textContent='НФТ: '+nft.name+' · '+nft.price+' ⭐';
    if(upNftTarget){
      if(upNftTarget.kind==='balance'){ if(tv) tv.textContent='Баланс +'+nft.price+' ⭐'; }
      else { const t=MODEL_CATALOG.find(m=>m.id===upNftTarget.id); if(tv) tv.textContent=(t?t.name+' · '+t.price+' ⭐':''); }
    } else { if(tv) tv.textContent='Выбрать цель'; }
    if(amtRow) amtRow.style.display='none';
    if(chips) chips.style.display='none';
  } else {
    if(sv) sv.textContent='Ставка '+upBet+' ⭐';
    if(tv) tv.textContent=target+' ⭐ · ×'+upMult;
    if(amtRow) amtRow.style.display='flex';
    if(chips) chips.style.display='flex';
    document.querySelectorAll('.up-chip').forEach(b=>b.classList.toggle('active', parseFloat(b.dataset.mult)===upMult));
    const av=document.getElementById('upAmountVal'); if(av) av.textContent=upBet;
    const sl=document.getElementById('upSlider'); if(sl){ sl.max=Math.max(1,state.stars); sl.value=Math.min(upBet,sl.max); }
  }
  const sm=document.getElementById('upSummary');
  if(sm){
    if(nft){ sm.textContent = upNftTarget? (upNftTarget.kind==='balance'?('НФТ на баланс: +'+nft.price+' ⭐'):('НФТ → '+((MODEL_CATALOG.find(m=>m.id===upNftTarget.id)||{}).name||''))) : 'Выберите, на что играете'; }
    else { sm.textContent='Ставка '+upBet+' ⭐ → '+target+' ⭐ · шанс '+pctTxt; }
  }
  let can;
  if(nft) can=!!upNftTarget; else can=(upBet>=1 && upBet<=state.stars);
  const go=document.getElementById('upGo'); if(go) go.disabled=!can;
  const sub=document.getElementById('upGoSub');
  if(sub) sub.textContent = nft ? (upNftTarget?'НФТ на кону':'выберите цель') : (!can?(state.stars<1?'пополните баланс':'недостаточно звёзд'):('шанс '+pctTxt+' · выиграешь '+target+' ⭐'));
}
function doUpgrade(){
  if(upBusy) return;
  const ch=upChanceVal();
  const nft=upSrc==='nft'?upNft():null;
  if(nft){ if(!upNftTarget){ toast('Выберите цель'); return; } }
  else if(upBet<1||upBet>state.stars){ toast(state.stars<1?'Пополните баланс':'Недостаточно звёзд'); return; }
  const chDeg=ch*360, target=upTargetVal();
  upBusy=true;
  if(!nft){ state.stars-=upBet; save(); renderBalance(); }
  const win=Math.random()<ch;
  let deg;
  if(win){ deg=4+Math.random()*Math.max(1,chDeg-8); }
  else { deg=chDeg+6+Math.random()*Math.max(1,354-chDeg); }
  const needle=document.getElementById('upNeedle');
  if(needle){ needle.style.transition='none'; needle.style.transform='rotate(0deg)'; void needle.getBoundingClientRect(); needle.style.transition='transform 4.8s cubic-bezier(.06,.62,.08,1)'; needle.style.transform='rotate('+(8*360+deg)+'deg)'; }
  const nimg=document.getElementById('upNftImg'); if(nimg) nimg.classList.add('spin');
  const go=document.getElementById('upGo'); if(go) go.disabled=true;
  setTimeout(()=>{
    if(nimg) nimg.classList.remove('spin');
    if(nft){
      if(win){
        if(upNftTarget.kind==='balance'){ state.stars+=nft.price; if(typeof addXp==='function') addXp(nft.price); toast('Победа! +'+nft.price+' ⭐, НФТ остался', true); }
        else { state.userNFT=upNftTarget.id; toast('Победа! Теперь у тебя '+((MODEL_CATALOG.find(m=>m.id===upNftTarget.id)||{}).name||'НФТ'), true); }
      } else { state.userNFT=null; upSrc='stars'; upNftTarget=null; toast('Проигрыш. НФТ сгорел'); }
      save(); renderBalance(); if(typeof renderNFT==='function') renderNFT();
    } else {
      if(win){ state.stars+=target; if(typeof addXp==='function') addXp(target); save(); renderBalance(); toast('Победа! +'+target+' ⭐', true); }
      else { toast('Проигрыш. Ставка сгорела'); }
    }
    upBusy=false; renderUpgrade();
  }, 5000);
}

/* =====================================================================
   СОБЫТИЯ
   ===================================================================== */
document.addEventListener('click',(e)=>{
  const soon=e.target.closest('[data-soon]');
  if(soon){ toast('Скоро появится!'); return; }
  const back=e.target.closest('[data-go]');
  if(back){ goBack(); return; }
  const g=e.target.closest('[data-goto]');
  if(g){ goto(g.dataset.goto); return; }
});
el.balBtn.addEventListener('click',()=>goto('donate'));
el.balBtnShop.addEventListener('click',e=>{e.stopPropagation();goto('donate');});
el.nftChip.addEventListener('click',()=>{
  if(state.userNFT) openViewer(state.userNFT);
  else toast('Купи НФТ в магазине событий');
});
el.modalClose.addEventListener('click',closeModal);
el.nftModal.addEventListener('click',e=>{ if(e.target===el.nftModal) closeModal(); });
el.viewerClose.addEventListener('click',closeViewer);
el.viewerModal.addEventListener('click',e=>{ if(e.target===el.viewerModal) closeViewer(); });
document.querySelectorAll('#donatePresets button').forEach(b=>b.addEventListener('click',()=>donateDeep(b.dataset.donate)));
const donateGo=document.getElementById('donateGoBtn'); if(donateGo) donateGo.addEventListener('click',()=>donateDeep(50));
const adminMedal=document.getElementById('adminMedal'); if(adminMedal) adminMedal.addEventListener('click',openAdmin);
const adminClose=document.getElementById('adminClose'); if(adminClose) adminClose.addEventListener('click',closeAdmin);
const adminModalEl=document.getElementById('adminModal'); if(adminModalEl) adminModalEl.addEventListener('click',e=>{ if(e.target===adminModalEl) closeAdmin(); });
document.querySelectorAll('#adminModal [data-grant]').forEach(b=>b.addEventListener('click',()=>grantStars(b.dataset.grant)));
const adminGrantBtn=document.getElementById('adminGrantBtn'); if(adminGrantBtn) adminGrantBtn.addEventListener('click',()=>{ const i=document.getElementById('adminAmount'); grantStars(i?i.value:0); });
const mark1=document.getElementById('mapMark1'); if(mark1) mark1.addEventListener('click',()=>{ el.mapModal.classList.remove('open'); teleportTo(1); });
const mark2=document.getElementById('mapMark2'); if(mark2) mark2.addEventListener('click',()=>{ if((state.level||1)<LOC2_LEVEL){ toast('Откроется на '+LOC2_LEVEL+' уровне'); return; } el.mapModal.classList.remove('open'); teleportTo(2); });
const locBack=document.getElementById('locBackBtn'); if(locBack) locBack.addEventListener('click',()=>teleportTo(1));
el.keyShopClose.addEventListener('click',closeKeyShop);
el.keyShopModal.addEventListener('click',e=>{ if(e.target===el.keyShopModal) closeKeyShop(); });
el.keyShopModal.querySelectorAll('.key-pack').forEach(b=>{ b.addEventListener('click',()=>buyKeys(parseInt(b.dataset.pack,10))); });
el.priceOkBtn.addEventListener('click',confirmSellToMarket);
el.priceCancelBtn.addEventListener('click',closePriceModal);
el.priceClose.addEventListener('click',closePriceModal);
el.priceModal.addEventListener('click',e=>{ if(e.target===el.priceModal) closePriceModal(); });
el.prizeContinue.addEventListener('click',closePrize);

// подарок
el.giftFab && el.giftFab.addEventListener('click',()=>goto('gift'));
el.giftClaimBtn && el.giftClaimBtn.addEventListener('click',claimGift);

// карта
if(el.mapBtn) el.mapBtn.addEventListener('click',()=>el.mapModal.classList.add('open'));
if(el.mapClose) el.mapClose.addEventListener('click',()=>el.mapModal.classList.remove('open'));
if(el.mapModal) el.mapModal.addEventListener('click',e=>{ if(e.target===el.mapModal) el.mapModal.classList.remove('open'); });

// профиль (клик по аватару)
if(el.avatar) el.avatar.addEventListener('click',openProfile);
if(el.profileClose) el.profileClose.addEventListener('click',()=>el.profileModal.classList.remove('open'));
if(el.profileModal) el.profileModal.addEventListener('click',e=>{ if(e.target===el.profileModal) el.profileModal.classList.remove('open'); });

// кейсы
el.caseGrid && el.caseGrid.addEventListener('click',e=>{
  const b=e.target.closest('[data-case]');
  if(b) openCase(b.dataset.case);
});
el.caseClaim && el.caseClaim.addEventListener('click',()=>el.caseModal.classList.remove('open'));

// колесо
el.wheelSpin && el.wheelSpin.addEventListener('click',spinWheel);

// напёрстки
el.cupsStart && el.cupsStart.addEventListener('click',startCups);
if(el.cupsRow) [...el.cupsRow.querySelectorAll('.cup')].forEach((cup,idx)=>{
  cup.addEventListener('click',()=>pickCup(idx));
});

// кости
if(el.diceRoll) el.diceRoll.addEventListener('click',rollDice);
document.querySelectorAll('.dice-choice').forEach(b=>b.addEventListener('click',()=>{ dicePick=b.dataset.pick; renderDice(); }));

// дартс
if(el.dartsThrow) el.dartsThrow.addEventListener('click',throwDart);

// выше-ниже
if(el.hiloPull) el.hiloPull.addEventListener('click',pullHilo);
document.querySelectorAll('.dice-choice[data-hilo]').forEach(b=>b.addEventListener('click',()=>{ hiloPick=b.dataset.hilo; renderHilo(); }));

// плинко
if(el.plinkoDrop) el.plinkoDrop.addEventListener('click',dropPlinko);

// апгрейдер
const upPlusBtn=document.getElementById('upPlus');
if(upPlusBtn) upPlusBtn.addEventListener('click',openBetModal);
const upPickSrcBtn=document.getElementById('upPickSrc');
if(upPickSrcBtn) upPickSrcBtn.addEventListener('click',openBetModal);
const upPickTgtBtn=document.getElementById('upPickTgt');
if(upPickTgtBtn) upPickTgtBtn.addEventListener('click',openTgtModal);
const upBetCloseBtn=document.getElementById('upBetClose');
if(upBetCloseBtn) upBetCloseBtn.addEventListener('click',closeBetModal);
const upBetModalEl=document.getElementById('upBetModal');
if(upBetModalEl) upBetModalEl.addEventListener('click',e=>{ if(e.target===upBetModalEl) closeBetModal(); });
const upBetOkBtn=document.getElementById('upBetOk');
if(upBetOkBtn) upBetOkBtn.addEventListener('click',()=>{ const inp=document.getElementById('upBetInput'); applyBet(inp?inp.value:upBet); });
const upBetNftBtn=document.getElementById('upBetNft');
if(upBetNftBtn) upBetNftBtn.addEventListener('click',()=>{ if(!upNft()) return; upSrc='nft'; upNftTarget=null; closeBetModal(); renderUpgrade(); });
document.querySelectorAll('#upBetPresets button').forEach(b=>b.addEventListener('click',()=>applyBet(b.dataset.bet)));
const upTgtCloseBtn=document.getElementById('upTgtClose');
if(upTgtCloseBtn) upTgtCloseBtn.addEventListener('click',closeTgtModal);
const upTgtModalEl=document.getElementById('upTgtModal');
if(upTgtModalEl) upTgtModalEl.addEventListener('click',e=>{ if(e.target===upTgtModalEl) closeTgtModal(); });
document.querySelectorAll('.up-chip').forEach(b=>b.addEventListener('click',()=>{ const m=parseFloat(b.dataset.mult); if(m) upMult=m; renderUpgrade(); }));
const upSl=document.getElementById('upSlider');
if(upSl) upSl.addEventListener('input',()=>{ upBet=Math.max(1,parseInt(upSl.value,10)||1); if(state.stars>0 && upBet>state.stars) upBet=state.stars; renderUpgrade(); });
const upGoBtn=document.getElementById('upGo');
if(upGoBtn) upGoBtn.addEventListener('click',doUpgrade);

// ячейки: кнопки
el.openOneBtn && el.openOneBtn.addEventListener('click',()=>{
  if(state.keys>0){
    const closed=Array.from({length:CELL_COUNT},(_,i)=>i+1).filter(n=>!state.cellsOpened.includes(n));
    if(closed.length) openCell(closed[0]);
    else toast('Все ячейки открыты');
  } else toast('Купи ключи');
});
el.keyShopBtn && el.keyShopBtn.addEventListener('click',openKeyShop);
el.keyBtnTop && el.keyBtnTop.addEventListener('click',openKeyShop);
el.cellResetBtn && el.cellResetBtn.addEventListener('click',forceResetCells);

// мины
el.minesStart.addEventListener('click',startMines);
el.minesCashout.addEventListener('click',cashoutMines);
el.minesMineBtns = document.querySelectorAll('.mine-count-btn');
el.minesMineBtns.forEach(b=>b.addEventListener('click',()=>{
  el.minesMineBtns.forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  if(!mineState.active) renderMines();
}));

// ambient orb
window.addEventListener('mousemove',e=>{
  const orb=document.querySelector('.ambient-orb'); if(!orb) return;
  orb.style.left=(e.clientX-110)+'px'; orb.style.top=(e.clientY-110)+'px'; orb.style.opacity='1';
});

// таймер ячеек
setInterval(()=>{ if(document.getElementById('screen-cells').classList.contains('active')) updateCellTimer(); }, 1000);

/* =====================================================================
   СТАРТ
   ===================================================================== */
(async function boot(){
  const hideLoad=()=>{ const ls=document.getElementById('loadingScreen'); if(ls) ls.classList.add('hidden'); };
  setTimeout(hideLoad, 3800);            // страховка, если что-то задержится
  load(); initTelegram();
  if(!state.firstSeen){ state.firstSeen=Date.now(); save(); }
  seedGifts();
  renderBalance(); renderLevel(); renderNFT(); renderCells();
  document.body.classList.toggle('loc2', state.loc===2);
  renderLocUI();
  renderGiftFab();
  await threeReady();
  renderNFT();
  renderShop();
  renderMines();
  setTimeout(hideLoad, 350);
  // ежесекундное обновление подарка (иконка в меню + таймер на экране)
  setInterval(()=>{
    const gs=document.getElementById('screen-gift');
    const ms=document.getElementById('screen-menu');
    if(gs && gs.classList.contains('active')) updateGiftTimer();
    if(ms && ms.classList.contains('active')) renderGiftFab();
  }, 1000);
})();