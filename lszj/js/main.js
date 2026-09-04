
"use strict";
const UI = require('./ui.js');
const cv=wx.createCanvas(),ctx=cv.getContext('2d');
const W=480,H=800;
// 设计分辨率 480x800 → 实际画布（设备像素）的绘制缩放
const SX=cv.width/W,SY=cv.height/H;
function fit(){}

const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const rnd=(a,b)=>a+Math.random()*(b-a);

// 微信小游戏环境 Audio 模拟（暂用静默或简单提示）
let AC=null;
function audio(){
  // 微信小游戏暂不支持 WebAudioContext，需后续接入 wx.createInnerAudioContext
  console.log("Audio triggered");
}
function tone(f,dur,type,vol,slide){ /* 待实现微信音频播放 */ }
function boom(dur,vol){ /* 待实现微信音频播放 */ }

// ---------- 全局状态 ----------
let state='title',stage=1,score=0,hi=+(wx.getStorageSync('nulei_hi')||0);
let elapsed=0,spawnT=1,boss=null,clearT=0,shake=0,flash=0;
let bullets=[],ebullets=[],enemies=[],items=[],parts=[],eid=0;
const player={x:W/2,y:H-90,r:4,lives:3,bombs:3,inv:2,weapon:'std',wlevel:1,mis:'none',mlevel:0,fireT:0,misT:0};


  // 微信小游戏触摸适配：屏幕逻辑像素 → 游戏坐标(480x800)
let winW=W,winH=H,safeTop=0;
try{
  const si=wx.getSystemInfoSync();
  winW=si.windowWidth;winH=si.windowHeight;
  // 刘海/摄像头与信号状态栏区域高度（逻辑像素），换算为游戏坐标后 HUD 需避开
  const st=si.safeArea?si.safeArea.top:(si.statusBarHeight||0);
  safeTop=Math.round(st*H/winH);
}catch(e){}
const HUD_TOP=safeTop+8; // 顶部 HUD 起始 y
const PLAY_TOP=HUD_TOP+62; // 玩家可移动的最高位置（让开 HUD）
const toGame=t=>({x:t.clientX*W/winW,y:t.clientY*H/winH});
const BOMB_BTN={x:W-50,y:H-50,r:45}; // 与 drawHUD 中的炸弹按钮位置保持一致
let drag=null;
wx.onTouchStart(e => {
  audio();
  const touch = e.touches[0];
  if (!touch) return;
  const t = toGame(touch);
  // 检查是否点击了炸弹按钮（屏幕右下角圆盘）
  if (state === 'playing' && (t.x-BOMB_BTN.x)**2+(t.y-BOMB_BTN.y)**2 < BOMB_BTN.r**2) {
    useBomb(); return;
  }
  if (state !== 'playing') { startGame(); return; }
  drag = { x: t.x, y: t.y, px: player.x, py: player.y };
});
wx.onTouchMove(e => {
  if (!drag || state !== 'playing') return;
  const touch = e.touches[0];
  if (!touch) return;
  const t = toGame(touch);
  player.x = clamp(drag.px + (t.x - drag.x), 12, W - 12);
  player.y = clamp(drag.py + (t.y - drag.y), PLAY_TOP, H - 16);
});
wx.onTouchEnd(() => drag = null);
  

// ---------- 流程 ----------
function startGame(){
  state='playing';stage=1;score=0;elapsed=0;spawnT=1;boss=null;clearT=0;
  bullets=[];ebullets=[];enemies=[];items=[];parts=[];
  Object.assign(player,{x:W/2,y:H-90,lives:3,bombs:3,inv:2,weapon:'std',wlevel:1,mis:'none',mlevel:0,fireT:0,misT:0});
}
function nextStage(){stage++;elapsed=0;spawnT=1;boss=null;ebullets=[];state='playing';}
function gameOver(){state='over';if(score>hi){hi=score;wx.setStorageSync('nulei_hi', hi);}}
function useBomb(){
  if(player.bombs<=0||state!=='playing')return;
  player.bombs--;flash=0.4;shake=14;boom(0.6,0.4);tone(60,0.5,'sawtooth',0.2,-30);
  for(const b of ebullets)spark(b.x,b.y,'#8ff',2);
  ebullets=[];
  for(const e of enemies)e.hp-=25;
  if(boss)boss.hp-=40;
}

