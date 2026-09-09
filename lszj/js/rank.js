// rank.js - 排行榜模块：好友榜（开放数据域 sharedCanvas）+ 世界榜（nulei-server）
// 好友榜：子域沙箱渲染，无网络/无触摸，触摸由主域 postMessage 中转（通信单向）。
// 世界榜：wx.request 直连 nulei-server，token 为服务端 HMAC 签发，过期静默重登一次。
"use strict";
const UI = require('./ui.js');

// 线上地址（nginx 将 /nulei/ 反代到 nulei-server）。联调本地服务时临时改为 http://127.0.0.1:12700/nulei/api
const API = 'https://game.lliyuu520.cn/nulei/api';

const KV_KEY = 'nulei_hi'; // 好友榜云 KV key，与本地最高分同义
const PAGE = 7;            // 每页行数（好友榜 sharedCanvas 按此高度渲染）
const PANEL = { x: 26, y: 144, w: 428, h: 512 };
const SUB_W = 760, SUB_H = 616; // sharedCanvas 尺寸（内容区 380×308 的 2 倍）
const COL = { cyan: '#00f3ff', pink: '#ff0055', gold: '#ffe600', dim: '#8892a8', txt: '#e6eeff' };

let sx = 1, sy = 1, onClose = null;
let tab = 'friend'; // friend | world
let worldPage = 0, friendPage = 0;
let world = null;       // {list, me, total}
let worldErr = '';
let loading = false;
let me = null;          // {name, best, custom, rank}
let meLocalHi = 0;      // 好友榜页展示用的本地最高分
let token = '';
let loginBusy = false;
let pendingLogin = [];
let lastReported = 0;
let ODC = null;
try { ODC = wx.getOpenDataContext(); } catch (e) { ODC = null; }

const CLOSE = { x: PANEL.x + PANEL.w - 96, y: PANEL.y + 10, w: 88, h: 34 };
const TABS = [
  { key: 'friend', t: '好友榜', x: PANEL.x + 16, y: PANEL.y + 52, w: 190, h: 38 },
  { key: 'world', t: '世界榜', x: PANEL.x + 222, y: PANEL.y + 52, w: 190, h: 38 },
];
const RENAME = { x: PANEL.x + PANEL.w - 84, y: PANEL.y + 98, w: 68, h: 28 };
const FOOT_L = { x: PANEL.x + 16, y: PANEL.y + 460, w: 56, h: 34 };
const FOOT_R = { x: PANEL.x + PANEL.w - 72, y: PANEL.y + 460, w: 56, h: 34 };
const CONTENT = { x: PANEL.x + 24, y: PANEL.y + 140, w: PANEL.w - 48, h: PAGE * 44 };

// 面板整块按底部遮挡区（刘海屏手势条）上移，子控件与内容区同步平移，
// 保证绘制位置与点击判定一致（每次 draw 前重排）
let insetFn = () => 0;
function layout(bottomInset, gameH) {
  const y = Math.min(PANEL.y, gameH - PANEL.h - (bottomInset || 0) - 12);
  const dy = y - PANEL.y;
  if (!dy) return;
  PANEL.y = y;
  for (const b of [CLOSE, RENAME, FOOT_L, FOOT_R, CONTENT, ...TABS]) b.y += dy;
}

const inRect = (t, b) => t.x >= b.x && t.x <= b.x + b.w && t.y >= b.y && t.y <= b.y + b.h;
const hitRect = (t, b) => {
  const px = Math.max(0, (44 - b.w) / 2), py = Math.max(0, (44 - b.h) / 2);
  return t.x >= b.x - px && t.x <= b.x + b.w + px && t.y >= b.y - py && t.y <= b.y + b.h + py;
};
const rankColor = r => r === 1 ? COL.gold : r === 2 ? '#c8d3ff' : r === 3 ? '#ffaa66' : COL.dim;

function setup(o) {
  if (!o) return;
  sx = o.sx || 1; sy = o.sy || 1;
  onClose = o.onClose || null;
  if (typeof o.bottomInset === 'function') insetFn = o.bottomInset;
}

// ---------- HTTP ----------

function http(method, path, data, header, cb) {
  wx.request({
    url: API + path, method: method, data: data || undefined, header: header || {}, timeout: 8000, dataType: 'json',
    success: res => cb(res.statusCode, res.data),
    fail: () => cb(0, null),
  });
}

function flushLogin(ok) { const q = pendingLogin; pendingLogin = []; for (const f of q) f(ok); }

function ensureLogin(cb) {
  if (token) { cb(true); return; }
  pendingLogin.push(cb);
  if (loginBusy) return;
  loginBusy = true;
  wx.login({
    success: r => http('POST', '/login', { code: r.code }, null, (st, res) => {
      loginBusy = false;
      if (st === 200 && res && res.token) {
        token = res.token;
        me = { name: res.name, best: res.best || 0, custom: !!res.custom };
        flushLogin(true);
      } else flushLogin(false);
    }),
    fail: () => { loginBusy = false; flushLogin(false); },
  });
}

