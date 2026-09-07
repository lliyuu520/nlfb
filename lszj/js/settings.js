// settings.js - 设置页：独立全屏页面（左侧菜单 + 右侧可滚动内容区）
// 取代旧的弹窗式面板：整页绘制、不依赖主页底图，菜单可无限扩展、内容区支持拖动滚动。
// 扩展约定（新增一项功能只需三步）：
//   1) TABS 数组加一项 {key, t, c, icon}
//   2) drawContent 的 switch 里加一个 case，绘制时用 hit() 注册点击区
//   3) 内容超出一屏时给 contentHeight 一个估算值（缺省也能用：绘制后会自校正 scroll）
"use strict";
const UI = require('./ui.js');
const CDN = require('./cdn.js');

const COL = { cyan:'#00f3ff', pink:'#ff0055', gold:'#ffe600', green:'#7dff8c', purple:'#c77dff',
  dim:'#8892a8', txt:'#e6eeff', idle:'#2b3b5c', lock:'#5c4a14' };

// 左侧菜单：c = 选中态主题色，icon = 程序化图标类型（不依赖字体字形）
const TABS = [
  { key:'play',  t:'玩法', c:COL.cyan,   icon:'play' },
  { key:'ship',  t:'战机', c:COL.cyan,   icon:'ship' },
  { key:'theme', t:'背景', c:COL.green,  icon:'theme' },
  { key:'shop',  t:'强化', c:COL.gold,   icon:'up' },
  { key:'sound', t:'声音', c:COL.pink,   icon:'snd' },
  { key:'about', t:'关于', c:COL.purple, icon:'info' },
];
const ITEM_H = 48, ITEM_GAP = 8; // 菜单项尺寸与间距
const PAD = 16; // 内容区内边距

// 道具图鉴（与 main.js 掉落物一致；素材名随 CDN 预热清单，未就绪回退字母方块）
const ITEMS = [
  { img:'Buff道具-02', c:'#ff4d4d', l:'R', n:'追踪机炮', d:'子弹自动追敌' },
  { img:'掉落物-02',   c:'#4da6ff', l:'B', n:'穿透激光', d:'贯穿一整列敌人' },
  { img:'Buff道具-06', c:'#ffd23c', l:'Y', n:'追踪导弹', d:'副武器自动索敌' },
  { img:'掉落物-03',   c:'#c77dff', l:'P', n:'激光导弹', d:'副武器贯穿射线' },
  { img:'掉落物-06',   c:'#7dff8c', l:'S', n:'得分徽章', d:'立刻加 500 分' },
];
const UPGRADE_META = {
  drop:  { n:'掉落率',   d:'提高道具掉落概率' },
  power: { n:'火力强度', d:'提高所有武器伤害' },
};

let sx = 1, sy = 1, safeTop = 0;
let S = {};          // 宿主注入：{ bottomInset(), data(), act{}, onClose() }
let tab = 'play';
let scroll = 0, menuScroll = 0, lastH = 0; // lastH：上一帧内容实测高度，用于钳制滚动
let L = null;        // 布局缓存（每帧 draw 刷新，触摸命中使用上一帧的值）
let hits = [];       // 每帧重建的可点击区 {x,y,w,h,fn,c,m}
let dragMode = null, dragY = 0, dragBase = 0, dragMoved = false;
let tip = '', tipUntil = 0;

const clamp = (v,a,b)=>v<a?a:v>b?b:v;
const inRect = (t,b)=>t.x>=b.x&&t.x<=b.x+b.w&&t.y>=b.y&&t.y<=b.y+b.h;
function txt(ctx,s,x,y,color,font,align){ ctx.fillStyle=color; ctx.font=font; ctx.textAlign=align||'left'; ctx.fillText(s,x,y); }
// 按像素宽度断行（中文逐字断即可），返回下一行的 y
function wrap(ctx,s,x,y,maxW,lh){
  ctx.textAlign='left';
  let line='', yy=y;
  for(const ch of String(s)){
    if(ctx.measureText(line+ch).width>maxW){ ctx.fillText(line,x,yy); yy+=lh; line=ch; }
    else line+=ch;
  }
  if(line){ ctx.fillText(line,x,yy); yy+=lh; }
  return yy;
}
function hit(x,y,w,h,fn,inContent,inMenu){ hits.push({x,y,w,h,fn,c:!!inContent,m:!!inMenu}); }

