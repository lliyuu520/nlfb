// ui.js - 高性能 UI 绘制辅助库
const UI = {
  // 绘制圆角矩形
  roundedRect(ctx, x, y, w, h, r, fill, stroke) {
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
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  },
  
  // 绘制高科技感状态栏
  drawGlassPanel(ctx, x, y, w, h, title = '') {
    ctx.fillStyle = 'rgba(20, 20, 40, 0.7)';
    ctx.strokeStyle = '#5df0ff';
    ctx.lineWidth = 1;
    this.roundedRect(ctx, x, y, w, h, 8, true, true);
    if (title) {
      ctx.fillStyle = '#5df0ff';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(title, x + 10, y + 16);
    }
  }
};
module.exports = UI;
