
"use strict";
const UI = require('./ui.js');
const Ads = require('./ads.js');
const Rank = require('./rank.js');
const cv=wx.createCanvas(),ctx=cv.getContext('2d');
const W=480;
// 设计宽度固定 480，设计高度随设备宽高比自适应（钳制 800~1200），保证 SX=SY 等比缩放；
// 否则圆角面板/文字会被非等比拉伸变形。下限 800 保标题屏布局，上限防极端长屏
let winW=375,winH=667,safeTop=0,H=800;
try{
  const si=wx.getSystemInfoSync();
  if(si.windowWidth>0)winW=si.windowWidth;
  if(si.windowHeight>0)winH=si.windowHeight;
  H=Math.round(Math.min(Math.max(W*winH/winW,800),1200));
  // 刘海/摄像头与信号状态栏区域高度（逻辑像素），换算为游戏坐标后 HUD 需避开
  const st=(si.safeArea&&si.safeArea.top)||si.statusBarHeight||0;
  safeTop=Math.round(st*H/winH);
}catch(e){}
if(!isFinite(H)||H<800)H=800;
if(!isFinite(safeTop)||safeTop<0)safeTop=0;
// 设计分辨率 W×H → 实际画布（设备像素）的绘制缩放；画布尺寸异常时回退 1:1，避免 NaN 变换导致黑屏
const SX=(cv.width&&cv.width>0)?cv.width/W:1,SY=(cv.height&&cv.height>0)?cv.height/H:1;
function fit(){}

const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const rnd=(a,b)=>a+Math.random()*(b-a);

// 音效：wx.createWebAudioContext（基础库 ≥2.19.0）合成振荡器/噪声，无需音频素材；不支持时静默降级
let AC=null;
function audioCtx(){
  if(AC===null){ try{ AC=wx.createWebAudioContext()||false; }catch(e){ AC=false; } }
  return AC||null;
}
function audio(){
  const c=audioCtx();
  if(c&&c.state==='suspended'&&c.resume)c.resume();
}
function tone(f,dur,type,vol,slide){
  const c=audioCtx();if(!c)return;
  try{
    const t0=c.currentTime,o=c.createOscillator(),g=c.createGain();
    o.type=type||'square';o.frequency.setValueAtTime(f,t0);
    if(slide)o.frequency.linearRampToValueAtTime(Math.max(30,f+slide),t0+dur);
    g.gain.setValueAtTime(vol||0.05,t0);
    g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
    o.connect(g);g.connect(c.destination);o.start(t0);o.stop(t0+dur+0.02);
  }catch(e){}
}
function boom(dur,vol){
  const c=audioCtx();if(!c)return;
  try{
    const sr=c.sampleRate||44100,n=Math.max(1,Math.floor(sr*dur));
    const buf=c.createBuffer(1,n,sr),d=buf.getChannelData(0);
    for(let i=0;i<n;i++){const k=1-i/n;d[i]=(Math.random()*2-1)*k*k;}
    const s=c.createBufferSource();s.buffer=buf;
    const g=c.createGain();g.gain.value=vol||0.2;
    s.connect(g);g.connect(c.destination);s.start();
  }catch(e){}
}

// ---------- 全局状态 ----------
let state='title',stage=1,score=0,hi=+(wx.getStorageSync('nulei_hi')||0);
let elapsed=0,runTime=0,spawnT=1,boss=null,clearT=0,shake=0,flash=0,miniSpawned=false,warnT=0,hitStop=0;
const BOSS_AT=65; // 开局后 Boss 出现时间（秒），HUD 倒计时与刷怪逻辑共用
const BOSS_MINI_AT=30; // 小 Boss（精英）出场时间（秒），每关一次
let bullets=[],ebullets=[],enemies=[],items=[],parts=[],shockwaves=[],chainBooms=[],meteors=[],meteorT=4,eid=0;
const player={x:W/2,y:H-90,r:4,lives:3,bombs:3,inv:2,weapon:'std',wlevel:1,mis:'none',mlevel:0,fireT:0,misT:0};


const HUD_TOP=safeTop+8; // 顶部 HUD 起始 y
const PLAY_TOP=HUD_TOP+62; // 玩家可移动的最高位置（让开 HUD）
// 触摸坐标：屏幕逻辑像素 → 游戏坐标（480×H 等比映射，H 已随设备比例自适应）
const toGame=t=>({x:t.clientX*W/winW,y:t.clientY*H/winH});
// 广告模块初始化：Banner 展示在屏幕底部，游戏内底部控件需按其高度上移避让
Ads.setup({winW,winH,gameH:H});
Ads.showBanner();
Rank.setup({sx:SX,sy:SY,onClose:()=>{state='title';}});
const BOMB_R=45;
const bombPos=()=>({x:W-50,y:H-50-Ads.bannerH()}); // 与 drawHUD 中的炸弹按钮位置保持一致
const playBottom=()=>H-16-Ads.bannerH(); // 玩家可移动的最低位置（让开 Banner）

