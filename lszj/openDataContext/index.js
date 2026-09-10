// 开放数据域（子域）入口：好友榜渲染。
// 沙箱限制：无网络、无本地存储、无触摸事件；只响应主域 postMessage（单向通信），
// 画面输出到 sharedCanvas，由主域 drawImage 合成。
// 注意：真机上 sharedCanvas 尺寸可能不等于设置的 760×616（系统按窗口/物理尺寸分配），
// 因此布局全部按 cv 实际宽高动态计算，主域按实际宽高比 contain 合成，两侧都不依赖固定值。
const cv = wx.getSharedCanvas();
const ctx = cv.getContext('2d');
const SUB_W = 760, SUB_H = 616; // 期望尺寸（开发者工具下生效）；真机以 cv 实际值为准
const ROWS = 7;
const KV_KEY = 'nulei_hi';
// 军武航空仪表色板：主域 js/theme.js 的本地镜像（沙箱不能跨域 require，保持同步即可）
const TC = {
  bg: '#090B11', text: '#ECE6D7', textDim: '#98A0AA', stroke: '#384351',
  amber: '#D5892D', okHi: '#9CC27B', steel: '#A9B6C6', bronze: '#C98D5F',
};
const MF = 'monospace', UF = 'sans-serif'; // 数字/分数 monospace，中文名 sans-serif

// 2× 超采样请求：好友榜文字是主域 drawImage 缩放合成的，子域画布分辨率越高合成越锐利。
// 真机 sharedCanvas 尺寸由系统分配、可能忽略赋值（下方 contentRect 的 k 按实际宽高兜底），
// 赋值生效的环境（开发者工具等）按 2× 起画布，字号随 k 等比放大，视觉尺寸不变、清晰度翻倍
cv.width = SUB_W * 2;
cv.height = SUB_H * 2;

let list = [];
let page = 0;

const maxPage = () => Math.max(0, Math.ceil(list.length / ROWS) - 1);
const clampPage = p => Math.max(0, Math.min(maxPage(), p));

wx.onMessage(m => {
  if (!m) return;
  if (m.type === 'render') { page = clampPage(m.page || 0); load(); }
  else if (m.type === 'page') { page = clampPage(page + (m.delta || 0)); draw(); }
});

function load() {
  if (typeof wx.getFriendCloudStorage !== 'function') { drawMsg(['当前环境不支持好友数据']); return; }
  wx.getFriendCloudStorage({
    keyList: [KV_KEY],
    success: res => {
      const rows = [];
      for (const u of (res.data || [])) {
        let score = 0;
        for (const kv of (u.KVDataList || [])) {
          if (kv.key === KV_KEY) score = +(kv.value || 0) || 0;
        }
        if (score > 0) rows.push({ name: u.nickname || '玩家', score: score });
      }
      rows.sort((a, b) => b.score - a.score);
      list = rows;
      page = clampPage(page);
      draw();
    },
    fail: () => { list = []; drawMsg(['暂时拿不到好友数据', '稍后再来试试']); },
  });
}

const rankColor = r => r === 1 ? TC.amber : r === 2 ? TC.steel : r === 3 ? TC.bronze : TC.textDim;

// 内容区：真机画布尺寸/比例不可控，统一把内容绘制在画布中央的 SUB_W:SUB_H 比例矩形内，
// 主域按同一比例九参 drawImage 裁剪合成 —— 任何画布尺寸下字号与布局恒定不变形
function contentRect() {
  const W = cv.width, H = cv.height, ratio = SUB_W / SUB_H;
  let w = W, h = W / ratio;
  if (h > H) { h = H; w = H * ratio; }
  return { x: (W - w) / 2, y: (H - h) / 2, w: w, h: h, k: w / SUB_W };
}

function drawMsg(lines) {
  const R = contentRect(), k = R.k;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = 'rgba(9,11,17,0.35)';
  ctx.fillRect(R.x, R.y, R.w, R.h);
  ctx.textAlign = 'center';
  lines.forEach((s, i) => {
    ctx.fillStyle = i === 0 ? TC.textDim : 'rgba(152,160,170,0.6)';
    ctx.font = 'bold ' + Math.round((i === 0 ? 30 : 26) * k) + 'px ' + UF;
    ctx.fillText(s, R.x + R.w / 2, R.y + R.h / 2 - 20 * k + i * 48 * k);
  });
}

function draw() {
  const R = contentRect(), k = R.k;
  const rowH = R.h / ROWS;
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!list.length) { drawMsg(['还没有好友成绩', '分享给好友，比比谁飞得更远']); return; }
  ctx.fillStyle = 'rgba(9,11,17,0.35)';
  ctx.fillRect(R.x, R.y, R.w, R.h);
  const rows = list.slice(page * ROWS, page * ROWS + ROWS);
  rows.forEach((r, i) => {
    const y = R.y + i * rowH;
    ctx.fillStyle = rankColor(page * ROWS + i + 1);
    ctx.font = 'bold ' + Math.round(30 * k) + 'px ' + MF; ctx.textAlign = 'left';
    ctx.fillText('#' + (page * ROWS + i + 1), R.x + 16 * k, y + rowH / 2 + 10 * k);
    ctx.fillStyle = TC.text;
    ctx.font = 'bold ' + Math.round(30 * k) + 'px ' + UF;
    ctx.fillText(r.name, R.x + 112 * k, y + rowH / 2 + 10 * k);
    ctx.fillStyle = TC.okHi;
    ctx.font = 'bold ' + Math.round(30 * k) + 'px ' + MF; ctx.textAlign = 'right';
    ctx.fillText(String(r.score), R.x + R.w - 20 * k, y + rowH / 2 + 10 * k);
    ctx.textAlign = 'left';
    if (i < rows.length - 1) {
      ctx.strokeStyle = 'rgba(56,67,81,0.5)'; ctx.lineWidth = Math.max(1, k);
      ctx.beginPath(); ctx.moveTo(R.x + 12 * k, y + rowH - 1); ctx.lineTo(R.x + R.w - 12 * k, y + rowH - 1); ctx.stroke();
    }
  });
}
