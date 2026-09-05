// cdn.js - CDN 素材加载：wx.createImage 拉取阿里云 OSS sprites，未就绪/加载失败时绘制方回退程序化画法
// 素材更新走"覆盖 OSS 文件 + 调 CDN 刷新接口"两条腿：URL 必须保持稳定否则
// CDN 缓存命中率会归零（query string 会被算进缓存键），所以这里不引入版本号参数。
"use strict";
const BASE = 'https://oss.lliyuu520.cn/sprites/';
const cache = {};
function load(name){
  let c = cache[name];
  if (c) return c.img;
  const img = wx.createImage();
  c = cache[name] = { img, ok: false };
  img.onload = () => { c.ok = true; };
  img.onerror = () => {}; // 失败保持 ok=false，绘制方走程序化回退；下次冷启动再拉
  img.src = BASE + encodeURIComponent(name) + '.png';
  return img;
}
function get(name){
  const c = cache[name];
  return (c && c.ok) ? c.img : null;
}
function preload(names){ for (const n of names) load(n); }
module.exports = { load, get, preload };