// 复活流程（激励视频）
const MAX_REVIVE=2;
let reviveUsed=0,reviving=false,msg='',msgT=0;
const REVIVE_BTN={x:W/2-150,y:H/2+52,w:145,h:48};
const restartRect=()=>reviveUsed<MAX_REVIVE?{x:W/2+5,y:H/2+52,w:145,h:48}:{x:W/2-72,y:H/2+52,w:144,h:48};
const WPN_ZH={std:'机炮',homing:'追踪',laser:'激光'}; // HUD 武器中文名
// 暂停菜单按钮（双击屏幕呼出）
const PAUSE_BTNS=[
  {x:W/2-100,y:H/2-84,w:200,h:44,c:'#00f3ff',t:'继续游戏'},
  {x:W/2-100,y:H/2-28,w:200,h:44,c:'#ff0055',t:'重新开始'},
  {x:W/2-100,y:H/2+28,w:200,h:44,c:'#ffe600',t:'回到标题'},
];
const inRect=(t,b)=>t.x>=b.x&&t.x<=b.x+b.w&&t.y>=b.y&&t.y<=b.y+b.h;
function toast(s){msg=s;msgT=2.2;}
function requestRevive(){
  if(reviving||reviveUsed>=MAX_REVIVE)return;
  reviving=true;
  Ads.playRewarded(ok=>{
    reviving=false;
    if(ok===true)revive();
    else toast(ok===null?'广告暂不可用，请稍后再试':'需完整观看广告才能复活');
  });
}
function revive(){
  reviveUsed++;state='playing';
  player.lives=1;player.inv=3;player.bombs=Math.max(player.bombs,1);
  ebullets=[];
  for(const e of enemies){if((e.x-player.x)**2+(e.y-player.y)**2<160**2)e.y=-60;}
  tone(520,0.2,'square',0.08,400);
}

// ---------- 金币与升级（看广告领金币；掉率/火力升级预留） ----------
let coins=Number(wx.getStorageSync('nulei_coins'))||0;
// ---------- 主页设置：玩法说明 / 金币与广告 / 更换战机 / 更换背景 ----------
const SHIPS=[ // 机体皮肤：同款外形不同涂装（设置预览与游戏内共用 drawShipShape）
  {name:'怒雷号',body:'#d8ecff',fin:'#3f8fd6',trail:'#ffb347'},
  {name:'赤焰号',body:'#ffe0d6',fin:'#d6533f',trail:'#ff7a45'},
  {name:'幽紫号',body:'#e6d9ff',fin:'#8a5cf0',trail:'#c77dff'},
];
const BGS=[ // 背景主题：底色 + 三层星空配色
  {name:'深空蓝',bg:'#05050c',stars:['#26355a','#3b4a6b','#5d7bb8']},
  {name:'星云紫',bg:'#0b0518',stars:['#3a2a5c','#5a4a8c','#9a7fe8']},
  {name:'翡翠绿',bg:'#03120b',stars:['#1e4a35','#2a6c4c','#5dbb8a']},
];
let shipIdx=wx.getStorageSync('nulei_ship')||0;if(!(shipIdx>=0&&shipIdx<SHIPS.length))shipIdx=0;
let bgIdx=wx.getStorageSync('nulei_bg')||0;if(!(bgIdx>=0&&bgIdx<BGS.length))bgIdx=0;
const saveShip=()=>wx.setStorageSync('nulei_ship',shipIdx);
const saveBg=()=>wx.setStorageSync('nulei_bg',bgIdx);
const TIPS=['[ 拖动屏幕 ] 控制战机移动并自动射击','[ 点击右下角 ] 释放高能全屏炸弹','[ 红 R ] 追踪导弹 · [ 蓝 B ] 穿透激光','[ 道具掉落 ] 拾取升级武器与火力','[ 中心小白点 ] 战机核心判定区','[ 双击屏幕 ] 暂停 / 继续'];
const SET_PANEL={x:26,y:280,w:428,h:448}; // 设置面板（H≥800 恒可见，底部让出 Banner 区）
const SET_BTN={x:W-92,y:HUD_TOP+4,w:80,h:40}; // 主页右上角设置入口
const RANK_BTN={x:20,y:HUD_TOP+4,w:80,h:40}; // 主页左上角排行榜入口（与设置入口镜像）
const SET_CLOSE={x:SET_PANEL.x+SET_PANEL.w-96,y:SET_PANEL.y+10,w:88,h:34};
const SET_COIN_BTN={x:SET_PANEL.x+SET_PANEL.w-196,y:SET_PANEL.y+222,w:180,h:38};
const SET_SHIP_CHIPS=SHIPS.map((s,i)=>({i,x:SET_PANEL.x+16+i*136,y:SET_PANEL.y+300,w:124,h:66}));
const SET_BG_CHIPS=BGS.map((s,i)=>({i,x:SET_PANEL.x+16+i*136,y:SET_PANEL.y+404,w:124,h:34}));
const REWARD_COINS=50; // 每次完整观看激励视频奖励金币
// 升级项预留：数值效果已接入掉率(dropItem)与伤害(update/useBomb)，商店 UI 上线后调 buyUpgrade 即可
const UPGRADES={
  drop:{max:5,cost:l=>120*(l+1),val:l=>1+l*0.25}, // 掉落率：每级 +25%（基础 14% × 倍率）
  power:{max:5,cost:l=>150*(l+1),val:l=>1+l*0.1}, // 火力强度：每级 +10% 伤害
};
let ups=Object.assign({drop:0,power:0},wx.getStorageSync('nulei_up')||{});
let tmsg='',tmsgT=0;
const saveCoins=()=>wx.setStorageSync('nulei_coins',coins);
const saveUps=()=>wx.setStorageSync('nulei_up',ups);
const upVal=id=>ups[id]||0;
function buyUpgrade(id){
  const u=UPGRADES[id];if(!u)return false;
  const l=upVal(id);
  if(l>=u.max)return false;
  const c=u.cost(l);
  if(coins<c)return false;
  coins-=c;ups[id]=l+1;saveUps();
  return true;
}
function requestCoinAd(){
  if(reviving)return;
  reviving=true;
  Ads.playRewarded(ok=>{
    reviving=false;
    if(ok===true){coins+=REWARD_COINS;saveCoins();tmsg='金币 +'+REWARD_COINS;tmsgT=2;tone(700,0.15,'sine',0.08,300);}
    else{tmsg=ok===null?'广告暂不可用，请稍后再试':'需完整观看广告才能获得金币';tmsgT=2;}
  });
}