// ---------- 布局 ----------
// 页眉固定于顶部（刘海下方），主体分为左菜单列与右内容列，底部让出手势条
function layout(W,H,safeTop,bottomInset){
  const headY = safeTop + 8, headH = 44;
  const bodyY = headY + headH + 12;
  const bodyH = Math.max(140, H - bodyY - bottomInset - 12);
  return {
    W, H,
    head:  { x:16, y:headY, w:W-32, h:headH },
    back:  { x:22, y:headY+5, w:76, h:34 },
    coin:  { x:W-38-120, y:headY+5, w:120, h:34 },
    menu:  { x:16, y:bodyY, w:104, h:bodyH },
    content:{ x:132, y:bodyY, w:W-132-16, h:bodyH },
    bar:   { x:8, y:headY+3, w:14, h:14 }, // 占位：保留给后续可能的侧滑返回
  };
}

// ---------- 对外 ----------
function setup(o){
  S = o || {};
  sx = S.sx || 1; sy = S.sy || 1;
  if (typeof S.safeTop === 'number') safeTop = S.safeTop;
}
function open(key){
  if (key) tab = key;
  scroll = 0; menuScroll = 0; lastH = 0; tip = ''; tipUntil = 0;
}
function toast(s, sec){ tip = s; tipUntil = Date.now() + (sec || 2) * 1000; }
function close(){ if (S.onClose) S.onClose(); }
function act(name){ return S.act && S.act[name] ? S.act[name] : null; }
function call(name, a){ const f = act(name); if (f) f(a); }

// ---------- 触摸 ----------
function onDown(t){
  if (!L) return;
  if (inRect(t, L.menu)) { dragMode='menu'; dragY=t.y; dragBase=menuScroll; dragMoved=false; return; }
  if (inRect(t, L.content)) { dragMode='content'; dragY=t.y; dragBase=scroll; dragMoved=false; return; }
  dragMode = 'page'; dragY = t.y; dragBase = 0; dragMoved = false;
}
function onMove(t){
  if (!dragMode || !L) return;
  const dy = t.y - dragY;
  if (!dragMoved && Math.abs(dy) > 6) dragMoved = true; // 超过 6px 视为拖动，不再当点击
  if (dragMode === 'menu') {
    const total = TABS.length*(ITEM_H+ITEM_GAP) - ITEM_GAP + 16;
    menuScroll = clamp(dragBase - dy, 0, Math.max(0, total - L.menu.h));
  } else if (dragMode === 'content') {
    scroll = clamp(dragBase - dy, 0, Math.max(0, lastH - L.content.h));
  }
}
function onUp(t){
  const mode = dragMode; dragMode = null;
  if (!L) return;
  if (mode && dragMoved) return; // 拖动过则不当点击
  const ty = t || { x:-1, y:-1 };
  for (let i = hits.length - 1; i >= 0; i--) { // 逆序：后画的在上层，优先命中
    const b = hits[i];
    const y = b.c ? ty.y + scroll : (b.m ? ty.y + menuScroll : ty.y);
    if (ty.x>=b.x && ty.x<=b.x+b.w && y>=b.y && y<=b.y+b.h) { b.fn(); return; }
  }
}

// ---------- 绘制 ----------
function draw(ctx, W, H){
  const inset = (S.bottomInset ? S.bottomInset() : 0) || 0;
  L = layout(W, H, safeTop, inset);
  const d = (S.data ? S.data() : null) || {};
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  ctx.fillStyle = 'rgba(3,6,14,0.92)'; ctx.fillRect(0, 0, W, H); // 压暗星空底，形成独立页面
  hits.length = 0;
  scroll = clamp(scroll, 0, Math.max(0, lastH - L.content.h));
  drawHeader(ctx, d);
  drawMenu(ctx);
  drawContent(ctx, d);
  drawTip(ctx);
}

