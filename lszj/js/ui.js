// ui.js - 怒雷风暴高能霓虹科技风 UI 组件库
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
      ctx.font = 'bold 11px monospace';
      ctx.fillText(title, x + 10, y + 15);
    }
    ctx.restore();
  },

  // 绘制高能炸弹圆盘按钮
  drawBombButton(ctx, x, y, r, count, active) {
    ctx.save();
    const glow = active ? '#ff0055' : '#555';
    ctx.shadowColor = glow;
    ctx.shadowBlur = active ? 16 : 4;

    // 外发光环
    ctx.fillStyle = 'rgba(20, 10, 20, 0.9)';
    ctx.strokeStyle = glow;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 内部充能环
    ctx.strokeStyle = 'rgba(255, 0, 85, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r - 5, 0, Math.PI * 2);
    ctx.stroke();

    // 文字
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BOMB', x, y - 7);

    ctx.fillStyle = '#ffe600';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(`x${count}`, x, y + 10);
    ctx.restore();
  },

  // 绘制炫酷 Boss 血条
  drawBossBar(ctx, w, h, hp, maxhp) {
    const barW = w - 80;
    const barH = 14;
    const bx = 40;
    const by = h - 55;

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

    // 渐变血量填充
    const ratio = Math.max(0, hp / maxhp);
    if (ratio > 0) {
      const grad = ctx.createLinearGradient(bx, by, bx + barW, by);
      grad.addColorStop(0, '#ff0055');
      grad.addColorStop(0.5, '#ff7700');
      grad.addColorStop(1, '#ffe600');
      ctx.fillStyle = grad;
      this.roundedRect(ctx, bx + 2, by + 2, (barW - 4) * ratio, barH - 4, 3);
      ctx.fill();
    }

    // 告警文字
    ctx.fillStyle = '#ff3366';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('⚡ WARNING: CORE TARGET ⚡', w / 2, by - 6);
    ctx.restore();
  }
};
module.exports = UI;