let drag=null;
// 双击暂停检测：两次"干净点按"（快速按下-抬起且未移动）间隔 <350ms 且位置相近
let tStart=0,tStartX=0,tStartY=0,tMoved=false;
let lastTapT=0,lastTapX=0,lastTapY=0;
wx.onTouchStart(e => {
  audio();
  const touch = e.touches[0];
  if (!touch) return;
  const t = toGame(touch);
  if (state === 'playing') {
    // 炸弹按钮（屏幕右下角圆盘，随 Banner 高度上移）
    const bp=bombPos();
    if ((t.x-bp.x)**2+(t.y-bp.y)**2 < BOMB_R**2) { useBomb(); return; }
    tStart=performance.now();tStartX=t.x;tStartY=t.y;tMoved=false; // 记录触点供双击判定
    drag = { x: t.x, y: t.y, px: player.x, py: player.y };
    return;
  }
  if (state === 'over') {
    if (reviving) return;
    if (reviveUsed<MAX_REVIVE && inRect(t,REVIVE_BTN)) { requestRevive(); return; }
    if (inRect(t,restartRect())) startGame();
    return;
  }
  if (state === 'pause') {
    for (const b of PAUSE_BTNS) {
      if (inRect(t, b)) {
        if (b.t === '继续游戏') state = 'playing';
        else if (b.t === '重新开始') startGame();
        else goTitle();
        return;
      }
    }
    return;
  }
  if (state === 'clear') return; // 过关动画自动推进，忽略点击
  if (reviving) return; // 广告播放中忽略点击
  if (state === 'settings') {
    if (!inRect(t, SET_PANEL) || inRect(t, SET_CLOSE)) { state = 'title'; return; } // 点面板外/返回关闭
    if (inRect(t, SET_COIN_BTN)) { requestCoinAd(); return; } // 看广告领金币
    for (const c of SET_SHIP_CHIPS) { if (inRect(t, c)) { shipIdx = c.i; saveShip(); tone(700, 0.06, 'square', 0.05, 300); return; } }
    for (const c of SET_BG_CHIPS) { if (inRect(t, c)) { bgIdx = c.i; saveBg(); tone(520, 0.06, 'sine', 0.05, 200); return; } }
    return;
  }
  if (state === 'rank') {
    if (!Rank.onTouch(t)) state = 'title'; // 面板内未命中 → 点面板外关闭
    return;
  }
  if (inRect(t, SET_BTN)) { state = 'settings'; return; } // 主页右上角：打开设置
  if (inRect(t, RANK_BTN)) { state = 'rank'; Rank.open('friend', hi); return; } // 主页左上角：打开排行榜
  startGame(); // title
});
wx.onTouchMove(e => {
  if (!drag || state !== 'playing') return;
  const touch = e.touches[0];
  if (!touch) return;
  const t = toGame(touch);
  if(!tMoved&&(t.x-tStartX)**2+(t.y-tStartY)**2>144)tMoved=true; // 移动超 12px 视为拖动，不算点按
  player.x = clamp(drag.px + (t.x - drag.x), 12, W - 12);
  player.y = clamp(drag.py + (t.y - drag.y), PLAY_TOP, playBottom());
});
wx.onTouchEnd(e => {
  const ct = e.changedTouches && e.changedTouches[0];
  if (ct && state === 'playing' && !tMoved) {
    const g = toGame(ct), now = performance.now();
    if (now - tStart < 250) { // 干净的短点按
      if (now - lastTapT < 350 && (g.x-lastTapX)**2+(g.y-lastTapY)**2 < 48*48) {
        state = 'pause'; drag = null; lastTapT = 0; return; // 双击暂停
      }
      lastTapT = now; lastTapX = g.x; lastTapY = g.y;
    } else lastTapT = 0;
  } else lastTapT = 0;
  drag = null;
});
// 切后台/来电时自动暂停（仅 playing 态）；复活广告回调会显式恢复 playing，与自动暂停无冲突
wx.onHide(() => { if (state === 'playing') { state = 'pause'; drag = null; } });
  

