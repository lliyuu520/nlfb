
// 界面优化：增加打击感（受击闪白）
// 在敌人、Boss 爆炸时调用
// 增加关卡逻辑：增加难度梯度
// ---------- 主循环 ----------
let last=performance.now();
function loop(now){
  const dt=Math.min(0.05,(now-last)/1000);last=now;
  for(const s of stars){s.y+=s.v*dt*(state==='playing'?1:0.3);if(s.y>H){s.y=-2;s.x=Math.random()*W;}}
  
  if(state === 'playing') spawnT = Math.max(0.4, spawnT - dt * 0.02);
  
  update(dt);draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