// ---------- 生成敌人 ----------
function addEnemy(o){o.id=++eid;o.t=0;o.fireT=rnd(0.5,1.5);enemies.push(o);}
function spawnGrunt(){ // 编队杂兵
  const n=5,x0=rnd(80,W-80);
  for(let i=0;i<n;i++){const off=i-(n-1)/2;
    addEnemy({x:clamp(x0+off*48,20,W-20),y:-24-Math.abs(off)*20,vy:120+stage*12,hp:2,type:'grunt',r:12,score:100});}
}
function spawnWeaver(){
  const x=rnd(60,W-60);addEnemy({x,baseX:x,y:-20,vy:95,hp:4,type:'weaver',r:13,score:200});}
function spawnDiver(){
  addEnemy({x:rnd(30,W-30),y:-20,vy:0,hp:3,type:'diver',r:11,score:250});}
function spawnTurret(){
  addEnemy({x:rnd(40,W-40),y:-30,vy:0,hp:8,type:'turret',r:15,score:300});}
function spawnWave(){
  const roll=Math.random();
  if(roll<0.38)spawnGrunt();
  else if(roll<0.62)spawnWeaver();
  else if(roll<0.84)spawnDiver();
  else spawnTurret();
}
function spawnBoss(){
  const hp=260+stage*140;
  boss={x:W/2,y:-90,hp,maxhp:hp,r:46,t:0,fireT:1.2,aimT:2.4,spiralA:0,spiralT:0.5};
}

// ---------- 射击 ----------
function eShoot(x,y,ang,sp,color){ebullets.push({x,y,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp,r:4,color:color||'#ff5d7a'});}
function shootAimed(x,y,n,sp,spread){
  const a0=Math.atan2(player.y-y,player.x-x);
  for(let i=0;i<n;i++){const a=a0+(i-(n-1)/2)*(spread||0.18);eShoot(x,y,a,sp);}
}
function nearestEnemy(x,y){
  let best=null,bd=1e9;
  for(const e of enemies){if(e.y<0)continue;const d=(e.x-x)**2+(e.y-y)**2;if(d<bd){bd=d;best=e;}}
  if(boss&&boss.y>0){const d=(boss.x-x)**2+(boss.y-y)**2;if(d<bd)best=boss;}
  return best;
}
function firePlayer(){
  const p=player,sp=720;
  if(p.weapon==='laser'){
    bullets.push({x:p.x,y:p.y-16,vx:0,vy:-sp*1.3,sp:sp*1.3,dmg:2+p.wlevel*0.5,pierce:true,hits:new Set(),r:5,color:'#5df0ff',laser:true});
    tone(220,0.08,'sawtooth',0.04,-120);
  }else if(p.weapon==='homing'){
    for(let i=0;i<p.wlevel;i++){const a=-Math.PI/2+rnd(-0.6,0.6);
      bullets.push({x:p.x+rnd(-10,10),y:p.y-10,vx:Math.cos(a)*420,vy:Math.sin(a)*420,sp:420,dmg:1.5,homing:true,r:4,color:'#ff9d3c'});}
    tone(660,0.06,'square',0.04,200);
  }else{
    const lv=p.wlevel,off=lv>=2?6:0,ang=lv>=3?0.16:0;
    bullets.push({x:p.x,y:p.y-16,vx:0,vy:-sp,sp,dmg:1,r:3,color:'#ffe66d'});
    if(lv>=2)bullets.push({x:p.x-off,y:p.y-10,vx:0,vy:-sp,sp,dmg:1,r:3,color:'#ffe66d'});
    if(lv>=3)bullets.push({x:p.x+off,y:p.y-10,vx:0,vy:-sp,sp,dmg:1,r:3,color:'#ffe66d'});
    if(lv>=4){for(const s of[-1,1])bullets.push({x:p.x+s*8,y:p.y-8,vx:s*Math.sin(0.3)*sp,vy:-Math.cos(0.3)*sp,sp,dmg:1,r:3,color:'#ffe66d'});}
    tone(880,0.04,'square',0.03,-200);
  }
}
function fireMissile(){
  const p=player;
  if(p.mis==='homing'){
    for(let i=0;i<p.mlevel+1;i++){const s=i%2?1:-1;
      bullets.push({x:p.x+s*14,y:p.y,vx:s*160,vy:-260,sp:260,dmg:3,homing:true,r:4,color:'#ffd23c',mis:true});}
    tone(440,0.1,'triangle',0.05,300);
  }else if(p.mis==='laser'){
    bullets.push({x:p.x,y:p.y-20,vx:0,vy:-1100,sp:1100,dmg:2+p.mlevel,pierce:true,hits:new Set(),r:6,color:'#c77dff',laser:true});
    tone(180,0.1,'sawtooth',0.05,-80);
  }
}