function drawHeader(ctx, d){
  const h = L.head;
  UI.drawNeonPanel(ctx, h.x, h.y, h.w, h.h, '', COL.cyan);
  UI.drawNeonPanel(ctx, L.back.x, L.back.y, L.back.w, L.back.h, '', COL.pink);
  txt(ctx, '◀ 主页', L.back.x+L.back.w/2, L.back.y+22, '#ff7a95', 'bold 13px monospace', 'center');
  hit(L.back.x, L.back.y, L.back.w, L.back.h, ()=>{ call('click'); close(); });
  ctx.save(); ctx.shadowColor = COL.cyan; ctx.shadowBlur = 12;
  txt(ctx, '设 置', L.W/2, h.y+30, '#9feaff', 'bold 20px monospace', 'center');
  ctx.restore();
  UI.drawNeonPanel(ctx, L.coin.x, L.coin.y, L.coin.w, L.coin.h, '', COL.gold);
  txt(ctx, '◈ ' + (d.coins || 0), L.coin.x+L.coin.w/2, L.coin.y+22, COL.gold, 'bold 14px monospace', 'center');
}

function drawMenu(ctx){
  const M = L.menu;
  UI.drawNeonPanel(ctx, M.x, M.y, M.w, M.h, '', COL.idle);
  ctx.save(); ctx.beginPath(); ctx.rect(M.x+3, M.y+3, M.w-6, M.h-6); ctx.clip();
  TABS.forEach((tb, i) => {
    const y = M.y + 8 + i*(ITEM_H+ITEM_GAP) - menuScroll;
    if (y + ITEM_H < M.y || y > M.y + M.h) return; // 视口外跳过
    const on = tb.key === tab;
    UI.drawNeonPanel(ctx, M.x+7, y, M.w-14, ITEM_H, '', on ? tb.c : '#1b2740');
    if (on) { ctx.fillStyle = tb.c; ctx.fillRect(M.x+7, y+8, 3, ITEM_H-16); } // 选中竖条
    drawIcon(ctx, tb.icon, M.x+26, y+ITEM_H/2, on ? tb.c : COL.dim);
    txt(ctx, tb.t, M.x+44, y+ITEM_H/2+5, on ? '#fff' : COL.dim, on ? 'bold 14px monospace' : '13px monospace');
    hit(M.x+7, y, M.w-14, ITEM_H, ()=>{ tab = tb.key; scroll = 0; lastH = 0; call('click'); }, false, true);
  });
  ctx.restore();
}

function drawContent(ctx, d){
  const C = L.content;
  const tb = TABS.filter(t => t.key === tab)[0] || TABS[0];
  UI.drawNeonPanel(ctx, C.x, C.y, C.w, C.h, '', tb.c);
  ctx.save();
  ctx.beginPath(); ctx.rect(C.x+4, C.y+4, C.w-8, C.h-8); ctx.clip();
  ctx.translate(0, -scroll); // 内容坐标 = 未滚动的绝对 y，点击判定回加 scroll
  let endY = C.y + 20;
  if (tab === 'play') endY = drawPlay(ctx, d, C);
  else if (tab === 'ship') endY = drawShipTab(ctx, d, C);
  else if (tab === 'theme') endY = drawThemeTab(ctx, d, C);
  else if (tab === 'shop') endY = drawShop(ctx, d, C);
  else if (tab === 'sound') endY = drawSound(ctx, d, C);
  else if (tab === 'about') endY = drawAbout(ctx, d, C);
  ctx.restore();
  lastH = endY - C.y + 18; // 实测高度，下一帧用于钳制滚动
  if (lastH > C.h) { // 滚动指示条
    const th = Math.max(28, C.h*C.h/lastH);
    const ty = C.y + 6 + (C.h - 12 - th) * (scroll / Math.max(1, lastH - C.h));
    ctx.fillStyle = 'rgba(0,243,255,0.12)'; ctx.fillRect(C.x+C.w-9, C.y+6, 3, C.h-12);
    ctx.fillStyle = tb.c; ctx.fillRect(C.x+C.w-9, ty, 3, th);
  }
}

