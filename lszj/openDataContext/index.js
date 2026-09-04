// 开放数据域（子域）入口：好友榜渲染。
// 沙箱限制：无网络、无本地存储、无触摸事件；只响应主域 postMessage（单向通信），
// 画面输出到 sharedCanvas，由主域 drawImage 合成。
// 注意：SUB_W/SUB_H/ROWS 必须与主域 js/rank.js 的常量保持一致（760×616 = 380×308 的 2 倍）。
const cv = wx.getSharedCanvas();
const ctx = cv.getContext('2d');
const SUB_W = 760, SUB_H = 616;
const ROWS = 7, ROW_H = 88;
const KV_KEY = 'nulei_hi';

cv.width = SUB_W;
cv.height = SUB_H;

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

const rankColor = r => r === 1 ? '#ffe600' : r === 2 ? '#c8d3ff' : r === 3 ? '#ffaa66' : '#8892a8';

function drawMsg(lines) {
  ctx.fillStyle = 'rgba(2,4,10,0.35)';
  ctx.fillRect(0, 0, SUB_W, SUB_H);
  ctx.textAlign = 'center';
  lines.forEach((s, i) => {
    ctx.fillStyle = i === 0 ? '#8892a8' : 'rgba(156,163,175,0.6)';
    ctx.font = (i === 0 ? 'bold 30px' : '26px') + ' monospace';
    ctx.fillText(s, SUB_W / 2, SUB_H / 2 - 20 + i * 48);
  });
}

function draw() {
  if (!list.length) { drawMsg(['还没有好友成绩', '分享给好友，比比谁飞得更远']); return; }
  ctx.fillStyle = 'rgba(2,4,10,0.35)';
  ctx.fillRect(0, 0, SUB_W, SUB_H);
  const rows = list.slice(page * ROWS, page * ROWS + ROWS);
  rows.forEach((r, i) => {
    const y = i * ROW_H;
    ctx.fillStyle = rankColor(page * ROWS + i + 1);
    ctx.font = 'bold 30px monospace'; ctx.textAlign = 'left';
    ctx.fillText('#' + (page * ROWS + i + 1), 16, y + 56);
    ctx.fillStyle = '#e6eeff'; ctx.font = '28px monospace';
    ctx.fillText(r.name, 112, y + 56);
    ctx.fillStyle = '#7dff8c'; ctx.textAlign = 'right';
    ctx.fillText(String(r.score), SUB_W - 20, y + 56);
    ctx.textAlign = 'left';
    if (i < rows.length - 1) {
      ctx.strokeStyle = 'rgba(0,243,255,0.10)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(12, y + ROW_H - 1); ctx.lineTo(SUB_W - 12, y + ROW_H - 1); ctx.stroke();
    }
  });
}