// ---------- 流程 ----------
function startGame(){
  state='playing';stage=1;score=0;elapsed=0;runTime=0;spawnT=1;boss=null;clearT=0;miniSpawned=false;
  warnT=0;hitStop=0;shockwaves=[];chainBooms=[];
  bullets=[];ebullets=[];enemies=[];items=[];parts=[];
  reviveUsed=0;reviving=false;msgT=0;
  Object.assign(player,{x:W/2,y:H-90,lives:3,bombs:3,inv:2,weapon:'std',wlevel:1,mis:'none',mlevel:0,fireT:0,misT:0});
}
function nextStage(){stage++;elapsed=0;spawnT=1;boss=null;ebullets=[];miniSpawned=false;warnT=0;hitStop=0;state='playing';}
function goTitle(){state='title';boss=null;warnT=0;hitStop=0;bullets=[];ebullets=[];enemies=[];items=[];parts=[];shockwaves=[];chainBooms=[];drag=null;}
function gameOver(){
  state='over';
  if(score>hi){hi=score;wx.setStorageSync('nulei_hi', hi);
    // 双榜同步：好友榜走微信托管 KV（子域读取），世界榜上报 nulei-server（失败静默）
    try{wx.setUserCloudStorage({KVDataList:[{key:'nulei_hi',value:String(hi)}],fail:()=>{}});}catch(e){}
    Rank.report(hi,runTime);
  }
}
function useBomb(){
  if(player.bombs<=0||state!=='playing')return;
  player.bombs--;flash=0.4;shake=14;boom(0.6,0.4);tone(60,0.5,'sawtooth',0.2,-30);
  const dmgMul=UPGRADES.power.val(upVal('power'));
  for(const b of ebullets)spark(b.x,b.y,'#88ffff',2);
  ebullets=[];
  for(const e of enemies)e.hp-=25*dmgMul;
  if(boss)boss.hp-=40*dmgMul;
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
  warnT=1.6;
  boss={x:W/2,y:-90,hp,maxhp:hp,r:46,t:0,fireT:1.2,aimT:2.4,spiralA:0,spiralT:0.5};
}
function spawnMiniBoss(){ // 关卡中段精英：弱于关底 Boss，击杀不清关
  const hp=70+stage*50;
  warnT=1.6;
  boss={x:W/2,y:-70,hp,maxhp:hp,r:26,t:0,fireT:1.2,aimT:2.0,spiralA:0,spiralT:0.5,mini:true};
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
function dropItem(x,y,force){ // force=true 必掉（小 Boss 掉落用）
  if(!force&&Math.random()>0.14*UPGRADES.drop.val(upVal('drop')))return;
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
const PARTS_MAX=220; // 粒子池上限：满了不再补充，防止低端机越爆越卡
function spark(x,y,color,n){
  n=Math.min(n,PARTS_MAX-parts.length);if(n<=0)return;
  for(let i=0;i<n;i++){const a=rnd(0,Math.PI*2),v=rnd(40,260);
    parts.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:rnd(0.2,0.6),t:0,color,r:rnd(1.5,3.5)});}
}
function explode(x,y,big){
  spark(x,y,'#ffb347',big?26:12);spark(x,y,'#ff5d5d',big?18:8);
  boom(big?0.4:0.18,big?0.3:0.15);if(big)shake=Math.max(shake,8);
  shockwaves.push({x,y,r:4,vr:big?300:170,life:big?0.4:0.28,t:0,color:big?'#ffcf6b':'#ff9a5d'}); // 扩散冲击环
}