// 玩法：操作说明 + 道具图鉴 + 关卡规则
function drawPlay(ctx, d, C){
  const x = C.x + PAD, w = C.w - PAD*2;
  let y = C.y + 24;
  txt(ctx, '操作说明', x, y, COL.gold, 'bold 13px monospace');
  (d.tips || []).forEach(s => {
    y += 24;
    ctx.fillStyle = COL.cyan; ctx.fillRect(x+2, y-5, 4, 4);
    txt(ctx, s, x+14, y, 'rgba(230,240,255,0.85)', '12px monospace');
  });
  y += 18;
  ctx.strokeStyle = 'rgba(0,243,255,0.18)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x+w, y); ctx.stroke();
  y += 26;
  txt(ctx, '道具图鉴', x, y, COL.gold, 'bold 13px monospace');
  for (const it of ITEMS) {
    y += 46;
    const img = CDN.get(it.img);
    if (img) ctx.drawImage(img, x+2, y-32, 28, 28);
    else {
      ctx.fillStyle = it.c; ctx.fillRect(x+2, y-32, 28, 28);
      txt(ctx, it.l, x+16, y-13, '#0a0a12', 'bold 14px monospace', 'center');
    }
    txt(ctx, it.n, x+40, y-16, COL.txt, 'bold 12px monospace');
    txt(ctx, it.d, x+40, y-1, COL.dim, '12px monospace');
  }
  y += 26;
  txt(ctx, '关卡规则', x, y, COL.gold, 'bold 13px monospace');
  y += 12;
  ctx.fillStyle = 'rgba(230,240,255,0.8)'; ctx.font = '12px monospace';
  y = wrap(ctx, '每关 55 秒后首领登场（第 1 关 35 秒），第 2 关起中途还有精英出击；击破首领即通关，可继续下一关或返回主页。', x, y, w, 20);
  ctx.fillStyle = 'rgba(230,240,255,0.8)'; ctx.font = '12px monospace';
  y = wrap(ctx, '阵亡可看广告复活（每局 2 次）；过关与阵亡都按得分折算金币，结算页可看广告翻倍。', x, y+6, w, 20);
  return y;
}

// 战机：顶部当前机体预览 + 下方皮肤卡片（未解锁显示价格，金币足可直接购买并选用）
function drawShipTab(ctx, d, C){
  const ships = d.ships || [], x = C.x + PAD, w = C.w - PAD*2;
  const pv = { x:x, y:C.y+16, w:w, h:96 };
  UI.drawNeonPanel(ctx, pv.x, pv.y, pv.w, pv.h, '', COL.cyan);
  const sk = ships[d.shipIdx] || ships[0];
  if (sk) {
    ctx.save(); ctx.translate(pv.x+54, pv.y+46); ctx.scale(1.5, 1.5);
    if (d.drawShip) d.drawShip(sk);
    ctx.restore();
    txt(ctx, sk.name, pv.x+98, pv.y+40, '#eaffff', 'bold 16px monospace');
    txt(ctx, '当前使用', pv.x+98, pv.y+62, COL.cyan, '12px monospace');
  }
  txt(ctx, '涂装仅改变外观，不影响任何数值', pv.x+98, pv.y+82, COL.dim, '12px monospace');
  let y = pv.y + pv.h + 16;
  ships.forEach((s, i) => {
    const own = !!(d.owned && d.owned.ships && d.owned.ships[i]);
    const on = i === d.shipIdx;
    UI.drawNeonPanel(ctx, x, y, w, 66, '', on ? COL.cyan : own ? COL.idle : COL.lock);
    ctx.save(); ctx.translate(x+42, y+33); ctx.globalAlpha = own ? 1 : 0.4; ctx.scale(0.62, 0.62);
    if (d.drawShip) d.drawShip(s);
    ctx.restore();
    txt(ctx, s.name, x+80, y+29, on ? '#9feaff' : own ? COL.txt : '#c9a227', own ? 'bold 13px monospace' : '13px monospace');
    txt(ctx, on ? '使用中' : own ? '点击选用' : '◈ ' + ((d.shipPrice && d.shipPrice[i]) || 0) + ' 解锁',
      x+80, y+50, on ? COL.cyan : own ? COL.dim : '#c9a227', '12px monospace');
    hit(x, y, w, 66, ()=>call('pickShip', i), true);
    y += 76;
  });
  return y;
}