// 带 401 重登重试的鉴权请求（仅重试一次）
function authed(method, path, data, cb, retried) {
  ensureLogin(ok => {
    if (!ok) { cb(0, null); return; }
    http(method, path, data, { Authorization: 'Bearer ' + token }, (st, res) => {
      if (st === 401 && !retried) { token = ''; authed(method, path, data, cb, true); return; }
      cb(st, res);
    });
  });
}

// ---------- 对外：上报（gameOver 破纪录时调用，失败静默） ----------

function report(score, duration) {
  if (!(score > 0) || score <= lastReported) return;
  authed('POST', '/score', { score: score, duration: Math.max(1, Math.round(duration || 1)) }, (st, res) => {
    if (st === 200 && res) { lastReported = score; if (me) me.best = res.best; }
  });
}

// ---------- 面板打开 / 数据加载 ----------

function open(t0, localHi) {
  tab = t0 === 'world' ? 'world' : 'friend';
  worldPage = 0; friendPage = 0;
  meLocalHi = localHi || 0;
  if (tab === 'world') loadWorld(); else postRender();
}

function postRender() {
  if (!ODC) return;
  try { ODC.postMessage({ type: 'render', page: friendPage }); } catch (e) {}
}

function loadWorld() {
  loading = true; worldErr = '';
  authed('GET', '/rank?limit=100', null, (st, res) => {
    loading = false;
    if (st === 200 && res) {
      world = res; worldPage = 0;
      if (res.me) me = { name: res.me.name, best: res.me.score, custom: !!res.me.custom, rank: res.me.rank };
    } else {
      world = null;
      worldErr = st === 0 ? '网络异常 · 点击重试' : '服务暂不可用 · 点击重试';
    }
  });
}

function rename(nick) {
  authed('POST', '/nickname', { nickname: nick }, (st, res) => {
    if (st === 200 && res && me) { me.name = res.name; me.custom = true; }
  });
}

function switchTab(key) {
  if (tab === key) return;
  tab = key; worldPage = 0; friendPage = 0;
  if (tab === 'world') loadWorld(); else postRender();
}

// ---------- 触摸（返回 true 表示已消费，主域不再处理） ----------

function onTouch(t) {
  if (hitRect(t, CLOSE)) { if (onClose) onClose(); return true; }
  for (const tb of TABS) { if (hitRect(t, tb)) { switchTab(tb.key); return true; } }
  if (tab === 'friend') {
    if (hitRect(t, FOOT_L)) { friendPage = Math.max(0, friendPage - 1); postRender(); return true; }
    if (hitRect(t, FOOT_R)) { friendPage++; postRender(); return true; }
  } else {
    const maxPage = world ? Math.max(0, Math.ceil(world.list.length / PAGE) - 1) : 0;
    if (hitRect(t, FOOT_L)) { worldPage = Math.max(0, worldPage - 1); return true; }
    if (hitRect(t, FOOT_R)) { worldPage = Math.min(maxPage, worldPage + 1); return true; }
    if (me && hitRect(t, RENAME)) {
      wx.showModal({
        title: '修改昵称', editable: true, placeholderText: '最多 12 个字符',
        success: r => { if (r.confirm && r.content) rename(r.content); },
      });
      return true;
    }
    if (!world && worldErr && inRect(t, CONTENT)) { loadWorld(); return true; } // 失败重试
  }
  return inRect(t, PANEL); // 面板内空白消费触摸，只有遮罩区域关闭
}

// ---------- 绘制 ----------

function chip(ctx, b, color, txt, txtColor) {
  UI.drawNeonPanel(ctx, b.x, b.y, b.w, b.h, '', color);
  if (txt) {
    ctx.fillStyle = txtColor || color;
    ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
    ctx.fillText(txt, b.x + b.w / 2, b.y + b.h / 2 + 5);
  }
}

function centerText(ctx, lines) {
  ctx.textAlign = 'center';
  lines.forEach((s, i) => {
    ctx.fillStyle = i === 0 ? COL.dim : 'rgba(156,163,175,0.6)';
    ctx.font = (i === 0 ? 'bold 15px' : '14px') + ' monospace';
    ctx.fillText(s, CONTENT.x + CONTENT.w / 2, CONTENT.y + 130 + i * 24);
  });
}