// ---------- 掉落 ----------
function dropItem(x,y){
  if(Math.random()>0.14)return;
  const roll=Math.random();let it;
  if(roll<0.22)it={color:'#ff4d4d',letter:'R',kind:'w',val:'homing'};
  else if(roll<0.44)it={color:'#4da6ff',letter:'B',kind:'w',val:'laser'};
  else if(roll<0.58)it={color:'#ffd23c',letter:'Y',kind:'m',val:'homing'};
  else if(roll<0.70)it={color:'#c77dff',letter:'P',kind:'m',val:'laser'};
  else if(roll<0.84)it={color:'#ff8c42',letter:'M',kind:'bomb'};
  else it={color:'#7dff8c',letter:'S',kind:'score'};
  items.push({x,y,vy:90,...it});
}
function pickup(it){
  const p=player;
  if(it.kind==='w'){p.weapon=it.val;p.wlevel=Math.min(4,p.wlevel+1);tone(520,0.15,'square',0.08,400);}
  else if(it.kind==='m'){p.mis=it.val;p.mlevel=Math.min(3,p.mlevel+1);tone(520,0.15,'triangle',0.08,400);}
  else if(it.kind==='bomb'){p.bombs=Math.min(5,p.bombs+1);tone(400,0.12,'square',0.07,200);}
  else{score+=500;tone(700,0.1,'sine',0.07,300);}
  spark(it.x,it.y,it.color,8);
}

// ---------- 粒子 ----------
function spark(x,y,color,n){
  for(let i=0;i<n;i++){const a=rnd(0,Math.PI*2),v=rnd(40,260);
    parts.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:rnd(0.2,0.6),t:0,color,r:rnd(1.5,3.5)});}
}
function explode(x,y,big){spark(x,y,'#ffb347',big?26:12);spark(x,y,'#ff5d5d',big?18:8);boom(big?0.4:0.18,big?0.3:0.15);if(big)shake=Math.max(shake,8);}