// 背景：主题卡片（色块预览 + 解锁/选用状态）
function drawThemeTab(ctx, d, C){
  const bgs = d.bgs || [], x = C.x + PAD, w = C.w - PAD*2;
  let y = C.y + 22;
  txt(ctx, '背景主题', x, y, COL.green, 'bold 13px monospace');
  txt(ctx, '切换后主页与战斗背景同步生效', x+72, y, COL.dim, '12px monospace');
  y += 18;
  bgs.forEach((th, i) => {
    const own = !!(d.owned && d.owned.bgs && d.owned.bgs[i]);
    const on = i === d.bgIdx;
    UI.drawNeonPanel(ctx, x, y, w, 62, '', on ? COL.green : own ? COL.idle : COL.lock);
    ctx.save(); ctx.globalAlpha = own ? 1 : 0.4;
    ctx.fillStyle = th.bg; ctx.fillRect(x+14, y+15, 32, 32);
    ctx.fillStyle = th.stars[2]; ctx.fillRect(x+22, y+23, 16, 16);
    ctx.restore();
    txt(ctx, th.name, x+58, y+27, on ? '#a5ffb8' : own ? COL.txt : '#c9a227', own ? 'bold 13px monospace' : '13px monospace');
    txt(ctx, on ? '使用中' : own ? '点击选用' : '◈ ' + ((d.bgPrice && d.bgPrice[i]) || 0) + ' 解锁',
      x+58, y+48, on ? COL.green : own ? COL.dim : '#c9a227', '12px monospace');
    hit(x, y, w, 62, ()=>call('pickBg', i), true);
    y += 72;
  });
  return y;
}

// 强化：金币余额 + 看广告领金币 + 永久升级项
function drawShop(ctx, d, C){
  const x = C.x + PAD, w = C.w - PAD*2;
  let y = C.y + 18;
  UI.drawNeonPanel(ctx, x, y, w, 62, '', COL.gold);
  txt(ctx, '金币余额', x+14, y+22, COL.dim, '12px monospace');
  ctx.save(); ctx.shadowColor = COL.gold; ctx.shadowBlur = 10;
  txt(ctx, '◈ ' + (d.coins || 0), x+14, y+48, COL.gold, 'bold 24px monospace');
  ctx.restore();
  const ad = { x:x+w-122, y:y+14, w:108, h:34 };
  UI.drawNeonPanel(ctx, ad.x, ad.y, ad.w, ad.h, '', COL.gold);
  txt(ctx, '看广告 +' + (d.reward || 50), ad.x+ad.w/2, ad.y+22, '#fff3b0', 'bold 13px monospace', 'center');
  hit(ad.x, ad.y, ad.w, ad.h, ()=>call('ad'), true);
  y += 76;
  txt(ctx, '永久强化', x, y+10, COL.gold, 'bold 13px monospace');
  y += 26;
  for (const id of ['drop', 'power']) {
    const def = d.upsDef && d.upsDef[id];
    if (!def) continue;
    const lv = (d.ups && d.ups[id]) || 0, maxed = lv >= def.max, cost = def.cost(lv);
    const meta = UPGRADE_META[id] || { n:id, d:'' };
    UI.drawNeonPanel(ctx, x, y, w, 84, '', maxed ? COL.green : COL.gold);
    txt(ctx, meta.n, x+14, y+26, maxed ? COL.green : COL.txt, 'bold 15px monospace');
    txt(ctx, meta.d + ' · 每级 +' + Math.round((def.val(1) - def.val(0))*100) + '%', x+14, y+46, COL.dim, '12px monospace');
    for (let i = 0; i < def.max; i++) { // 等级点阵
      ctx.fillStyle = i < lv ? (maxed ? COL.green : COL.gold) : 'rgba(255,255,255,0.15)';
      ctx.fillRect(x+14+i*16, y+56, 12, 8);
    }
    txt(ctx, maxed ? '已满级' : 'Lv' + lv + ' → ' + (lv+1), x+14, y+76, maxed ? COL.green : COL.dim, '12px monospace');
    const bb = { x:x+w-104, y:y+44, w:90, h:32 };
    UI.drawNeonPanel(ctx, bb.x, bb.y, bb.w, bb.h, '', maxed ? COL.green : COL.gold);
    txt(ctx, maxed ? '满级' : '◈ ' + cost, bb.x+bb.w/2, bb.y+21, maxed ? '#0b1a0f' : '#0f1206', 'bold 13px monospace', 'center');
    hit(bb.x, bb.y, bb.w, bb.h, ()=>call('buy', id), true);
    y += 96;
  }
  ctx.fillStyle = 'rgba(230,240,255,0.75)'; ctx.font = '12px monospace';
  return wrap(ctx, '强化永久生效并保存在本机；金币通过看广告与对局结算获得。', x, y+10, w, 18);
}

