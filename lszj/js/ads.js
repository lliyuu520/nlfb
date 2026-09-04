// ads.js - 广告变现模块：激励视频（复活）+ 底部 Banner
// ponytail: adUnitId 为占位值，流量主开通后替换为 MP 后台真实广告位 ID；
//           天花板：无广告预加载/多坑位策略，后续如需提升曝光再做广告缓存管理。
"use strict";
const REWARDED_AD_UNIT = 'adunit-placeholder-rewarded'; // 激励视频广告位（复活）
const BANNER_AD_UNIT = 'adunit-placeholder-banner';     // Banner 广告位

let rv = null, banner = null;
let winW = 375, winH = 667, gameH = 800;
let bannerGameH = 0; // Banner 换算到游戏坐标下的高度，主逻辑据此抬高炸弹按钮/玩家边界

function setup(o) {
  winW = o.winW; winH = o.winH; gameH = o.gameH;
  try {
    rv = wx.createRewardedVideoAd({ adUnitId: REWARDED_AD_UNIT });
  } catch (e) { rv = null; }
  try {
    banner = wx.createBannerAd({
      adUnitId: BANNER_AD_UNIT,
      style: { left: 0, top: 0, width: winW },
    });
    banner.onError(() => { banner._fail = true; });
    banner.onSizeChange(res => {
      if (!banner) return;
      banner.style.left = (winW - res.realWidth) / 2;
      banner.style.top = winH - res.realHeight;
      bannerGameH = Math.ceil(res.realHeight * gameH / winH);
    });
  } catch (e) { banner = null; }
}

function bannerH() { return banner ? bannerGameH : 0; }

function showBanner() {
  if (!banner || banner._fail) return;
  banner.show().catch(() => { banner._fail = true; });
}
function hideBanner() { if (banner) banner.hide(); }

// 播放激励视频。cb(true)=完整观看可发奖 / cb(false)=中途放弃 / cb(null)=广告不可用
function playRewarded(cb) {
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

module.exports = { setup, bannerH, showBanner, hideBanner, playRewarded };