// ---------- 更新 ----------
function update(dt){
  if(state==='clear'){clearT-=dt;if(clearT<=0)nextStage();return;}
  if(state!=='playing')return;
  elapsed+=dt;flash=Math.max(0,flash-dt);shake=Math.max(0,shake-dt*30);
  const p=player;
  if(p.inv>0)p.inv-=dt;

  // 移动逻辑已完全通过 touch 事件处理，此处移除键盘依赖
  // const sp=380;
  // const mx=(keys.ArrowRight||keys.KeyD?1:0)-(keys.ArrowLeft||keys.KeyA?1:0);
  // const my=(keys.ArrowDown||keys.KeyS?1:0)-(keys.ArrowUp||keys.KeyW?1:0);
  // if(mx||my){p.x=clamp(p.x+mx*sp*dt,12,W-12);p.y=clamp(p.y+my*sp*dt,70,H-16);}

  // 玩家开火
  p.fireT-=dt;if(p.fireT<=0){p.fireT=p.weapon==='laser'?0.11:0.09;firePlayer();}
  if(p.mis!=='none'){p.misT-=dt;if(p.misT<=0){p.misT=0.5;fireMissile();}}

  // 刷怪 / Boss
  if(!boss){
    if(elapsed>65){spawnBoss();}
    else{spawnT-=dt;if(spawnT<=0){spawnT=Math.max(0.55,1.6-elapsed*0.012-stage*0.08);spawnWave();}}
  }

  // 玩家子弹
  for(let i=bullets.length-1;i>=0;i--){const b=bullets[i];
    if(b.homing){const t=nearestEnemy(b.x,b.y);
      if(t){const a=Math.atan2(t.y-b.y,t.x-b.x),ca=Math.atan2(b.vy,b.vx);
        let d=a-ca;while(d>Math.PI)d-=Math.PI*2;while(d<-Math.PI)d+=Math.PI*2;
        const turn=clamp(d,-7*dt,7*dt);b.vx=Math.cos(ca+turn)*b.sp;b.vy=Math.sin(ca+turn)*b.sp;}}
    b.x+=b.vx*dt;b.y+=b.vy*dt;
    if(b.y<-30||b.x<-30||b.x>W+30){bullets.splice(i,1);continue;}
    let hit=null;
    for(const e of enemies){if((b.x-e.x)**2+(b.y-e.y)**2<(b.r+e.r)**2){hit=e;break;}}
    if(!hit&&boss&&(b.x-boss.x)**2+(b.y-boss.y)**2<(b.r+boss.r)**2)hit=boss;
    if(hit){
      if(b.pierce){if(!b.hits.has(hit.id||'boss')){b.hits.add(hit.id||'boss');hit.hp-=b.dmg;hit.flash=0.1;spark(b.x,b.y,b.color,3);}}
      else{hit.hp-=b.dmg;hit.flash=0.1;spark(b.x,b.y,b.color,4);bullets.splice(i,1);}
    }
  }

  // 敌人
  for(let i=enemies.length-1;i>=0;i--){const e=enemies[i];e.t+=dt;
    if(e.type==='grunt'){e.y+=e.vy*dt;e.fireT-=dt;if(e.fireT<=0&&e.y>0&&e.y<H*0.6){e.fireT=2.6;eShoot(e.x,e.y+10,Math.PI/2,170);}}
    else if(e.type==='weaver'){e.y+=e.vy*dt;e.x=e.baseX+Math.sin(e.t*3)*70;}
    else if(e.type==='diver'){if(e.t<0.9)e.y+=70*dt;else{const a=Math.atan2(p.y-e.y,p.x-e.x);e.x+=Math.cos(a)*330*dt;e.y+=Math.sin(a)*330*dt;}}
    else if(e.type==='turret'){if(e.y<130)e.y+=70*dt;else{e.fireT-=dt;if(e.fireT<=0&&e.y>0){e.fireT=1.5;shootAimed(e.x,e.y,3,200,0.25);}}}
    if(e.hp<=0){score+=e.score;explode(e.x,e.y,false);dropItem(e.x,e.y);enemies.splice(i,1);continue;}
    if(e.y>H+40){enemies.splice(i,1);continue;}
    // 撞玩家
    if(p.inv<=0&&(e.x-p.x)**2+(e.y-p.y)**2<(e.r+p.r+6)**2){hurtPlayer();enemies.splice(i,1);}
  }

  // Boss
  // Boss 逻辑补充（之前被误删的逻辑）
  if(boss){
    boss.t += dt;
    if(boss.y < 140) boss.y += 60 * dt;
    else {
      boss.x = W/2 + Math.sin(boss.t * 0.7) * (W/2 - 90);
      const rage = boss.hp < boss.maxhp * 0.5;
      boss.fireT -= dt;
      if(boss.fireT <= 0){ boss.fireT = rage ? 1.0 : 1.4;
        const n = rage ? 12 : 9; for(let i=0; i<n; i++) eShoot(boss.x, boss.y + 20, Math.PI/2 + (i-(n-1)/2)*0.22, 170);
      }
      boss.aimT -= dt;
      if(boss.aimT <= 0){ boss.aimT = rage ? 1.5 : 2.4; shootAimed(boss.x, boss.y + 20, rage ? 5 : 3, 240, 0.16); }
      if(rage){ boss.spiralT -= dt;
        if(boss.spiralT <= 0){ boss.spiralT = 0.08; boss.spiralA += 0.42;
          eShoot(boss.x, boss.y, boss.spiralA, 150, '#ff9d3c'); eShoot(boss.x, boss.y, boss.spiralA + Math.PI, 150, '#ff9d3c'); }
      }
    }
    if(boss.hp <= 0){ score += 5000; explode(boss.x, boss.y, true); explode(boss.x-30, boss.y+20, true); explode(boss.x+30, boss.y-10, true);
      boss = null; ebullets = []; state = 'clear'; clearT = 2.2; flash = 0.5; }
    else if(p.inv <= 0 && boss.y > 0 && (boss.x-p.x)**2+(boss.y-p.y)**2 < (boss.r+p.r)**2) hurtPlayer();
  }

  // 敌弹
  for(let i=ebullets.length-1;i>=0;i--){const b=ebullets[i];b.x+=b.vx*dt;b.y+=b.vy*dt;
    if(b.y<-20||b.y>H+20||b.x<-20||b.x>W+20){ebullets.splice(i,1);continue;}
    if(p.inv<=0&&(b.x-p.x)**2+(b.y-p.y)**2<(b.r+p.r)**2){ebullets.splice(i,1);hurtPlayer();}
  }

  // 道具
  for(let i=items.length-1;i>=0;i--){const it=items[i];it.y+=it.vy*dt;
    if(it.y>H+20){items.splice(i,1);continue;}
    if((it.x-p.x)**2+(it.y-p.y)**2<22**2){pickup(it);items.splice(i,1);}
  }

  // 粒子
  for(let i=parts.length-1;i>=0;i--){const q=parts[i];q.t+=dt;
    if(q.t>=q.life){parts.splice(i,1);continue;}q.x+=q.vx*dt;q.y+=q.vy*dt;q.vx*=0.96;q.vy*=0.96;}
}
function hurtPlayer(){
  const p=player;p.lives--;p.wlevel=Math.max(1,p.wlevel-1);
  explode(p.x,p.y,true);flash=0.25;
  if(p.lives<=0){gameOver();return;}
  p.x=W/2;p.y=H-90;p.inv=2.5;ebullets=ebullets.filter(b=>(b.x-p.x)**2+(b.y-p.y)**2>140**2);
}