// 声音：音效 / 音乐独立开关
function drawSound(ctx, d, C){
  const x = C.x + PAD, w = C.w - PAD*2;
  let y = C.y + 22;
  txt(ctx, '声音设置', x, y, COL.pink, 'bold 13px monospace');
  y += 20;
  y = drawToggle(ctx, { x:x, y:y, w:w, h:64 }, '音效', '按钮、射击与爆炸反馈', !!d.sfxOn, COL.cyan, ()=>call('sfx'));
  y = drawToggle(ctx, { x:x, y:y, w:w, h:64 }, '背景音乐', '战斗 BGM（CDN 加载）', !!d.bgmOn, COL.green, ()=>call('bgm'));
  ctx.fillStyle = COL.dim; ctx.font = '12px monospace';
  return wrap(ctx, '两项都关 = 全局静音。主页顶部的喇叭按钮可一键切换，设置立即生效并记住。', x, y+6, w, 18);
}

function drawToggle(ctx, b, title, desc, on, color, fn){
  UI.drawNeonPanel(ctx, b.x, b.y, b.w, b.h, '', on ? color : COL.idle);
  txt(ctx, title, b.x+14, b.y+27, on ? '#eaffff' : COL.dim, 'bold 14px monospace');
  txt(ctx, desc, b.x+14, b.y+48, COL.dim, '12px monospace');
  const sw = { x:b.x+b.w-66, y:b.y+18, w:52, h:28 };
  ctx.fillStyle = on ? 'rgba(0,243,255,0.18)' : 'rgba(255,255,255,0.08)';
  UI.roundedRect(ctx, sw.x, sw.y, sw.w, sw.h, 14); ctx.fill();
  ctx.strokeStyle = on ? color : '#4a5568'; ctx.lineWidth = 1.5;
  UI.roundedRect(ctx, sw.x, sw.y, sw.w, sw.h, 14); ctx.stroke();
  ctx.fillStyle = on ? color : '#6b7686';
  ctx.beginPath(); ctx.arc(on ? sw.x+sw.w-14 : sw.x+14, sw.y+sw.h/2, 10, 0, 7); ctx.fill();
  txt(ctx, on ? '开' : '关', on ? sw.x+14 : sw.x+sw.w-14, sw.y+19, on ? '#06202a' : '#1b2233', 'bold 12px monospace', 'center');
  hit(b.x, b.y, b.w, b.h, fn, true);
  return b.y + b.h + 14;
}