// ---------- 更新 ----------
function update(dt){
  if(hitStop>0){hitStop-=dt;return;} // 击杀首领顿帧：游戏世界瞬时冻结，特效时钟照常走
  if(state==='clear'){clearT-=dt;if(clearT<=0)nextStage();return;}
  if(state!=='playing')return;
  elapsed+=dt;runTime+=dt;flash=Math.max(0,flash-dt);shake=Math.max(0,shake-dt*30);
  if(warnT>0)warnT-=dt;
  const p=player;
  const dmgMul=UPGRADES.power.val(upVal('power')); // 火力升级倍率
  if(p.inv>0)p.inv-=dt;
  // 引擎尾焰：低频短命粒子（预留粒子池余量给爆炸）
  if(parts.length<PARTS_MAX-24&&Math.random()<0.8)
    parts.push({x:p.x+rnd(-3,3),y:p.y+15,vx:rnd(-12,12),vy:rnd(90,160),life:rnd(0.12,0.28),t:0,color:'#ffb347',r:2.2});

  // 移动逻辑已完全通过 touch 事件处理，此处移除键盘依赖
  // const sp=380;
  // const mx=(keys.ArrowRight||keys.KeyD?1:0)-(keys.ArrowLeft||keys.KeyA?1:0);
  // const my=(keys.ArrowDown||keys.KeyS?1:0)-(keys.ArrowUp||keys.KeyW?1:0);
  // if(mx||my){p.x=clamp(p.x+mx*sp*dt,12,W-12);p.y=clamp(p.y+my*sp*dt,70,H-16);}

  // 玩家开火
  p.fireT-=dt;if(p.fireT<=0){p.fireT=p.weapon==='laser'?0.11:0.09;firePlayer();}
  if(p.mis!=='none'){p.misT-=dt;if(p.misT<=0){p.misT=0.5;fireMissile();}}

  // 刷怪 / Boss / 小 Boss
  if(!boss){
    if(elapsed>BOSS_AT){spawnBoss();}
    else if(!miniSpawned&&elapsed>BOSS_MINI_AT){miniSpawned=true;spawnMiniBoss();}
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
      if(b.pierce){if(!b.hits.has(hit.id||'boss')){b.hits.add(hit.id||'boss');hit.hp-=b.dmg*dmgMul;hit.flash=0.1;spark(b.x,b.y,b.color,3);}}
      else{hit.hp-=b.dmg*dmgMul;hit.flash=0.1;spark(b.x,b.y,b.color,4);bullets.splice(i,1);}
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
      if(boss.fireT <= 0){ boss.fireT = (rage ? 1.0 : 1.4) + (boss.mini ? 0.5 : 0);
        const n = (rage ? 12 : 9) - (boss.mini ? 4 : 0); for(let i=0; i<n; i++) eShoot(boss.x, boss.y + 20, Math.PI/2 + (i-(n-1)/2)*0.22, 170);
      }
      boss.aimT -= dt;
      if(boss.aimT <= 0){ boss.aimT = (rage ? 1.5 : 2.4) + (boss.mini ? 0.7 : 0); shootAimed(boss.x, boss.y + 20, (rage ? 5 : 3) - (boss.mini ? 1 : 0), 240, 0.16); }
      if(rage && !boss.mini){ boss.spiralT -= dt;
        if(boss.spiralT <= 0){ boss.spiralT = 0.08; boss.spiralA += 0.42;
          eShoot(boss.x, boss.y, boss.spiralA, 150, '#ff9d3c'); eShoot(boss.x, boss.y, boss.spiralA + Math.PI, 150, '#ff9d3c'); }
      }
    }
    if(boss.hp <= 0){
      if(boss.mini){
        score += 1500;
        for(let i=0;i<3;i++)chainBooms.push({x:boss.x+rnd(-30,30),y:boss.y+rnd(-20,20),t:0.1+i*0.14}); // 连环爆：延时依次起爆
        dropItem(boss.x - 18, boss.y, true); dropItem(boss.x + 18, boss.y, true);
        boss = null; ebullets = []; spawnT = 1.2; flash = 0.3; tone(520, 0.3, 'square', 0.08, -300);
      } else {
        score += 5000; hitStop = 0.07; flash = 0.5; // 顿帧 + 连环延时爆点，收尾再来一发大爆
        for(let i=0;i<5;i++)chainBooms.push({x:boss.x+rnd(-42,42),y:boss.y+rnd(-26,26),t:0.05+i*0.16});
        chainBooms.push({x:boss.x,y:boss.y,t:0.95});
        boss = null; ebullets = []; state = 'clear'; clearT = 2.4;
      }
    }
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
// 三层视差星空：远层小而暗慢，近层大而亮快，滚动产生纵深
const stars=[];
for(let i=0;i<80;i++){const l=Math.random();
  stars.push({x:Math.random()*W,y:Math.random()*H,v:25+l*135,s:l<0.5?1:(l<0.85?2:3),l:l<0.5?0:(l<0.85?1:2)});}
// 扫描线纹理：小游戏无 DOM，必须用 wx.createCanvas() 创建离屏画布（document 不存在）
const sl=wx.createCanvas();sl.width=4;sl.height=4;
{const c=sl.getContext('2d');c.fillStyle='rgba(0,0,0,0.16)';c.fillRect(0,2,4,2);}
const scan=ctx.createPattern(sl,'repeat');

// 预渲染光斑精灵：径向渐变离屏画布按颜色缓存，代替逐颗子弹的 shadowBlur
//（真机上 shadowBlur 是软光栅，弹幕一多帧率崩；drawImage 光斑快一个量级且更柔）
const glowCache={};
function glowSprite(color){
  let s=glowCache[color];if(s)return s;
  let r=parseInt(color.slice(1,3),16),g=parseInt(color.slice(3,5),16),b=parseInt(color.slice(5,7),16);
  if(isNaN(r)||isNaN(g)||isNaN(b)){r=136;g=204;b=255;} // 非法色值兜底
  const c=wx.createCanvas();c.width=c.height=32;
  const cx=c.getContext('2d');
  const gr=cx.createRadialGradient(16,16,0,16,16,16);
  gr.addColorStop(0,'rgba(255,255,255,0.95)');
  gr.addColorStop(0.3,`rgba(${r},${g},${b},0.9)`);
  gr.addColorStop(1,`rgba(${r},${g},${b},0)`);
  cx.fillStyle=gr;cx.fillRect(0,0,32,32);
  return glowCache[color]=c;
}

// 机体外形（涂装由 SHIPS 皮肤决定），设置页预览与游戏内共用
function drawShipShape(sk){
  ctx.fillStyle=sk.body;
  ctx.beginPath();ctx.moveTo(0,-17);ctx.lineTo(5,-3);ctx.lineTo(17,9);ctx.lineTo(7,7);ctx.lineTo(4,13);
  ctx.lineTo(-4,13);ctx.lineTo(-7,7);ctx.lineTo(-17,9);ctx.lineTo(-5,-3);ctx.closePath();ctx.fill();
  ctx.fillStyle=sk.fin;ctx.fillRect(-3,-12,6,9);
  ctx.fillStyle=sk.trail;ctx.fillRect(-3,13,6,3+Math.random()*5);
}
function drawShip(){
  const p=player;if(p.inv>0&&Math.floor(p.inv*16)%2)return;
  ctx.save();ctx.translate(p.x,p.y);
  drawShipShape(SHIPS[shipIdx]);
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
  if(b.mini)ctx.scale(0.55,0.55); // 小 Boss 用同款机体缩小绘制
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
  ctx.fillStyle=BGS[bgIdx].bg;ctx.fillRect(0,0,W,H);
  if(shake>0)ctx.translate(rnd(-shake,shake)*0.4,rnd(-shake,shake)*0.4);
  // 星空（三层视差）与流星
  for(const s of stars){ctx.fillStyle=BGS[bgIdx].stars[s.l];ctx.fillRect(s.x,s.y,s.s,s.s);}
  for(const m of meteors){const k=1-m.t/m.life;
    ctx.globalAlpha=k*0.7;ctx.strokeStyle='#8cbeff';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(m.x,m.y);ctx.lineTo(m.x-m.vx*0.05,m.y-m.vy*0.05);ctx.stroke();}
  ctx.globalAlpha=1;
  if(state==='title'||state==='settings'||state==='rank'){drawTitle();if(state==='settings')drawSettings();if(state==='rank')Rank.draw(ctx,W,H);overlay();return;}
  // 实体
  for(const it of items)drawItem(it);
  for(const e of enemies)drawEnemy(e);
  if(boss)drawBoss(boss);
  ctx.save();
  ctx.globalCompositeOperation='lighter'; // 光斑叠加混合，弹幕更亮更通透
  for(const b of bullets){
    if(b.laser){ctx.fillStyle=b.color;ctx.fillRect(b.x-2,b.y-13,4,17);
      ctx.drawImage(glowSprite(b.color),b.x-10,b.y-10,20,20);}
    else{const R=b.r*6,g=glowSprite(b.color);ctx.drawImage(g,b.x-R/2,b.y-R/2,R,R);}
  }
  for(const b of ebullets){const R=b.r*5,g=glowSprite(b.color);ctx.drawImage(g,b.x-R/2,b.y-R/2,R,R);}
  ctx.restore();
  ctx.globalCompositeOperation='lighter';
  for(const q of parts){const k=1-q.t/q.life,s=q.r*4*k; // 光点粒子：随生命收缩淡出
    ctx.globalAlpha=k;ctx.drawImage(glowSprite(q.color),q.x-s/2,q.y-s/2,s,s);}
  for(const w of shockwaves){const k=1-w.t/w.life; // 扩散冲击环
    ctx.globalAlpha=k*0.8;ctx.strokeStyle=w.color;ctx.lineWidth=2+k*3;
    ctx.beginPath();ctx.arc(w.x,w.y,w.r,0,7);ctx.stroke();}
  ctx.globalAlpha=1;
  ctx.globalCompositeOperation='source-over';
  drawShip();
  drawHUD();
  if(state==='playing'&&warnT>0){ // 首领/精英出场警告横幅
    const blink=Math.floor(performance.now()/140)%2===0;
    ctx.globalAlpha=Math.min(1,warnT)*(blink?0.95:0.5);
    ctx.fillStyle='#ff2244';ctx.textAlign='center';ctx.font='bold 24px monospace';
    ctx.fillText(boss&&boss.mini?'警 告 · 精 英 接 近':'警 告 · 首 领 接 近',W/2,H*0.3);
    ctx.fillRect(W*0.12,H*0.3+18,W*0.76,2);
    ctx.globalAlpha=1;ctx.textAlign='left';
  }
  if(flash>0){ctx.fillStyle=`rgba(255,255,255,${flash})`;ctx.fillRect(-20,-20,W+40,H+40);}
  if(state==='clear'){
    ctx.textAlign='center';
    UI.drawNeonPanel(ctx,W/2-160,H/2-80,320,150,'战区肃清','#7dff8c');
    ctx.save();ctx.shadowColor='#7dff8c';ctx.shadowBlur=20;
    ctx.fillStyle='#7dff8c';ctx.font='bold 38px monospace';
    ctx.fillText('通关成功',W/2,H/2-15);ctx.restore();
    ctx.fillStyle='#fff';ctx.font='16px monospace';
    ctx.fillText(`第 ${stage} 关通过 · 得分 ${score}`,W/2,H/2+30);}
  if(state==='over'){
    ctx.fillStyle='rgba(0,0,0,0.7)';ctx.fillRect(0,0,W,H);
    ctx.textAlign='center';
    UI.drawNeonPanel(ctx,W/2-160,H/2-125,320,265,'最终战报','#ff0055');
    ctx.save();ctx.shadowColor='#ff0055';ctx.shadowBlur=25;
    ctx.fillStyle='#ff0055';ctx.font='bold 42px monospace';
    ctx.fillText('游戏结束',W/2,H/2-60);ctx.restore();
    ctx.fillStyle='#fff';ctx.font='bold 20px monospace';
    ctx.fillText('得分  '+String(score).padStart(7,'0'),W/2,H/2-10);
    ctx.fillStyle='#ffe600';ctx.font='14px monospace';
    ctx.fillText('最高分  '+String(hi).padStart(7,'0'),W/2,H/2+20);
    // 复活 / 重新开始按钮
    if(reviveUsed<MAX_REVIVE){
      UI.drawNeonPanel(ctx,REVIVE_BTN.x,REVIVE_BTN.y,REVIVE_BTN.w,REVIVE_BTN.h,'复活机会 '+(MAX_REVIVE-reviveUsed),'#00f3ff');
      ctx.fillStyle=reviving?'#666':'#00f3ff';ctx.font='bold 15px monospace';
      ctx.fillText(reviving?'加载中...':'▶ 看广告复活',REVIVE_BTN.x+REVIVE_BTN.w/2,REVIVE_BTN.y+34);
    }
    const rb=restartRect();
    UI.drawNeonPanel(ctx,rb.x,rb.y,rb.w,rb.h,'再来一局','#ff0055');
    ctx.fillStyle='#fff';ctx.font='bold 15px monospace';
    ctx.fillText('重新开始',rb.x+rb.w/2,rb.y+34);
  }
  if(state==='pause'){
    ctx.setTransform(SX,0,0,SY,0,0); // 摆脱震动偏移，菜单稳定
    ctx.fillStyle='rgba(2,4,10,0.72)';ctx.fillRect(0,0,W,H);
    ctx.textAlign='center';
    UI.drawNeonPanel(ctx,W/2-128,H/2-124,256,196,'已暂停','#00f3ff');
    for(const b of PAUSE_BTNS){
      UI.drawNeonPanel(ctx,b.x,b.y,b.w,b.h,'',b.c);
      ctx.fillStyle=b.c;ctx.font='bold 16px monospace';
      ctx.fillText(b.t,b.x+b.w/2,b.y+28);
    }
  }
  if(msgT>0){
    ctx.save();ctx.globalAlpha=Math.min(1,msgT);
    ctx.fillStyle='#ffe600';ctx.font='bold 14px monospace';ctx.textAlign='center';
    ctx.fillText(msg,W/2,H/2+135);ctx.restore();
  }
  overlay();
}
function overlay(){ctx.setTransform(SX,0,0,SY,0,0);if(scan){ctx.fillStyle=scan;ctx.fillRect(0,0,W,H);}}
function drawTitle(){
  ctx.textAlign='center';
  ctx.save();
  ctx.shadowColor='#00f3ff'; ctx.shadowBlur=25;
  ctx.fillStyle='#00f3ff'; ctx.font='bold 56px monospace';
  ctx.fillText('怒雷风暴',W/2,220);
  ctx.shadowColor='#ff0055'; ctx.shadowBlur=15;
  ctx.fillStyle='#ff0055'; ctx.font='16px monospace';
  ctx.fillText('赛博街机 · 弹幕射击',W/2,260);
  ctx.restore();

  ctx.fillStyle=Math.floor(performance.now()/400)%2?'#00f3ff':'#ff0055';
  ctx.font='bold 22px monospace';ctx.fillText('▶ 点击屏幕开始战斗 ◀',W/2,H-170);

  ctx.fillStyle='#9ca3af';ctx.font='14px monospace';ctx.fillText('最高分: '+String(hi).padStart(7,'0'),W/2,H-130);

  // 设置入口（右上角齿轮）：玩法/金币/战机/背景 收纳在设置面板
  UI.drawNeonPanel(ctx,SET_BTN.x,SET_BTN.y,SET_BTN.w,SET_BTN.h,'','#00f3ff');
  drawGear(SET_BTN.x+26,SET_BTN.y+20,10);
  ctx.fillStyle='#9feaff';ctx.font='bold 14px monospace';ctx.textAlign='left';
  ctx.fillText('设置',SET_BTN.x+44,SET_BTN.y+25);
  // 排行榜入口（左上角领奖台图标）：好友榜 + 世界榜
  UI.drawNeonPanel(ctx,RANK_BTN.x,RANK_BTN.y,RANK_BTN.w,RANK_BTN.h,'','#ff0055');
  drawPodium(RANK_BTN.x+24,RANK_BTN.y+24);
  ctx.fillStyle='#ffb8c9';ctx.font='bold 14px monospace';ctx.textAlign='left';
  ctx.fillText('排行',RANK_BTN.x+40,RANK_BTN.y+25);
  ctx.textAlign='center';
}
// 领奖台图标：三根高低柱（排行榜入口用，避免依赖奖杯字形的渲染差异）
function drawPodium(x,y){
  ctx.save();
  ctx.fillStyle='#ff7a95';ctx.fillRect(x-14,y-8,7,8);
  ctx.fillStyle='#ffb8c9';ctx.fillRect(x-6,y-13,7,13);
  ctx.fillStyle='#ff7a95';ctx.fillRect(x+2,y-6,7,6);
  ctx.restore();
}
// 齿轮图标：外圈 + 8 齿 + 中孔（避免依赖 ⚙ 字形的渲染差异）
function drawGear(x,y,r){
  ctx.save();
  ctx.strokeStyle='#9feaff';ctx.fillStyle='#9feaff';ctx.lineWidth=2;
  ctx.beginPath();ctx.arc(x,y,r*0.62,0,7);ctx.stroke();
  for(let i=0;i<8;i++){const a=i*Math.PI/4;
    ctx.fillRect(x+Math.cos(a)*r*0.78-2,y+Math.sin(a)*r*0.78-2,4,4);}
  ctx.beginPath();ctx.arc(x,y,r*0.2,0,7);ctx.fill();
  ctx.restore();
}
// 设置面板：玩法说明 / 金币与看广告 / 更换战机 / 更换背景
function drawSettings(){
  ctx.setTransform(SX,0,0,SY,0,0);
  ctx.fillStyle='rgba(2,4,10,0.72)';ctx.fillRect(0,0,W,H);
  ctx.textAlign='left';
  const P=SET_PANEL;
  UI.drawNeonPanel(ctx,P.x,P.y,P.w,P.h,'设置','#00f3ff');
  UI.drawNeonPanel(ctx,SET_CLOSE.x,SET_CLOSE.y,SET_CLOSE.w,SET_CLOSE.h,'','#ff0055');
  ctx.textAlign='center';ctx.fillStyle='#ff7a95';ctx.font='bold 13px monospace';
  ctx.fillText('✕ 返回',SET_CLOSE.x+SET_CLOSE.w/2,SET_CLOSE.y+23);
  ctx.textAlign='left';
  // 玩法
  ctx.fillStyle='#ffe600';ctx.font='bold 13px monospace';
  ctx.fillText('玩法',P.x+16,P.y+64);
  ctx.fillStyle='rgba(230,240,255,0.85)';ctx.font='12px monospace';
  TIPS.forEach((s,i)=>ctx.fillText(s,P.x+16,P.y+86+i*22));
  // 金币与广告
  ctx.fillStyle='#ffe600';ctx.font='bold 16px monospace';
  ctx.fillText('金币 '+coins,P.x+16,P.y+246);
  UI.drawNeonPanel(ctx,SET_COIN_BTN.x,SET_COIN_BTN.y,SET_COIN_BTN.w,SET_COIN_BTN.h,'','#ffe600');
  ctx.textAlign='center';ctx.fillStyle='#ffe600';ctx.font='bold 14px monospace';
  ctx.fillText('▶ 看广告领金币 +'+REWARD_COINS,SET_COIN_BTN.x+SET_COIN_BTN.w/2,SET_COIN_BTN.y+25);
  if(tmsgT>0){ctx.globalAlpha=Math.min(1,tmsgT);ctx.font='12px monospace';
    ctx.fillText(tmsg,SET_COIN_BTN.x+SET_COIN_BTN.w/2,SET_COIN_BTN.y+SET_COIN_BTN.h+14);ctx.globalAlpha=1;}
  ctx.textAlign='left';
  // 战机
  ctx.fillStyle='#00f3ff';ctx.font='bold 13px monospace';
  ctx.fillText('战机',P.x+16,P.y+286);
  SET_SHIP_CHIPS.forEach(c=>{
    const on=c.i===shipIdx;
    UI.drawNeonPanel(ctx,c.x,c.y,c.w,c.h,'',on?'#00f3ff':'#4a5568');
    ctx.save();ctx.translate(c.x+c.w/2,c.y+22);ctx.scale(0.5,0.5);
    drawShipShape(SHIPS[c.i]);ctx.restore();
    ctx.textAlign='center';ctx.fillStyle=on?'#9feaff':'#8892a8';ctx.font='11px monospace';
    ctx.fillText(SHIPS[c.i].name+(on?' · 已选':''),c.x+c.w/2,c.y+54);
    ctx.textAlign='left';
  });
  // 背景
  ctx.fillStyle='#7dff8c';ctx.font='bold 13px monospace';
  ctx.fillText('背景',P.x+16,P.y+392);
  SET_BG_CHIPS.forEach(c=>{
    const th=BGS[c.i],on=c.i===bgIdx;
    UI.drawNeonPanel(ctx,c.x,c.y,c.w,c.h,'',on?'#7dff8c':'#4a5568');
    ctx.fillStyle=th.bg;ctx.fillRect(c.x+9,c.y+8,18,18);
    ctx.fillStyle=th.stars[2];ctx.fillRect(c.x+13,c.y+12,10,10);
    ctx.textAlign='center';ctx.fillStyle=on?'#a5ffb8':'#8892a8';ctx.font='11px monospace';
    ctx.fillText(th.name+(on?' · 已选':''),c.x+34+(c.w-34)/2,c.y+22);
    ctx.textAlign='left';
  });
}
// HUD：纯发光文字，不再画面板底框（去框减少视野遮挡与"网页卡片"感）
function drawHUD(){
  ctx.setTransform(SX,0,0,SY,0,0);
  ctx.textAlign='left'; // 显式钉死对齐，避免其他状态遗留的 center 泄漏
  // 第一行：得分（左）/ 关卡与倒计时（中）/ 生命（右）
  ctx.fillStyle='rgba(150,200,235,0.75)';ctx.font='11px monospace';
  ctx.fillText('得分',12,HUD_TOP+14);
  ctx.save();ctx.textAlign='center';
  ctx.fillStyle='rgba(220,205,130,0.75)';
  ctx.fillText('第 '+stage+' 关',W/2,HUD_TOP+14);
  ctx.restore();
  ctx.save();ctx.shadowColor='#00f3ff';ctx.shadowBlur=10;
  ctx.fillStyle='#eaffff';ctx.font='bold 22px monospace';
  ctx.fillText(String(score).padStart(7,'0'),12,HUD_TOP+40);
  ctx.restore();
  ctx.save();ctx.textAlign='center';ctx.shadowColor='#ffe600';ctx.shadowBlur=10;
  if(boss){
    ctx.fillStyle=Math.floor(performance.now()/300)%2?'#ff5d5d':'#ffe600';
    ctx.font='bold 20px monospace';
    ctx.fillText(boss.mini?'精英!!':'首领!!',W/2,HUD_TOP+40);
  }else{
    const cd=Math.max(0,Math.ceil(BOSS_AT-elapsed));
    ctx.fillStyle=cd<=10?'#ff5d5d':'#ffe600';
    ctx.font='bold 20px monospace';
    ctx.fillText(cd+'秒',W/2,HUD_TOP+40);
  }
  ctx.restore();
  ctx.save();ctx.textAlign='right';
  ctx.fillStyle='#ffd7de';ctx.font='bold 16px monospace';
  ctx.fillText('❤️ × '+player.lives,W-12,HUD_TOP+40);
  ctx.restore();
  // 第二行：武器（左）
  ctx.save();ctx.shadowColor='#ff0055';ctx.shadowBlur=6;
  ctx.fillStyle='#ff7a95';ctx.font='13px monospace';
  ctx.fillText('武器 '+(WPN_ZH[player.weapon]||player.weapon)+' '+player.wlevel+'级',12,HUD_TOP+66);
  ctx.restore();

  // 高能炸弹圆盘按钮（随 Banner 高度上移避让）
  const bp=bombPos();
  UI.drawBombButton(ctx, bp.x, bp.y, 35, player.bombs, player.bombs > 0);

  if(boss){
    UI.drawBossBar(ctx, W, H-Ads.bannerH(), boss.hp, boss.maxhp);
  }
}

// ---------- 主循环 ----------
let last=performance.now();
function loop(now){
  const dt=Math.min(0.05,(now-last)/1000);last=now;
  if(msgT>0)msgT-=dt;
  if(tmsgT>0)tmsgT-=dt;
  for(const s of stars){s.y+=s.v*dt*(state==='playing'?1:0.3);if(s.y>H){s.y=-2;s.x=Math.random()*W;}}
  // 纯视觉特效时钟：与游戏状态无关，顿帧/暂停期间也持续走（链条爆、冲击波、流星）
  for(let i=chainBooms.length-1;i>=0;i--){const c=chainBooms[i];c.t-=dt;
    if(c.t<=0){explode(c.x,c.y,true);chainBooms.splice(i,1);}}
  for(let i=shockwaves.length-1;i>=0;i--){const w=shockwaves[i];w.t+=dt;w.r+=w.vr*dt;
    if(w.t>=w.life)shockwaves.splice(i,1);}
  meteorT-=dt;
  if(meteorT<=0){meteorT=rnd(5,11);meteors.push({x:rnd(40,W-40),y:-8,vx:rnd(-60,60),vy:rnd(260,420),t:0,life:rnd(0.9,1.4)});}
  for(let i=meteors.length-1;i>=0;i--){const m=meteors[i];m.t+=dt;m.x+=m.vx*dt;m.y+=m.vy*dt;
    if(m.t>=m.life)meteors.splice(i,1);}
  // 刷怪节奏完全由 update() 内 spawnT 控制，此处不再干预（钳下限会导致 spawnT 永远到不了触发阈值）
  update(dt);draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
