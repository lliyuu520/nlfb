// sfx.js - 音频播放器：包内 SFX（InnerAudioContext 语音池轮转）+ BGM 循环（OSS CDN，失败静默）
// SFX 素材由 tools/make_sfx.py 合成（22050Hz wav，共约 273KB，随包分发即点即播）；
// BGM 为 tools/make_bgm.py 手写芯片曲 70.4s 无缝循环，OSS 地址（不占包体）。
"use strict";

// ---------- 全局开关（设置页页眉开关控制，持久化到本地存储，默认开） ----------
let sfxOn = wx.getStorageSync('nulei_sfx') !== 'off';
let bgmOn = wx.getStorageSync('nulei_bgm') !== 'off';
function toggleSfx(){
  sfxOn = !sfxOn;
  try { wx.setStorageSync('nulei_sfx', sfxOn ? 'on' : 'off'); } catch (e) {}
  return sfxOn;
}
function toggleBgm(){
  bgmOn = !bgmOn;
  try { wx.setStorageSync('nulei_bgm', bgmOn ? 'on' : 'off'); } catch (e) {}
  // 关：暂停保留进度；开：若正处于战斗（bgmWant）立即续播
  if (!bgmOn) { if (bgm) { try { bgm.pause(); } catch (e) {} } }
  else if (bgm && bgmWant) { try { bgm.play(); } catch (e) {} }
  return bgmOn;
}
// 主界面全局总开关：双开=有声；任一为关时点按即全开，双开时点按即全静音
// （设置页的细分开关优先级不变：总开关只是把它们一起扳）
function toggleAll(){
  const on = !(sfxOn && bgmOn);
  sfxOn = bgmOn = on;
  try {
    wx.setStorageSync('nulei_sfx', on ? 'on' : 'off');
    wx.setStorageSync('nulei_bgm', on ? 'on' : 'off');
  } catch (e) {}
  if (!on) { if (bgm) { try { bgm.pause(); } catch (e) {} } }
  else if (bgm && bgmWant) { try { bgm.play(); } catch (e) {} }
  return on;
}

// 每个音效的语音池大小：连发/连环爆会同一瞬间叠播，轮转池保证不掐断正在播的
const POOL = { shoot: 4, boom: 3, boss_boom: 2, click: 2, pickup: 2, upgrade: 1, coin: 2, alarm: 1, clear: 1, over: 1, death: 1 };
const VOL = { shoot: 0.5, boom: 0.8, boss_boom: 0.9, click: 0.6, pickup: 0.8, upgrade: 0.8, coin: 0.8, alarm: 0.7, clear: 0.8, over: 0.8, death: 0.9 };

const pools = {}; // name -> { voices: [ctx...], next: 轮转下标 }
function poolOf(name){
  let p = pools[name];
  if (p) return p;
  p = pools[name] = { voices: [], next: 0 };
  const n = POOL[name] || 1;
  for (let i = 0; i < n; i++) {
    try {
      const a = wx.createInnerAudioContext();
      a.src = 'assets/audio/' + name + '.wav';
      a.volume = VOL[name] || 0.8;
      a.obeyMuteSwitch = false; // 音效属于操作反馈，静音键下保留（BGM 仍尊重静音键）
      a.onError(() => {});      // 加载失败静默：不影响游戏
      p.voices.push(a);
    } catch (e) { break; }
  }
  return p;
}

// 播放一个音效；高频连发音效（shoot）限流：池满即跳过本次而不是排队
function play(name, vol){
  if (!sfxOn) return;
  const p = poolOf(name);
  if (!p.voices.length) return;
  const a = p.voices[p.next];
  p.next = (p.next + 1) % p.voices.length;
  try {
    if (vol !== undefined) a.volume = vol;
    a.stop();      // 复用语音：掐掉尾巴立刻重触发（街机连发音正确行为）
    a.seek && a.seek(0);
    a.play();
  } catch (e) {}
}

// ---------- BGM：CDN mp3 循环 ----------
const BGM_URL = 'https://oss.lliyuu520.cn/audio/bgm.mp3';
let bgm = null, bgmWant = false;
function bgmEnsure(){
  if (bgm) return;
  try {
    bgm = wx.createInnerAudioContext();
    bgm.src = BGM_URL;
    bgm.loop = true;
    bgm.volume = 0.38;
    bgm.onError(() => { bgm = null; }); // CDN 拉不到就静默放弃，下次进关重试
  } catch (e) { bgm = null; }
}
function bgmStart(){ bgmWant = true; if (!bgmOn) return; bgmEnsure(); if (bgm) { try { bgm.play(); } catch (e) {} } }
function bgmStop(){ bgmWant = false; if (bgm) { try { bgm.stop(); } catch (e) {} } }
function bgmPause(){ if (bgm && bgmWant) { try { bgm.pause(); } catch (e) {} } }
function bgmResume(){ if (bgm && bgmWant) { try { bgm.play(); } catch (e) {} } }

module.exports = { play, bgmStart, bgmStop, bgmPause, bgmResume,
  get sfxOn(){ return sfxOn; }, get bgmOn(){ return bgmOn; }, toggleSfx, toggleBgm, toggleAll };