// ---------- 绘制 ----------
const stars=[];for(let i=0;i<70;i++)stars.push({x:Math.random()*W,y:Math.random()*H,v:rnd(25,110),s:Math.random()<0.3?2:1});
const sl=document.createElement('canvas');sl.width=4;sl.height=4;
{const c=sl.getContext('2d');c.fillStyle='rgba(0,0,0,0.16)';c.fillRect(0,2,4,2);}
const scan=ctx.createPattern(sl,'repeat');

function drawShip(){
  const p=player;if(p.inv>0&&Math.floor(p.inv*16)%2)return;
  ctx.save();ctx.translate(p.x,p.y);
  ctx.fillStyle='#d8ecff';
  ctx.beginPath();ctx.moveTo(0,-17);ctx.lineTo(5,-3);ctx.lineTo(17,9);ctx.lineTo(7,7);ctx.lineTo(4,13);
  ctx.lineTo(-4,13);ctx.lineTo(-7,7);ctx.lineTo(-17,9);ctx.lineTo(-5,-3);ctx.closePath();ctx.fill();
  ctx.fillStyle='#3f8fd6';ctx.fillRect(-3,-12,6,9);
  ctx.fillStyle='#ffb347';ctx.fillRect(-3,13,6,3+Math.random()*5);
  ctx.fillStyle='#fff';ctx.fillRect(-1,-1,2,2); // 街机式可见判定点
  ctx.restore();
}
function drawEnemy(e){
  ctx.save();ctx.translate(e.x,e.y);
  if(e.flash > 0) e.flash -= 0.05;
  const col = e.flash > 0 ? '#ffffff' : (
    e.type==='grunt'?'#e0555f':e.type==='weaver'?'#b06ae0':e.type==='diver'?'#ff8c42':'#6b7280'
  );
  if(e.type==='grunt'){ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(0,10);ctx.lineTo(-11,-8);ctx.lineTo(0,-3);ctx.lineTo(11,-8);ctx.closePath();ctx.fill();
    ctx.fillStyle='#ffd0d0';ctx.fillRect(-2,-4,4,4);}
  else if(e.type==='weaver'){ctx.fillStyle=col;ctx.beginPath();ctx.ellipse(0,0,13,8,0,0,7);ctx.fill();
    ctx.fillStyle='#f0d0ff';ctx.beginPath();ctx.arc(0,0,4,0,7);ctx.fill();}
  else if(e.type==='diver'){ctx.rotate(Math.atan2(player.y-e.y,player.x-e.x)+Math.PI/2);
    ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(0,12);ctx.lineTo(-9,-9);ctx.lineTo(0,-4);ctx.lineTo(9,-9);ctx.closePath();ctx.fill();}
  else if(e.type==='turret'){ctx.fillStyle=col;ctx.fillRect(-14,-8,28,16);
    ctx.fillStyle='#9ca3af';ctx.fillRect(-4,-14,8,10);ctx.fillStyle='#ff5d5d';ctx.beginPath();ctx.arc(0,0,4,0,7);ctx.fill();}
  ctx.restore();
}
function drawBoss(b){
  ctx.save();ctx.translate(b.x,b.y);
  ctx.fillStyle='#4b5563';ctx.beginPath();ctx.ellipse(0,0,46,26,0,0,7);ctx.fill();
  ctx.fillStyle='#374151';ctx.fillRect(-46,-8,92,20);
  ctx.fillStyle='#1f2937';ctx.beginPath();ctx.arc(-28,4,10,0,7);ctx.arc(28,4,10,0,7);ctx.fill();
  const rage=b.hp<b.maxhp*0.5;
  ctx.fillStyle=rage?'#ff3b3b':'#ffd23c';ctx.beginPath();ctx.arc(0,-6,9,0,7);ctx.fill();
  ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(0,-6,4,0,7);ctx.fill();
  ctx.restore();
}
function drawItem(it){
  ctx.save();ctx.translate(it.x,it.y);
  ctx.fillStyle=it.color;ctx.fillRect(-9,-9,18,18);
  ctx.fillStyle='#0a0a12';ctx.font='bold 12px monospace';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(it.letter,0,1);ctx.restore();
}
function draw(){
  ctx.setTransform(SX,0,0,SY,0,0);
  ctx.fillStyle='#05050c';ctx.fillRect(0,0,W,H);
  if(shake>0)ctx.translate(rnd(-shake,shake)*0.4,rnd(-shake,shake)*0.4);
  // 星空
  ctx.fillStyle='#3b4a6b';
  for(const s of stars){ctx.fillRect(s.x,s.y,s.s,s.s);}
  if(state==='title'){drawTitle();overlay();return;}
  // 实体
  for(const it of items)drawItem(it);
  for(const e of enemies)drawEnemy(e);
  if(boss)drawBoss(boss);
  ctx.save();ctx.shadowBlur=6;
  for(const b of bullets){ctx.shadowColor=b.color;ctx.fillStyle=b.color;
    if(b.laser)ctx.fillRect(b.x-2,b.y-12,4,16);else{ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,7);ctx.fill();}}
  for(const b of ebullets){ctx.shadowColor=b.color;ctx.fillStyle=b.color;ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,7);ctx.fill();}
  ctx.restore();
  for(const q of parts){ctx.globalAlpha=1-q.t/q.life;ctx.fillStyle=q.color;ctx.fillRect(q.x-q.r/2,q.y-q.r/2,q.r,q.r);}
  ctx.globalAlpha=1;
  drawShip();
  drawHUD();
  if(flash>0){ctx.fillStyle=`rgba(255,255,255,${flash})`;ctx.fillRect(-20,-20,W+40,H+40);}
  if(state==='clear'){
    ctx.textAlign='center';
    UI.drawNeonPanel(ctx,W/2-160,H/2-80,320,150,'SECTOR CLEARED','#7dff8c');
    ctx.save();ctx.shadowColor='#7dff8c';ctx.shadowBlur=20;
    ctx.fillStyle='#7dff8c';ctx.font='bold 38px monospace';
    ctx.fillText('STAGE CLEAR',W/2,H/2-15);ctx.restore();
    ctx.fillStyle='#fff';ctx.font='16px monospace';
    ctx.fillText(`第 ${stage} 关通过 · 得分 ${score}`,W/2,H/2+30);}
  if(state==='over'){
    ctx.fillStyle='rgba(0,0,0,0.7)';ctx.fillRect(0,0,W,H);
    ctx.textAlign='center';
    UI.drawNeonPanel(ctx,W/2-160,H/2-110,320,210,'FINAL REPORT','#ff0055');
    ctx.save();ctx.shadowColor='#ff0055';ctx.shadowBlur=25;
    ctx.fillStyle='#ff0055';ctx.font='bold 42px monospace';
    ctx.fillText('GAME OVER',W/2,H/2-45);ctx.restore();
    ctx.fillStyle='#fff';ctx.font='bold 20px monospace';
    ctx.fillText('SCORE  '+String(score).padStart(7,'0'),W/2,H/2+5);
    ctx.fillStyle='#ffe600';ctx.font='14px monospace';
    ctx.fillText('HI-SCORE  '+String(hi).padStart(7,'0'),W/2,H/2+35);
    ctx.fillStyle=Math.floor(performance.now()/400)%2?'#00f3ff':'#666';
    ctx.font='bold 16px monospace';ctx.fillText('▶ 点击屏幕重新开始 ◀',W/2,H/2+72);}
  overlay();
}
function overlay(){ctx.setTransform(SX,0,0,SY,0,0);ctx.fillStyle=scan;ctx.fillRect(0,0,W,H);}
function drawTitle(){
  ctx.textAlign='center';
  ctx.save();
  ctx.shadowColor='#00f3ff'; ctx.shadowBlur=25;
  ctx.fillStyle='#00f3ff'; ctx.font='bold 56px monospace';
  ctx.fillText('怒雷风暴',W/2,220);
  ctx.shadowColor='#ff0055'; ctx.shadowBlur=15;
  ctx.fillStyle='#ff0055'; ctx.font='16px monospace';
  ctx.fillText('NU · THUNDER  //  CYBER ARCADE SHOOTER',W/2,260);
  ctx.restore();

  // 炫酷说明面板
  UI.drawNeonPanel(ctx, 40, 310, W-80, 210, 'MISSION BRIEFING', '#ffe600');
  ctx.fillStyle='#fff'; ctx.font='14px monospace';
  const tips=['[ 拖动屏幕 ] 控制战机移动并自动射击','[ 点击右下角 ] 释放高能全屏炸弹','[ 红 R ] 追踪导弹 · [ 蓝 B ] 穿透激光','[ 道具掉落 ] 拾取升级武器与火力','[ 中心小白点 ] 战机核心判定区'];
  tips.forEach((t,i)=>ctx.fillText(t,W/2,360+i*32));

  ctx.fillStyle=Math.floor(performance.now()/400)%2?'#00f3ff':'#ff0055';
  ctx.font='bold 22px monospace';ctx.fillText('▶ 点击屏幕开始战斗 ◀',W/2,580);

  ctx.fillStyle='#9ca3af';ctx.font='14px monospace';ctx.fillText('HI-SCORE: '+String(hi).padStart(7,'0'),W/2,640);
}
function drawHUD(){
  ctx.setTransform(SX,0,0,SY,0,0);
  
  // 绘制 HUD（整体下移，避开刘海摄像头与信号状态栏区域）
  UI.drawNeonPanel(ctx, 10, HUD_TOP, 140, 50, 'SCORE', '#00f3ff');
  ctx.fillStyle='#fff'; ctx.font='bold 22px monospace';
  ctx.fillText(String(score).padStart(7,'0'), 80, HUD_TOP+35);

  UI.drawNeonPanel(ctx, W-150, HUD_TOP, 140, 50, 'PLAYER', '#00f3ff');
  ctx.fillStyle='#d8ecff'; ctx.font='bold 16px monospace';
  ctx.fillText('❤️  x '+player.lives, W-80, HUD_TOP+35);

  UI.drawNeonPanel(ctx, 10, HUD_TOP+60, 140, 40, 'WEAPON', '#ff0055');
  ctx.fillStyle='#ff0055'; ctx.font='14px monospace';
  ctx.fillText(player.weapon.toUpperCase() + ' Lv.' + player.wlevel, 80, HUD_TOP+90);

  // 高能炸弹圆盘按钮
  UI.drawBombButton(ctx, W-50, H-50, 35, player.bombs, player.bombs > 0);

  if(boss){
    UI.drawBossBar(ctx, W, H, boss.hp, boss.maxhp);
  }
}

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