// 关于：版本与存档信息（预留菜单位，后续可接客服 / 隐私 / 成就等）
function drawAbout(ctx, d, C){
  const x = C.x + PAD, w = C.w - PAD*2;
  let y = C.y + 30;
  ctx.save(); ctx.shadowColor = COL.cyan; ctx.shadowBlur = 18;
  txt(ctx, '怒雷风暴', C.x+C.w/2, y, '#9feaff', 'bold 26px monospace', 'center');
  ctx.restore();
  txt(ctx, '版本 v' + (d.version || '0.0.0'), C.x+C.w/2, y+22, COL.dim, '12px monospace', 'center');
  y += 54;
  const rows = [
    ['最高分', String(d.hi || 0)],
    ['金币', String(d.coins || 0)],
    ['战机解锁', count(d.owned && d.owned.ships) + '/' + ((d.ships || []).length || 0)],
    ['背景解锁', count(d.owned && d.owned.bgs) + '/' + ((d.bgs || []).length || 0)],
  ];
  for (const r of rows) {
    UI.drawNeonPanel(ctx, x, y, w, 38, '', COL.idle);
    txt(ctx, r[0], x+14, y+25, COL.dim, '12px monospace');
    txt(ctx, r[1], x+w-14, y+25, COL.txt, 'bold 14px monospace', 'right');
    y += 46;
  }
  ctx.fillStyle = 'rgba(230,240,255,0.75)'; ctx.font = '12px monospace';
  y = wrap(ctx, '存档保存在本机（微信本地存储），换设备不互通；破纪录时排行榜得分自动上报。', x, y+14, w, 18);
  return wrap(ctx, '本作含激励视频广告（玩家主动触发）：看广告可复活、翻倍金币、领取金币，广告不影响战斗数值。', x, y+8, w, 18);
}
function count(arr){
  if (!arr || !arr.length) return 0;
  let n = 0; for (const v of arr) if (v) n++;
  return n;
}

// 操作反馈浮条（金币不足 / 解锁成功 / 广告不可用等）
function drawTip(ctx){
  if (!tip || Date.now() >= tipUntil) return;
  const C = L.content, w = C.w - 40, x = C.x + (C.w - w)/2, y = C.y + C.h - 44;
  ctx.save(); ctx.globalAlpha = Math.min(1, (tipUntil - Date.now())/350);
  ctx.fillStyle = 'rgba(8,14,28,0.92)'; ctx.strokeStyle = COL.gold; ctx.lineWidth = 1.5;
  UI.roundedRect(ctx, x, y, w, 30, 6); ctx.fill(); ctx.stroke();
  txt(ctx, tip, x+w/2, y+20, COL.gold, 'bold 13px monospace', 'center');
  ctx.restore();
}

// 菜单图标：全部程序化绘制，避免不同机型字形差异（与主页喇叭/齿轮图标同一思路）
function drawIcon(ctx, kind, x, y, color){
  ctx.save(); ctx.translate(x, y);
  ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = 2;
  if (kind === 'play') { // 摇杆
    ctx.beginPath(); ctx.arc(0, 4, 7, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(0, -9); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -11, 3, 0, 7); ctx.fill();
  } else if (kind === 'ship') { // 机体
    ctx.beginPath(); ctx.moveTo(0,-11); ctx.lineTo(4,2); ctx.lineTo(11,8); ctx.lineTo(0,5);
    ctx.lineTo(-11,8); ctx.lineTo(-4,2); ctx.closePath(); ctx.fill();
  } else if (kind === 'theme') { // 色环
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.fill();
  } else if (kind === 'up') { // 上升箭头
    ctx.beginPath(); ctx.moveTo(0,-11); ctx.lineTo(8,-1); ctx.lineTo(3,-1); ctx.lineTo(3,11);
    ctx.lineTo(-3,11); ctx.lineTo(-3,-1); ctx.lineTo(-8,-1); ctx.closePath(); ctx.fill();
  } else if (kind === 'snd') { // 喇叭
    ctx.beginPath(); ctx.moveTo(-10,-4); ctx.lineTo(-4,-4); ctx.lineTo(3,-11); ctx.lineTo(3,11);
    ctx.lineTo(-4,4); ctx.lineTo(-10,4); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(5, 0, 7, -0.9, 0.9); ctx.stroke();
  } else { // info
    ctx.beginPath(); ctx.arc(0, 0, 10, 0, 7); ctx.stroke();
    ctx.fillRect(-1.5, -7, 3, 7); ctx.fillRect(-1.5, 2, 3, 3);
  }
  ctx.restore();
}

module.exports = { setup, open, draw, onDown, onMove, onUp, toast, get tab(){ return tab; } };
