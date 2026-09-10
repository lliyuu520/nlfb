// ui.js - 怒雷风暴军武航空仪表风 UI 组件库（深空战机任务控制界面）
// 风格契约：枪灰实底、细钢灰描边、不对称装甲切角、短刻度/角标、警戒斜纹；
// 禁止玻璃拟态、扫描线、大面积 halo 和 shadowBlur。
const T = require('./theme.js');
let _bossGrad = null; // Boss 装甲条渐变缓存（横轴渐变，创建一次复用，避免每帧重建对象）
const UI = {
  T, // 主题 token 透出，调用方不必重复 require

  // 绘制圆角矩形（历史保留：设置页开关等少量控件仍在用）
  roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  },

  // '#rrggbb' → 'rgba(r,g,b,a)'；配色以常量为主，缓存后每帧零解析
  _rgbaCache: {},
  rgba(hex, a) {
    const key = hex + a;
    let s = this._rgbaCache[key];
    if (s) return s;
    const n = parseInt(hex.slice(1), 16);
    s = 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    this._rgbaCache[key] = s;
    return s;
  },

  // 45° 硬边切角矩形路径（装甲切角的基础形；调用签名保持不变）
  chamferPath(ctx, x, y, w, h, c) {
    ctx.beginPath();
    ctx.moveTo(x + c, y);
    ctx.lineTo(x + w - c, y); ctx.lineTo(x + w, y + c);
    ctx.lineTo(x + w, y + h - c); ctx.lineTo(x + w - c, y + h);
    ctx.lineTo(x + c, y + h); ctx.lineTo(x, y + h - c);
    ctx.lineTo(x, y + c);
    ctx.closePath();
  },

  // 不对称装甲切角路径：右上深切、左下浅切（航空蒙皮的非对称感）
  asymChamferPath(ctx, x, y, w, h, c1, c2) {
    ctx.beginPath();
    ctx.moveTo(x + c2, y);
    ctx.lineTo(x + w - c1, y); ctx.lineTo(x + w, y + c1);
    ctx.lineTo(x + w, y + h - c2); ctx.lineTo(x + w - c2, y + h);
    ctx.lineTo(x + c1, y + h); ctx.lineTo(x, y + h - c1);
    ctx.lineTo(x, y + c2);
    ctx.closePath();
  },

  // 军武仪表面板：o={c 描边色, fill 底色, cut 切角, halo 兼容参数(忽略), lw 描边宽,
  //   ticks 四角角标(默认开), asym 不对称切角, inner 内圈细分隔线}
  // 枪灰实底 + 细钢灰描边 + 角部短刻度；halo 参数保留只为不碰业务调用链，一律不发光
  drawChamferPanel(ctx, x, y, w, h, o) {
    const c = o.c || T.strokeHi;
    const cut = o.cut != null ? o.cut : Math.min(8, Math.min(w, h) * 0.16);
    ctx.save();
    if (o.asym) this.asymChamferPath(ctx, x, y, w, h, cut, Math.max(2, cut * 0.5));
    else this.chamferPath(ctx, x, y, w, h, cut);
    ctx.fillStyle = o.fill || T.panel;
    ctx.fill();
    ctx.lineWidth = o.lw || 1.5;
    ctx.strokeStyle = c;
    ctx.stroke();
    if (o.inner !== false && w > 56 && h > 30) {
      // 内圈 1px 细分隔线：仪表盘的双层边框工艺
      ctx.strokeStyle = this.rgba(T.stroke, 0.55);
      ctx.lineWidth = 1;
      const i = 3;
      if (o.asym) this.asymChamferPath(ctx, x + i, y + i, w - i * 2, h - i * 2, Math.max(1, cut - i), Math.max(1, cut * 0.5 - i));
      else this.chamferPath(ctx, x + i, y + i, w - i * 2, h - i * 2, Math.max(1, cut - i));
      ctx.stroke();
    }
    if (o.ticks !== false) {
      // 四角短角标：左上/右下成对，密度低不抢信息
      const t = Math.min(10, w * 0.05);
      ctx.strokeStyle = this.rgba(T.strokeHi, 0.6);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + cut + 2, y + 3); ctx.lineTo(x + cut + 2 + t, y + 3);
      ctx.moveTo(x + cut + 2, y + 3); ctx.lineTo(x + cut + 2, y + 3 + t * 0.6);
      ctx.moveTo(x + w - cut - 2 - t, y + h - 3); ctx.lineTo(x + w - cut - 2, y + h - 3);
      ctx.moveTo(x + w - cut - 2, y + h - 3 - t * 0.6); ctx.lineTo(x + w - cut - 2, y + h - 3);
      ctx.stroke();
    }
    ctx.restore();
  },

  // 旧调用名保留兼容；统一落到军武仪表面板（实底、无 halo、钢灰描边）
  drawNeonPanel(ctx, x, y, w, h, title = '', glowColor = T.strokeHi) {
    this.drawChamferPanel(ctx, x, y, w, h, {
      c: glowColor,
      fill: T.panel,
      cut: Math.min(8, Math.min(w, h) * 0.16),
      lw: 1.5
    });
    if (title) {
      ctx.save();
      ctx.fillStyle = glowColor;
      ctx.font = 'bold 12px ' + T.fontData;
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(title, x + 10, y + 15);
      ctx.restore();
    }
  },

  // 仪表功能键：装甲切角按钮底 + 琥珀状态灯（左上一格），供标题页入口等使用
  // o={x,y,w,h, on 状态灯亮灭, label 右侧文字, labelColor}
  instButton(ctx, o) {
    this.drawChamferPanel(ctx, o.x, o.y, o.w, o.h, {
      c: o.on === false ? T.stroke : T.strokeHi,
      fill: T.panel2, cut: 6, lw: 1.5, ticks: false
    });
    ctx.save();
    ctx.fillStyle = o.on === false ? T.textFaint : T.amber;
    ctx.fillRect(o.x + 7, o.y + 7, 5, 5); // 状态灯
    if (o.label) {
      ctx.fillStyle = o.labelColor || T.text;
      ctx.font = 'bold 14px ' + T.fontUI;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(o.label, o.x + o.w - 38, o.y + o.h / 2 + 1);
    }
    ctx.restore();
  },

  // 分区标题：编号条 + 标题文字 + 右侧细刻度线（补给站/报告面板分节用）
  sectionTitle(ctx, x, y, w, text, color) {
    const c = color || T.amber;
    ctx.save();
    ctx.fillStyle = c;
    ctx.fillRect(x, y - 7, 4, 10); // 编号条
    ctx.font = 'bold 11px ' + T.fontUI;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = this.rgba(c, 0.85);
    ctx.fillText(text, x + 10, y + 2);
    const tw = 10 + ctx.measureText(text).width + 8;
    ctx.strokeStyle = this.rgba(T.stroke, 0.8);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + tw, y - 2); ctx.lineTo(x + w, y - 2); ctx.stroke();
    // 线端三格短刻度
    ctx.beginPath();
    for (let i = 0; i < 3; i++) { ctx.moveTo(x + w - 4 - i * 6, y - 5); ctx.lineTo(x + w - 4 - i * 6, y + 1); }
    ctx.stroke();
    ctx.restore();
  },

  // 警戒斜纹带（航空警示条）：o={x,y,w,h, color, bg}，一次绘制静态条纹，无动画开销
  hazardStrip(ctx, x, y, w, h, color) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = this.rgba(color || T.amber, 0.16);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = this.rgba(color || T.amber, 0.55);
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let sx0 = x - h; sx0 < x + w; sx0 += 12) {
      ctx.moveTo(sx0, y + h); ctx.lineTo(sx0 + h, y);
    }
    ctx.stroke();
    ctx.restore();
  },

  // 状态条：装甲槽式量表（细刻度 + 钢灰框），o={x,y,w,h, ratio, color, label, labelColor}
  gauge(ctx, o) {
    ctx.save();
    this.chamferPath(ctx, o.x, o.y, o.w, o.h, Math.min(3, o.h / 2));
    ctx.fillStyle = T.panelDeep;
    ctx.fill();
    ctx.strokeStyle = T.stroke; ctx.lineWidth = 1;
    ctx.stroke();
    const r = Math.max(0, Math.min(1, o.ratio));
    if (r > 0) {
      ctx.fillStyle = o.color || T.amber;
      const fw = (o.w - 4) * r;
      this.chamferPath(ctx, o.x + 2, o.y + 2, fw, o.h - 4, Math.min(2, fw / 2));
      ctx.fill();
    }
    // 顶部短刻度（每 1/4 一格）
    ctx.strokeStyle = this.rgba(T.strokeHi, 0.4);
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const tx = o.x + (o.w * i) / 4;
      ctx.moveTo(tx, o.y - 3); ctx.lineTo(tx, o.y - 1);
    }
    ctx.stroke();
    if (o.label) {
      ctx.fillStyle = o.labelColor || T.textDim;
      ctx.font = 'bold 11px ' + T.fontData;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(o.label, o.x + o.w / 2, o.y - 7);
    }
    ctx.restore();
  },

  // Boss 装甲完整度仪表：细钢灰描边装甲槽，血量为装甲完整度，底部让开手势条
  drawBossBar(ctx, w, h, hp, maxhp, bottomInset) {
    const inset = bottomInset || 0;
    const barW = w - 80;
    const barH = 14;
    const bx = 40;
    const by = h - inset - 55;
    const ratio = Math.max(0, Math.min(1, hp / maxhp));

    ctx.save();
    // 目标标签（航空瞄准语义）
    ctx.fillStyle = ratio > 0.35 ? T.amber : T.dangerHi;
    ctx.font = 'bold 12px ' + T.fontData;
    ctx.textAlign = 'center';
    ctx.fillText('目标装甲完整度 ' + Math.round(ratio * 100) + '%', w / 2, by - 7);
    // 标签两端短瞄准线
    ctx.strokeStyle = this.rgba(T.strokeHi, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx, by - 11); ctx.lineTo(bx + 46, by - 11);
    ctx.moveTo(bx + barW - 46, by - 11); ctx.lineTo(bx + barW, by - 11);
    ctx.stroke();

    this.drawChamferPanel(ctx, bx, by, barW, barH, {
      c: T.strokeHi, fill: T.panelDeep, cut: 3, lw: 1.5, ticks: false, inner: false
    });

    if (ratio > 0) {
      if (!_bossGrad) {
        _bossGrad = ctx.createLinearGradient(bx, by, bx + barW, by);
        _bossGrad.addColorStop(0, T.danger);
        _bossGrad.addColorStop(0.5, T.amber);
        _bossGrad.addColorStop(1, T.warn);
      }
      ctx.fillStyle = _bossGrad;
      const fillW = (barW - 4) * ratio;
      this.chamferPath(ctx, bx + 2, by + 2, fillW, barH - 4, Math.min(2, fillW / 2));
      ctx.fill();
    }
    // 装甲段刻度（每 1/10 一短格，压在槽内）
    ctx.strokeStyle = this.rgba(T.bg, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 10; i++) {
      const tx = bx + (barW * i) / 10;
      ctx.moveTo(tx, by + 3); ctx.lineTo(tx, by + barH - 3);
    }
    ctx.stroke();
    ctx.restore();
  }
};
module.exports = UI;
