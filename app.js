/* =====================================================================
   GLOW UP — Telegram Mini App (веб-версия)
   Меню, магазин 3D-НФТ, мины, ячейки, продажа. 3D через Three.js (локально).
   ===================================================================== */

// ---------- Настройки ----------
const CODE_PASS   = '0306';
const CODE_REWARD = 1000;
const KEY_PRICE   = 100;
const KEY_PACKS   = [ {n:1, price:100}, {n:5, price:500}, {n:10, price:1000} ];
const DONATE_BOT  = '@gryzikkk200';
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
};

const MODEL_CATALOG = [
  { id:'1', name:'DianaLovis', rarity:'legendary', price:1000, model:'assets/1.glb', image:'assets/11.png' },
  { id:'2', name:'LerwaxiMi', rarity:'epic',      price:2500, model:'assets/2.glb', image:'assets/22.png' },
  { id:'3', name:'Sweaty',     rarity:'common',   price:900,  model:'assets/3.glb', image:'assets/33.png' },
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
      el.userName.textContent = u.first_name || 'Игрок';
      el.userHandle.textContent = u.username ? '@'+u.username : 'id '+u.id;
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

// ---------- Состояние ----------
function save(){ try{ localStorage.setItem('es3d_v3', JSON.stringify(state)); }catch(_){} }
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
  const badge = document.querySelector('[data-badge="keys"]');
  if (badge) badge.textContent = state.keys + ' 🔑';
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
  const PR = opts.mini ? 1.2 : 1.5;
  const renderer = new THREE.WebGLRenderer({ antialias:!!opts.orbit, alpha:true, preserveDrawingBuffer:true });
  renderer.setPixelRatio(Math.max(1, Math.min(window.devicePixelRatio||1, PR)));
  renderer.setClearColor(0x000000, 0);
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

  const loop = ()=>{
    if(!raf) return;
    requestAnimationFrame(loop);
    if(controls) controls.update();
    else if(group && opts.spin) group.rotation.y += 0.006;
    renderer.render(scene,camera);
  };
  loop();

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
      if(p3d){ e.stopPropagation(); const node=c.querySelector(`[data-p3d="${p3d.dataset.p3dBtn}"]`); c.classList.add('viewing'); previewInto(node,p3d.dataset.p3dBtn,()=>{ node.innerHTML += '<button class="card-3d-back" data-card-back>Обратно</button>'; }); return; }
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
  state.keys--; renderBalance();
  const res=cellPool[num-1];
  openingCell=true;
  state.cellsOpened.push(num);
  save();
  const cellEl=el.cellsRack.querySelector(`[data-cell="${num}"]`);
  if(cellEl) cellEl.classList.add('reveal-glow','pulse');
  setTimeout(()=>{ renderCells(); showPrize(res); }, 500);
}
function showPrize(res){
  if(res.type==='big'||res.type==='stars'){ state.stars+=res.stars; renderBalance(); }
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
  state.stars-=bet; save(); renderBalance();
  renderMines();
}
function openMine(i){
  if(!mineState.active || mineState.opened.includes(i)) return;
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
  state.stars+=w; save(); renderBalance();
  mineState.active=false;
  toast('Ты забрал '+w+' ⭐!', true);
  renderMines(); renderBalance();
}

/* =====================================================================
   НАГРАДЫ / КОД
   ===================================================================== */
function applyCode(){
  const v=(el.codeInput.value||'').trim();
  if(v===CODE_PASS){ state.stars+=CODE_REWARD; save(); renderBalance(); toast('+'+CODE_REWARD+' звёзд!',true); el.codeInput.value=''; }
  else toast('Неверный код');
}
function donate(){ toast('Донат через бота '+DONATE_BOT); }

/* =====================================================================
   СОБЫТИЯ
   ===================================================================== */
document.addEventListener('click',(e)=>{
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
el.codeApplyBtn.addEventListener('click',applyCode);
el.codeInput.addEventListener('keydown',e=>{ if(e.key==='Enter') applyCode(); });
el.donateBtn.addEventListener('click',donate);
el.keyShopClose.addEventListener('click',closeKeyShop);
el.keyShopModal.addEventListener('click',e=>{ if(e.target===el.keyShopModal) closeKeyShop(); });
el.keyShopModal.querySelectorAll('.key-pack').forEach(b=>{ b.addEventListener('click',()=>buyKeys(parseInt(b.dataset.pack,10))); });
el.priceOkBtn.addEventListener('click',confirmSellToMarket);
el.priceCancelBtn.addEventListener('click',closePriceModal);
el.priceClose.addEventListener('click',closePriceModal);
el.priceModal.addEventListener('click',e=>{ if(e.target===el.priceModal) closePriceModal(); });
el.prizeContinue.addEventListener('click',closePrize);

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
  load(); initTelegram();
  renderBalance(); renderNFT(); renderCells();
  await threeReady();
  renderNFT();
  renderShop();
  renderMines();
})();