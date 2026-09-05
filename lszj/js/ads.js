// ads.js - 广告变现模块：激励视频（复活 / 结算金币翻倍 / 领金币）
// ponytail: adUnitId 为占位值，流量主开通后改 USE_FAKE=false 并替换为 MP 后台真实广告位 ID；
//           天花板：无广告预加载策略，后续如需提升曝光再做广告缓存管理。
// 常驻 Banner 已按产品决策移除（底部广告位损伤体验，2026-09-06），仅保留玩家主动触发的激励视频
"use strict";
const UI = require('./ui.js');
// USE_FAKE=true：全内置模拟广告，交互对齐真广告（全屏倒计时、右上角可跳过、看完才发奖），
// 供流量主开通前联调玩法闭环；切 false 走真实广告组件
const USE_FAKE = true;
const FAKE_AD_SEC = 5;    // 模拟激励视频时长（秒），真机为 15~30s，联调取短值
const REWARDED_AD_UNIT = 'adunit-placeholder-rewarded'; // 激励视频广告位（复活）

let rv = null;
let gameH = 800, gameW = 480;
let fakeAd = null;      // 假激励视频会话 {cb, end}；非 null 即播放中

function setup(o) {
  gameH = o.gameH; gameW = o.gameW || 480;
  if (USE_FAKE) return;
  try {
    rv = wx.createRewardedVideoAd({ adUnitId: REWARDED_AD_UNIT });
  } catch (e) { rv = null; }
}

// 播放激励视频。cb(true)=完整观看可发奖 / cb(false)=中途放弃 / cb(null)=广告不可用
function playRewarded(cb) {
  if (USE_FAKE) {
    if (fakeAd) { cb(null); return; } // 真广告同时只能播一个；上层有 reviving 守卫，此处兜底
    fakeAd = { cb, end: Date.now() + FAKE_AD_SEC * 1000 };
    return;
  }
  if (!rv) { cb(null); return; }
  let done = false;
  const settle = ok => {
    if (done) return;
    done = true;
    try { rv.offClose(onClose); } catch (e) {}
    cb(ok);
  };
  const onClose = res => settle(!!(res && res.isEnded));
  try { rv.onClose(onClose); } catch (e) {}
  rv.show().catch(() => {
    // 首次 show 失败通常是素材未拉取到，load 后重试一次
    rv.load().then(() => rv.show()).catch(() => settle(false));
  });
}

// ---- 假激励视频绘制与交互（USE_FAKE 专用；ctx 由 main.draw 在游戏坐标变换下传入） ----
const skipRect = () => ({ x: gameW - 100, y: 16, w: 86, h: 34 });
function finishFake(ok) { const cb = fakeAd.cb; fakeAd = null; cb(ok); }

// 展示期间吞掉所有触点：命中跳过按中途放弃结束，其余点击不透传给游戏。返回是否已消费
function onTouchStart(t) {
  if (!fakeAd) return false;
  if (Date.now() >= fakeAd.end) { finishFake(true); return true; } // 到时未结算的极小窗口按看完处理
  const s = skipRect();
  if (t.x >= s.x && t.x <= s.x + s.w && t.y >= s.y && t.y <= s.y + s.h) finishFake(false);
  return true;
}

function draw(ctx) {
  if (!fakeAd) return;
  if (Date.now() >= fakeAd.end) { finishFake(true); return; } // 倒计时走完 = 完整观看，自动发奖
  const remain = Math.ceil((fakeAd.end - Date.now()) / 1000);
  const s = skipRect();
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.92)';
  ctx.fillRect(0, 0, gameW, gameH);
  const pw = 320, ph = 210, px = (gameW - pw) / 2, py = gameH * 0.32 - ph / 2;
  UI.drawNeonPanel(ctx, px, py, pw, ph, 'AD · 模拟广告', '#00f3ff');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e6f7ff'; ctx.font = 'bold 20px monospace';
  ctx.fillText('广告播放中', gameW / 2, py + 74);
  ctx.fillStyle = '#00f3ff'; ctx.font = 'bold 44px monospace';
  ctx.fillText(String(remain), gameW / 2, py + 128);
  ctx.fillStyle = '#8fa8c8'; ctx.font = '12px monospace';
  ctx.fillText('观看完毕自动发放奖励', gameW / 2, py + 164);
  UI.drawNeonPanel(ctx, s.x, s.y, s.w, s.h, '', '#ff0055');
  ctx.fillStyle = '#ff7a95'; ctx.font = 'bold 13px monospace';
  ctx.fillText('跳过 ✕', s.x + s.w / 2, s.y + s.h / 2 + 1);
  ctx.restore();
}

module.exports = { setup, playRewarded, onTouchStart, draw };