function drawWorldRows(ctx) {
  if (loading && !world) { centerText(ctx, ['加载中...']); return; }
  if (!world) { centerText(ctx, [worldErr || '暂无数据']); return; }
  const rows = world.list.slice(worldPage * PAGE, worldPage * PAGE + PAGE);
  if (!rows.length) { centerText(ctx, ['还没有人上榜', '玩一局抢占第一名']); return; }
  rows.forEach((r, i) => {
    const y = CONTENT.y + i * 44;
    if (me && me.rank && r.rank === me.rank) {
      ctx.fillStyle = 'rgba(0,243,255,0.10)'; ctx.fillRect(CONTENT.x, y, CONTENT.w, 42);
    }
    ctx.fillStyle = rankColor(r.rank); ctx.font = 'bold 15px monospace'; ctx.textAlign = 'left';
    ctx.fillText('#' + r.rank, CONTENT.x + 8, y + 27);
    ctx.fillStyle = r.rank === (me && me.rank) ? COL.cyan : COL.txt; ctx.font = '14px monospace';
    ctx.fillText(r.name, CONTENT.x + 56, y + 27);
    ctx.fillStyle = '#7dff8c'; ctx.textAlign = 'right';
    ctx.fillText(String(r.score), CONTENT.x + CONTENT.w - 10, y + 27);
    if (i < rows.length - 1) {
      ctx.strokeStyle = 'rgba(0,243,255,0.10)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(CONTENT.x, y + 42.5); ctx.lineTo(CONTENT.x + CONTENT.w, y + 42.5); ctx.stroke();
    }
  });
}

function drawFriendRows(ctx) {
  if (!ODC || !ODC.canvas || ODC.canvas.width < 2) { centerText(ctx, ['当前基础库不支持好友榜']); return; }
  // 子域把内容画在画布中央的 SUB_W:SUB_H 比例矩形（见 openDataContext/index.js contentRect），
  // 真机 sharedCanvas 尺寸/比例不可控 —— 这里裁剪画布中央同比例区域拉伸铺满 CONTENT，
  // 内容比例恒等于 CONTENT，任意画布尺寸下不变形、字号恒定
  const c = ODC.canvas;
  const ratio = 760 / 616;
  let sw = c.width, sh = c.height;
  if (sw / sh > ratio) { sw = sh * ratio; } else { sh = sw / ratio; }
  ctx.drawImage(c, (c.width - sw) / 2, (c.height - sh) / 2, sw, sh, CONTENT.x, CONTENT.y, CONTENT.w, CONTENT.h);
}

function draw(ctx, W, H) {
  layout(insetFn(), H); // 先按底部遮挡区重排，再绘制
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  ctx.fillStyle = 'rgba(2,4,10,0.72)'; ctx.fillRect(0, 0, W, H);
  const glow = tab === 'friend' ? COL.cyan : COL.pink;
  UI.drawNeonPanel(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, '排行榜', glow);
  chip(ctx, CLOSE, '#ff0055', '✕ 返回', '#ff7a95');
  for (const tb of TABS) chip(ctx, tb, tab === tb.key ? glow : '#3a4356', tb.t, tab === tb.key ? '#fff' : COL.dim);

  // 我的记录条
  ctx.textAlign = 'left'; ctx.font = '14px monospace';
  if (tab === 'world') {
    if (me) {
      ctx.fillStyle = me.custom ? COL.cyan : COL.dim;
      ctx.fillText(me.name + (me.rank ? ' · 第' + me.rank + '名' : ''), PANEL.x + 16, PANEL.y + 116);
      ctx.fillStyle = COL.gold; ctx.textAlign = 'right';
      ctx.fillText(String(me.best || 0), RENAME.x - 12, PANEL.y + 116);
      chip(ctx, RENAME, '#3a4356', '改名', '#9feaff');
    } else {
      ctx.fillStyle = COL.dim; ctx.fillText(loading ? '连接服务中...' : '服务未连接', PANEL.x + 16, PANEL.y + 116);
    }
  } else {
    ctx.fillStyle = COL.dim;
    ctx.fillText('我的最高分 ' + meLocalHi + ' · 破纪录自动同步好友榜', PANEL.x + 16, PANEL.y + 116);
  }

  if (tab === 'friend') drawFriendRows(ctx); else drawWorldRows(ctx);

  // 翻页
  if (tab === 'world' && world) {
    const maxPage = Math.max(0, Math.ceil(world.list.length / PAGE) - 1);
    ctx.fillStyle = COL.dim; ctx.font = '14px monospace'; ctx.textAlign = 'center';
    ctx.fillText('第 ' + (worldPage + 1) + '/' + (maxPage + 1) + ' 页', PANEL.x + PANEL.w / 2, FOOT_L.y + 23);
  }
  chip(ctx, FOOT_L, '#3a4356', '◀', '#9feaff');
  chip(ctx, FOOT_R, '#3a4356', '▶', '#9feaff');
}

module.exports = { setup, open, draw, onTouch, report, SUB_W, SUB_H };
