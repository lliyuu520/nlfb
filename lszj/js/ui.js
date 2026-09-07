// ui.js - 怒雷风暴高能霓虹科技风 UI 组件库
let _bossGrad = null; // Boss 血条渐变缓存（横轴渐变，创建一次复用，避免每帧重建对象）
const UI = {
  // 绘制圆角矩形
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

  // 45° 硬边切角矩形路径（构图 B 的基础形，比圆角更贴「硬边几何」）
  chamferPath(ctx, x, y, w, h, c) {
    ctx.beginPath();
    ctx.moveTo(x + c, y);
    ctx.lineTo(x + w - c, y); ctx.lineTo(x + w, y + c);
    ctx.lineTo(x + w, y + h - c); ctx.lineTo(x + w - c, y + h);
    ctx.lineTo(x + c, y + h); ctx.lineTo(x, y + h - c);
    ctx.lineTo(x, y + c);
    ctx.closePath();
  },

  // 切角霓虹面板：o={c 描边色, fill 底色, cut 切角, halo 发光强度(0=不发光), lw 描边宽, ticks 四角角标}
  // 外圈宽描边低透明度 + 内圈窄描边实色来模拟霓虹外发光，刻意不用 shadowBlur（真机软光栅掉帧）
  drawChamferPanel(ctx, x, y, w, h, o) {
    const c = o.c || '#00f3ff';
    const cut = o.cut != null ? o.cut : Math.min(8, Math.min(w, h) * 0.16);
    ctx.save();
    this.chamferPath(ctx, x, y, w, h, cut);
    ctx.fillStyle = o.fill || 'rgba(10,14,30,0.92)';
    ctx.fill();
    if (o.halo && c.charAt(0) === '#') {
      ctx.lineWidth = o.halo;
      ctx.strokeStyle = this.rgba(c, o.haloA || 0.18);
      ctx.stroke();
    }
    ctx.lineWidth = o.lw || 1.5;
    ctx.strokeStyle = c;
    ctx.stroke();
    if (o.ticks !== false) {
      const t = Math.min(12, w * 0.06);
      ctx.strokeStyle = 'rgba(255,255,255,0.34)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + cut + 2, y + 3); ctx.lineTo(x + cut + 2 + t, y + 3);
      ctx.moveTo(x + w - cut - 2 - t, y + 3); ctx.lineTo(x + w - cut - 2, y + 3);
      ctx.moveTo(x + cut + 2, y + h - 3); ctx.lineTo(x + cut + 2 + t, y + h - 3);
      ctx.moveTo(x + w - cut - 2 - t, y + h - 3); ctx.lineTo(x + w - cut - 2, y + h - 3);
      ctx.stroke();
    }
    ctx.restore();
  },

  // 绘制全息玻璃发光面板
  drawNeonPanel(ctx, x, y, w, h, title = '', glowColor = '#00f3ff') {
    ctx.save();
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 10;
    ctx.fillStyle = 'rgba(10, 14, 30, 0.85)';
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = 1.5;
    this.roundedRect(ctx, x, y, w, h, 6);
    ctx.fill();
    ctx.stroke();

    // 内部边角装饰线条
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 4); ctx.lineTo(x + 12, y + 4);
    ctx.moveTo(x + w - 12, y + 4); ctx.lineTo(x + w - 4, y + 4);
    ctx.stroke();

    if (title) {
      ctx.fillStyle = glowColor;
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; // 固定对齐：调用方常处于 textAlign='center'，泄漏会把标题画到框外
      ctx.fillText(title, x + 10, y + 15);
    }
    ctx.restore();
  },

  // 绘制炫酷 Boss 血条（bottomInset：底部被手势条占据的高度，血条需在其上方）
  drawBossBar(ctx, w, h, hp, maxhp, bottomInset) {
    const inset = bottomInset || 0;
    const barW = w - 80;
    const barH = 14;
    const bx = 40;
    const by = h - inset - 55;

    ctx.save();
    ctx.shadowColor = '#ff0055';
    ctx.shadowBlur = 12;

    // 背景槽
    ctx.fillStyle = 'rgba(20, 5, 10, 0.85)';
    ctx.strokeStyle = '#ff0055';
    ctx.lineWidth = 2;
    this.roundedRect(ctx, bx, by, barW, barH, 4);
    ctx.fill();
    ctx.stroke();

    // 渐变血量填充（渐变对象缓存）
    const ratio = Math.max(0, hp / maxhp);
    if (ratio > 0) {
      if (!_bossGrad) {
        _bossGrad = ctx.createLinearGradient(bx, by, bx + barW, by);
        _bossGrad.addColorStop(0, '#ff0055');
        _bossGrad.addColorStop(0.5, '#ff7700');
        _bossGrad.addColorStop(1, '#ffe600');
      }
      ctx.fillStyle = _bossGrad;
      this.roundedRect(ctx, bx + 2, by + 2, (barW - 4) * ratio, barH - 4, 3);
      ctx.fill();
    }

    // 告警文字
    ctx.fillStyle = '#ff3366';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('⚡ 警告：核心目标 ⚡', w / 2, by - 6);
    ctx.restore();
  }
};
module.exports = UI;
