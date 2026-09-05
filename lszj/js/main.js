
"use strict";
const UI = require('./ui.js');
const Ads = require('./ads.js');
const Rank = require('./rank.js');
const CDN = require('./cdn.js');
const Settings = require('./settings.js'); // 设置页（独立全屏页面：左侧菜单 + 右侧内容区）
const Sfx = require('./sfx.js'); // SFX 池 + BGM（assets/audio wav 打包进包，BGM 走 CDN）
// CDN 素材预热：开机即后台拉取（未就绪期间各绘制函数回退程序化画法，游戏不受影响）
CDN.preload(['Boss-01','战机分级-01','战机分级-02','战机分级-03','战机分级-04',
  'Buff道具-02','Buff道具-04','Buff道具-06','掉落物-02','掉落物-03','掉落物-06',
  '敌机-01','敌机-02','敌机-03','敌机-04']);
const cv=wx.createCanvas(),ctx=cv.getContext('2d');
const W=480;
// 设计宽度固定 480，设计高度随设备宽高比自适应（钳制 800~1200），保证 SX=SY 等比缩放；
// 否则圆角面板/文字会被非等比拉伸变形。下限 800 保标题屏布局，上限防极端长屏
let winW=375,winH=667,safeTop=0,safeBottom=0,H=800;
try{
  // getWindowInfo() 是基础库 2.20+ 推荐接口且同样带 safeArea；取不到时回退旧接口
  let si=null;
  try{si=(typeof wx.getWindowInfo==='function')?wx.getWindowInfo():wx.getSystemInfoSync();}catch(e){}
  if(!si)si=wx.getSystemInfoSync();
  if(si.windowWidth>0)winW=si.windowWidth;
  if(si.windowHeight>0)winH=si.windowHeight;
  H=Math.round(Math.min(Math.max(W*winH/winW,800),1200));
  const k=H/winH; // 屏幕逻辑像素 → 游戏坐标换算系数
  // 顶部：刘海/挖孔 + 状态栏。部分安卓挖孔屏的 safeArea.top 会回落为 0，必须与
  // statusBarHeight 取大值，否则 HUD 会顶进摄像头区
  const st=Math.max((si.safeArea&&si.safeArea.top)||0,si.statusBarHeight||0);
  safeTop=Math.round(st*k);
  // 底部：全面屏手势条（iPhone home indicator 约 34 逻辑px）。老机型无 safeArea 按 0 处理；
  // 钳 12% 屏高上限，防个别机型返回异常值把玩法区挤没
  const sb=(si.safeArea&&si.safeArea.bottom!=null)?Math.max(0,winH-si.safeArea.bottom):0;
  safeBottom=Math.round(Math.min(sb,winH*0.12)*k);
}catch(e){}
if(!isFinite(H)||H<800)H=800;
if(!isFinite(safeTop)||safeTop<0)safeTop=0;
if(!isFinite(safeBottom)||safeBottom<0)safeBottom=0;
// 设计分辨率 W×H → 实际画布（设备像素）的绘制缩放；画布尺寸异常时回退 1:1，避免 NaN 变换导致黑屏
const SX=(cv.width&&cv.width>0)?cv.width/W:1,SY=(cv.height&&cv.height>0)?cv.height/H:1;
function fit(){}

const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const rnd=(a,b)=>a+Math.random()*(b-a);


// ---------- 全局状态 ----------
let state='title',stage=1,score=0,hi=+(wx.getStorageSync('nulei_hi')||0);
let elapsed=0,runTime=0,spawnT=1,boss=null,clearT=0,shake=0,flash=0,miniSpawned=false,warnT=0,hitStop=0;
const BOSS_AT=55; // 常规关卡 Boss 出现时间（秒），HUD 倒计时与刷怪逻辑共用
const BOSS_MINI_AT=25; // 小 Boss（精英）出场时间（秒），第2关起每关一次
const bossAt=()=>stage===1?35:BOSS_AT; // 第1关 Boss 提前登场，缩短新手关时长
let bullets=[],ebullets=[],enemies=[],items=[],parts=[],shockwaves=[],chainBooms=[],meteors=[],meteorT=4,eid=0;
const PW=54; // 玩家机体显示宽度（雷电式大机型，按宽度统一各分级素材尺寸）
const player={x:W/2,y:H-90,r:5,lives:3,bombs:3,inv:2,weapon:'std',wlevel:1,mis:'none',mlevel:0,fireT:0,misT:0,_switchedOnce:false,_misSwitchedOnce:false};


const HUD_TOP=safeTop+8; // 顶部 HUD 起始 y
const PLAY_TOP=HUD_TOP+62; // 玩家可移动的最高位置（让开 HUD）
// 触摸坐标：屏幕逻辑像素 → 游戏坐标（480×H 等比映射，H 已随设备比例自适应）
const toGame=t=>({x:t.clientX*W/winW,y:t.clientY*H/winH});
// 广告模块初始化：仅激励视频（复活/金币翻倍，玩家主动触发），无常驻 Banner
Ads.setup({gameW:W,gameH:H});
// bottomInset 用惰性取值：本行在其 const 定义之前执行，直接传引用会踩 TDZ
Rank.setup({sx:SX,sy:SY,bottomInset:()=>bottomInset(),onClose:()=>{state='title';}});
const BOMB_R=45;
// 底部不可用高度：让开刘海屏底部的手势条，避免误触上滑返回桌面
const bottomInset=()=>safeBottom;
const bombPos=()=>({x:W-50,y:H-50-bottomInset()}); // 与 drawHUD 中的炸弹按钮位置保持一致
const playBottom=()=>H-44-bottomInset(); // 玩家可移动的最低位置（机体半高留量 + 让开手势条）

// 复活流程（激励视频）
const MAX_REVIVE=2;
let reviveUsed=0,reviving=false,msg='',msgT=0;
const REVIVE_BTN={x:W/2-150,y:H/2+52,w:145,h:48};
// 过关结算按钮（通关后不自动推进，由玩家手动选择）
const CLEAR_BTNS=[
  {t:'下一关 ▶',act:'next',x:W/2-150,y:H/2+58,w:145,h:48},
  {t:'返回主页',act:'title',x:W/2+5,y:H/2+58,w:145,h:48}
];
const restartRect=()=>reviveUsed<MAX_REVIVE?{x:W/2+5,y:H/2+52,w:145,h:48}:{x:W/2-72,y:H/2+52,w:144,h:48};
// 结算金币：过关/死亡时按上次结算后的得分增量换算（COIN_PER_SCORE 分 1 金，各自封顶），结算面板可看广告翻倍一次
const COIN_PER_SCORE=500,SETTLE_STAGE_CAP=30,SETTLE_DEATH_CAP=60;
let lastCoinScore=0,settleCoins=0,settleDoubled=false;
const OVER_COIN_BTN={x:W/2-140,y:H/2+112,w:280,h:38};
const CLEAR_COIN_BTN={x:W/2-140,y:H/2+116,w:280,h:38};
function grantSettleCoins(cap){
  const base=Math.min(cap,Math.floor((score-lastCoinScore)/COIN_PER_SCORE));
  lastCoinScore=score;
  if(base>0){coins+=base;saveCoins();}
  settleCoins=base;settleDoubled=false;
}
function requestSettleDouble(){
  if(reviving||settleDoubled||settleCoins<=0)return;
  reviving=true;
  Ads.playRewarded(ok=>{
    reviving=false;
    if(ok===true){coins+=settleCoins;saveCoins();settleDoubled=true;Sfx.play('coin');}
    else toast(ok===null?'广告暂不可用，请稍后再试':'需完整观看广告才能翻倍');
  });
}
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
  Sfx.play('upgrade');
}

// ---------- 金币与升级（看广告领金币；掉率/火力升级预留） ----------
let coins=Number(wx.getStorageSync('nulei_coins'))||0;
// ---------- 主页设置：玩法说明 / 金币与广告 / 更换战机 / 更换背景 ----------
const SHIPS=[ // 机体皮肤：同款外形不同涂装（设置预览与游戏内共用 drawShipShape）
  {name:'怒雷号',body:'#d8ecff',fin:'#3f8fd6',trail:'#ffb347'},
  {name:'赤焰号',body:'#ffe0d6',fin:'#d6533f',trail:'#ff7a45'},
  {name:'幽紫号',body:'#e6d9ff',fin:'#8a5cf0',trail:'#c77dff'},
];
const BGS=[ // 背景主题：底色 + 三层星空配色（底色拉开色相差，星星同步提亮，保证切换可感知）
  {name:'深空蓝',bg:'#05050c',stars:['#26355a','#3b4a6b','#5d7bb8']},
  {name:'星云紫',bg:'#140a2e',stars:['#4e3a80','#7a63c4','#b892ff']},
  {name:'翡翠绿',bg:'#06281a',stars:['#2a6647','#3f9e68','#82e8ac']},
];
let shipIdx=wx.getStorageSync('nulei_ship')||0;if(!(shipIdx>=0&&shipIdx<SHIPS.length))shipIdx=0;
let bgIdx=wx.getStorageSync('nulei_bg')||0;if(!(bgIdx>=0&&bgIdx<BGS.length))bgIdx=0;
const saveShip=()=>wx.setStorageSync('nulei_ship',shipIdx);
const saveBg=()=>wx.setStorageSync('nulei_bg',bgIdx);
const SHIP_PRICE=[0,800,1500],BG_PRICE=[0,400,800]; // 皮肤/背景解锁价（0=免费），下标与 SHIPS/BGS 对应
let owned=Object.assign({ships:[true,false,false],bgs:[true,false,false]},wx.getStorageSync('nulei_owned')||{});
if(!Array.isArray(owned.ships)||owned.ships.length!==SHIPS.length)owned.ships=SHIPS.map((_,i)=>i===0);
if(!Array.isArray(owned.bgs)||owned.bgs.length!==BGS.length)owned.bgs=BGS.map((_,i)=>i===0);
if(!owned.ships[shipIdx])shipIdx=0;
if(!owned.bgs[bgIdx])bgIdx=0;
const saveOwned=()=>wx.setStorageSync('nulei_owned',owned);
const TIPS=['[ 拖动屏幕 ] 控制战机移动并自动射击','[ 点击右下角 ] 释放高能全屏炸弹','[ 红 R ] 追踪导弹 · [ 蓝 B ] 穿透激光','[ 道具掉落 ] 拾取升级武器与火力','[ 中心小白点 ] 战机核心判定区','[ 双击屏幕 ] 暂停 / 继续'];
const SET_BTN={x:W-92,y:HUD_TOP+4,w:80,h:40}; // 主页右上角设置入口（打开独立设置页）
const RANK_BTN={x:20,y:HUD_TOP+4,w:80,h:40}; // 主页左上角排行榜入口（与设置入口镜像）
const SND_BTN={x:W/2-40,y:HUD_TOP+4,w:80,h:40}; // 主页顶部居中：全局声音总开关（SFX+BGM 一键全关/全开）
const MUTE_BTN={x:W-48,y:HUD_TOP-4,w:46,h:32}; // 战斗中右上角小喇叭：随时一键全静音/恢复（与主页开关同一状态）
const REWARD_COINS=50; // 每次完整观看激励视频奖励金币
const VERSION='0.0.2'; // 与 version.json 的 latest 保持一致（设置页"关于"展示）
// 升级项预留：数值效果已接入掉率(dropItem)与伤害(update/useBomb)，商店 UI 上线后调 buyUpgrade 即可
const UPGRADES={
  drop:{max:5,cost:l=>120*(l+1),val:l=>1+l*0.25}, // 掉落率：每级 +25%（关卡基础值 dropRate() × 倍率）
  power:{max:5,cost:l=>150*(l+1),val:l=>1+l*0.1}, // 火力强度：每级 +10% 伤害
};
let ups=Object.assign({drop:0,power:0},wx.getStorageSync('nulei_up')||{});
const saveCoins=()=>wx.setStorageSync('nulei_coins',coins);
const saveUps=()=>wx.setStorageSync('nulei_up',ups);
const upVal=id=>ups[id]||0;
function buyUpgrade(id){
  const u=UPGRADES[id];if(!u)return false;
  const l=upVal(id);
  if(l>=u.max)return false;
  const c=u.cost(l);
  if(coins<c)return false;
  coins-=c;ups[id]=l+1;saveUps();saveCoins();
  return true;
}
function requestCoinAd(){
  if(reviving)return;
  reviving=true;
  Ads.playRewarded(ok=>{
    reviving=false;
    if(ok===true){coins+=REWARD_COINS;saveCoins();Settings.toast('金币 +'+REWARD_COINS);Sfx.play('coin');}
    else{Settings.toast(ok===null?'广告暂不可用，请稍后再试':'需完整观看广告才能获得金币');}
  });
}

// 皮肤/背景解锁：点已拥有项直接选用，未拥有项金币足额则一键购买并选用
function pickShip(i){
  if(owned.ships[i]){shipIdx=i;saveShip();Sfx.play('click');return;}
  if(coins<SHIP_PRICE[i]){Settings.toast('金币不足');Sfx.play('click');return;}
  coins-=SHIP_PRICE[i];owned.ships[i]=true;saveCoins();saveOwned();shipIdx=i;saveShip();
  Settings.toast('已解锁 '+SHIPS[i].name);Sfx.play('coin');
}
function pickBg(i){
  if(owned.bgs[i]){bgIdx=i;saveBg();Sfx.play('click');return;}
  if(coins<BG_PRICE[i]){Settings.toast('金币不足');Sfx.play('click');return;}
  coins-=BG_PRICE[i];owned.bgs[i]=true;saveCoins();saveOwned();bgIdx=i;saveBg();
  Settings.toast('已解锁 '+BGS[i].name);Sfx.play('coin');
}
function tryBuyUpgrade(id){
  const u=UPGRADES[id];
  if(upVal(id)>=u.max){Settings.toast('已满级');return;}
  if(buyUpgrade(id)){Settings.toast((id==='drop'?'掉落率':'火力强度')+' Lv'+upVal(id));Sfx.play('upgrade');}
  else{Settings.toast('金币不足');Sfx.play('click');}
}

// 设置页注入：数据与存档逻辑留在 main.js，设置页只负责展示与回调（新增菜单项见 js/settings.js）
Settings.setup({
  sx:SX, sy:SY, safeTop,
  bottomInset:()=>bottomInset(), // 惰性取值：页面底部需让开 Banner / 手势条
  onClose:()=>{state='title';},
  data:()=>({coins,hi,shipIdx,bgIdx,owned,ups,ships:SHIPS,bgs:BGS,
    shipPrice:SHIP_PRICE,bgPrice:BG_PRICE,upsDef:UPGRADES,reward:REWARD_COINS,tips:TIPS,
    version:VERSION,sfxOn:Sfx.sfxOn,bgmOn:Sfx.bgmOn,drawShip:drawShipShape}),
  act:{pickShip,pickBg,ad:requestCoinAd,buy:tryBuyUpgrade,
    sfx:()=>{Sfx.toggleSfx();if(Sfx.sfxOn)Sfx.play('click');}, // 开时响一声确认，关时无声
    bgm:()=>{Sfx.toggleBgm();Sfx.play('click');},
    click:()=>Sfx.play('click')},
});

let drag=null;
// 双击暂停检测：两次"干净点按"（快速按下-抬起且未移动）间隔 <350ms 且位置相近
let tStart=0,tStartX=0,tStartY=0,tMoved=false;
let lastTapT=0,lastTapX=0,lastTapY=0;
wx.onTouchStart(e => {
  const touch = e.touches[0];
  if (!touch) return;
  const t = toGame(touch);
  if (Ads.onTouchStart(t)) return; // 模拟广告展示中：点击只作用于广告层
  if (state === 'playing') {
    // 静音按钮（右上角小喇叭）：先于拖动判定吞掉点按，不带动机体移动
    if (inRect(t, MUTE_BTN)) { const on = Sfx.toggleAll(); if (on) Sfx.play('click'); return; }
    // 炸弹按钮（屏幕右下角圆盘，随手势条高度上移）
    const bp=bombPos();
    if ((t.x-bp.x)**2+(t.y-bp.y)**2 < BOMB_R**2) { useBomb(); return; }
    tStart=Date.now();tStartX=t.x;tStartY=t.y;tMoved=false; // 记录触点供双击判定
    drag = { x: t.x, y: t.y, px: player.x, py: player.y };
    return;
  }
  if (state === 'over') {
    if (reviving) return;
    if (reviveUsed<MAX_REVIVE && inRect(t,REVIVE_BTN)) { requestRevive(); return; }
    if (inRect(t,OVER_COIN_BTN)) { requestSettleDouble(); return; }
    if (inRect(t,restartRect())) startGame();
    return;
  }
  if (state === 'pause') {
    for (const b of PAUSE_BTNS) {
      if (inRect(t, b)) {
        Sfx.play('click');
        if (b.t === '继续游戏') { state = 'playing'; Sfx.bgmResume(); }
        else if (b.t === '重新开始') startGame();
        else goTitle();
        return;
      }
    }
    return;
  }
  if (state === 'clear') { // 过关动画播完后停在结算界面，手动选择下一关/返回
    if (clearT <= 0 && inRect(t, CLEAR_COIN_BTN)) { requestSettleDouble(); return; }
    if (clearT <= 0) for (const b of CLEAR_BTNS) {
      if (inRect(t, b)) { Sfx.play('click'); b.act === 'next' ? nextStage() : goTitle(); return; }
    }
    return;
  }
  if (reviving) return; // 广告播放中忽略点击
  if (state === 'settings') { Settings.onDown(t); return; } // 设置页自行判定点击 / 滚动拖动
  if (state === 'rank') {
    if (!Rank.onTouch(t)) state = 'title'; // 面板内未命中 → 点面板外关闭
    return;
  }
  if (inRect(t, SET_BTN)) { state = 'settings'; Settings.open(); Sfx.play('click'); return; } // 主页右上角：打开设置页
  if (inRect(t, RANK_BTN)) { state = 'rank'; Sfx.play('click'); Rank.open('friend', hi); return; } // 主页左上角：打开排行榜
  if (inRect(t, SND_BTN)) { const on = Sfx.toggleAll(); if (on) Sfx.play('click'); return; } // 主页居中：全局声音开关（开时响一声确认）
  startGame(); // title
});
wx.onTouchMove(e => {
  const touch = e.touches[0];
  if (!touch) return;
  const t = toGame(touch);
  if (state === 'settings') { Settings.onMove(t); return; } // 设置页：菜单列 / 内容区滚动
  if (!drag || state !== 'playing') return;
  if(!tMoved&&(t.x-tStartX)**2+(t.y-tStartY)**2>144)tMoved=true; // 移动超 12px 视为拖动，不算点按
  player.x = clamp(drag.px + (t.x - drag.x), PW/2+2, W - PW/2-2); // 边界随机体半宽留出
  player.y = clamp(drag.py + (t.y - drag.y), PLAY_TOP, playBottom());
});
wx.onTouchEnd(e => {
  const ct = e.changedTouches && e.changedTouches[0];
  if (ct && state === 'settings') { Settings.onUp(toGame(ct)); return; } // 抬起时结算：拖动过则不算点击
  if (ct && state === 'playing' && !tMoved) {
    const g = toGame(ct), now = Date.now();
    if (now - tStart < 250) { // 干净的短点按
      if (now - lastTapT < 350 && (g.x-lastTapX)**2+(g.y-lastTapY)**2 < 48*48) {
        state = 'pause'; drag = null; lastTapT = 0; Sfx.bgmPause(); return; // 双击暂停
      }
      lastTapT = now; lastTapX = g.x; lastTapY = g.y;
    } else lastTapT = 0;
  } else lastTapT = 0;
  drag = null;
});
// 切后台/来电时自动暂停（仅 playing 态）；复活广告回调会显式恢复 playing，与自动暂停无冲突
wx.onHide(() => { if (state === 'playing') { state = 'pause'; drag = null; Sfx.bgmPause(); } });
  

// ---------- 流程 ----------
function startGame(){
  state='playing';stage=1;score=0;elapsed=0;runTime=0;spawnT=1;boss=null;clearT=0;miniSpawned=false;
  warnT=0;hitStop=0;shockwaves=[];chainBooms=[];lastDropT=-9;killsSinceDrop=0;
  bullets=[];ebullets=[];enemies=[];items=[];parts=[];
  reviveUsed=0;reviving=false;msgT=0;lastCoinScore=0;settleCoins=0;settleDoubled=false;
  Object.assign(player,{x:W/2,y:H-90,lives:3,bombs:3,inv:2,weapon:'std',wlevel:1,mis:'none',mlevel:0,fireT:0,misT:0});
  Sfx.play('click');Sfx.bgmStart(); // 进入战斗：BGM 起（CDN 未就绪/失败则静默，无碍游玩）
}
function nextStage(){stage++;elapsed=0;spawnT=1;boss=null;ebullets=[];miniSpawned=false;warnT=0;hitStop=0;state='playing';Sfx.bgmStart();}
function goTitle(){state='title';boss=null;warnT=0;hitStop=0;bullets=[];ebullets=[];enemies=[];items=[];parts=[];shockwaves=[];chainBooms=[];drag=null;Sfx.bgmStop();}
function gameOver(){
  state='over';
  Sfx.bgmStop();Sfx.play('over');
  grantSettleCoins(SETTLE_DEATH_CAP);
  if(score>hi){hi=score;wx.setStorageSync('nulei_hi', hi);
    // 双榜同步：好友榜走微信托管 KV（子域读取），世界榜上报 nulei-server（失败静默）
    try{wx.setUserCloudStorage({KVDataList:[{key:'nulei_hi',value:String(hi)}],fail:()=>{}});}catch(e){}
    Rank.report(hi,runTime);
  }
}
function useBomb(){
  if(player.bombs<=0||state!=='playing')return;
  player.bombs--;flash=0.4;shake=14;Sfx.play('boss_boom');
  const dmgMul=UPGRADES.power.val(upVal('power'));
  for(const b of ebullets)spark(b.x,b.y,'#88ffff',2);
  ebullets=[];
  for(const e of enemies)e.hp-=25*dmgMul;
  if(boss)boss.hp-=40*dmgMul;
}

// ---------- 生成敌人 ----------
function addEnemy(o){o.id=++eid;o.t=0;o.fireT=rnd(0.5,1.5);enemies.push(o);}
function spawnGrunt(){ // 编队杂兵（第1关3架一组，降低新手压力）
  const n=stage<2?3:5,x0=rnd(80,W-80);
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
  // 敌机类型逐关解锁：1红箭 / 2紫椭圆 / 3俯冲 / 4炮台；未解锁类型的权重并入红箭编队
  const pool=[[spawnGrunt,0.38]];
  if(stage>=2)pool.push([spawnWeaver,0.24]);
  if(stage>=3)pool.push([spawnDiver,0.22]);
  if(stage>=4)pool.push([spawnTurret,0.16]);
  const roll=Math.random();let acc=0;
  for(const [fn,w] of pool){acc+=w;if(roll<acc){fn();return;}}
  spawnGrunt();
}
function spawnBoss(){
  const hp=stage===1?300:260+stage*140; // 第1关 Boss 血量单独调低
  warnT=1.6;Sfx.play('alarm');
  boss={x:W/2,y:-90,hp,maxhp:hp,r:46,t:0,fireT:1.2,aimT:2.4,spiralA:0,spiralT:0.5};
}
function spawnMiniBoss(){ // 关卡中段精英：弱于关底 Boss，击杀不清关
  const hp=70+stage*50;
  warnT=1.6;Sfx.play('alarm');
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
    bullets.push({x:p.x,y:p.y-26,vx:0,vy:-sp*1.3,sp:sp*1.3,dmg:2+p.wlevel*0.5,pierce:true,hits:new Set(),r:p.wlevel>=4?9:4+p.wlevel,color:'#5df0ff',laser:true});
    Sfx.play('shoot',0.4);
  }else if(p.weapon==='homing'){
    for(let i=0;i<p.wlevel;i++){const a=-Math.PI/2+rnd(-0.6,0.6);
      bullets.push({x:p.x+rnd(-16,16),y:p.y-16,vx:Math.cos(a)*420,vy:Math.sin(a)*420,sp:420,dmg:1.5,homing:true,r:4,color:'#ff9d3c'});}
    Sfx.play('shoot',0.4);
  }else{
    const lv=p.wlevel,off=lv>=2?10:0,ang=lv>=3?0.16:0;
    bullets.push({x:p.x,y:p.y-26,vx:0,vy:-sp,sp,dmg:1,r:3,color:'#ffe66d'});
    if(lv>=2)bullets.push({x:p.x-off,y:p.y-16,vx:0,vy:-sp,sp,dmg:1,r:3,color:'#ffe66d'});
    if(lv>=3)bullets.push({x:p.x+off,y:p.y-16,vx:0,vy:-sp,sp,dmg:1,r:3,color:'#ffe66d'});
    if(lv>=4){for(const s of[-1,1])bullets.push({x:p.x+s*13,y:p.y-13,vx:s*Math.sin(0.3)*sp,vy:-Math.cos(0.3)*sp,sp,dmg:1,r:3,color:'#ffe66d'});}
    Sfx.play('shoot');
  }
}
function fireMissile(){
  const p=player;
  if(p.mis==='homing'){
    for(let i=0;i<p.mlevel+1;i++){const s=i%2?1:-1;
      bullets.push({x:p.x+s*22,y:p.y,vx:s*160,vy:-260,sp:260,dmg:3,homing:true,r:4,color:'#ffd23c',mis:true});}
    Sfx.play('shoot',0.35);
  }else if(p.mis==='laser'){
    bullets.push({x:p.x,y:p.y-32,vx:0,vy:-1100,sp:1100,dmg:2+p.mlevel,pierce:true,hits:new Set(),r:5+p.mlevel,color:'#c77dff',laser:true});
    Sfx.play('shoot',0.3);
  }
}

// ---------- 掉落 ----------
let lastDropT=-9; // 上次掉落时间（runTime 计），防连杀密集掉箱
let killsSinceDrop=0; // 连续击杀未掉落计数，满 8 触发保底
const dropRate=()=>stage<2?0.12:Math.min(0.13,0.05+(stage-1)*0.012); // 掉率：第1关 12%，第2关起随关卡爬升至 13% 封顶
function dropItem(x,y,force){ // force=true 必掉（小 Boss 掉落用）
  if(!force){
    killsSinceDrop++;
    const pity=killsSinceDrop>=8; // 保底：连续 8 杀未掉必掉，保证新手关拾取体验
    if(!pity&&(runTime-lastDropT<(stage<2?3.5:6)||Math.random()>dropRate()*UPGRADES.drop.val(upVal('drop'))))return;
    killsSinceDrop=0;
  }
  lastDropT=runTime;
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
  if(it.kind==='w'){
    if(p.weapon===it.val){p.wlevel=Math.min(4,p.wlevel+1);} // 同色 +1
    else{p.weapon=it.val;if(!p._switchedOnce){p.wlevel=Math.min(4,p.wlevel+1);p._switchedOnce=true;}} // 异色平切（首次切换 +1 新手保护）
    Sfx.play('upgrade');
  }
  else if(it.kind==='m'){
    if(p.mis===it.val){p.mlevel=Math.min(3,p.mlevel+1);} // 同色 +1
    else{p.mis=it.val;if(!p._misSwitchedOnce){p.mlevel=Math.min(3,p.mlevel+1);p._misSwitchedOnce=true;}} // 异色平切（首次切换 +1 新手保护）
    Sfx.play('upgrade');
  }
  else if(it.kind==='bomb'){p.bombs=Math.min(5,p.bombs+1);Sfx.play('pickup');}
  else{score+=500;Sfx.play('coin');}
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
  Sfx.play('boom',big?0.9:0.6);if(big)shake=Math.max(shake,8);
  shockwaves.push({x,y,r:4,vr:big?300:170,life:big?0.4:0.28,t:0,color:big?'#ffcf6b':'#ff9a5d'}); // 扩散冲击环
}

// ---------- 更新 ----------
function update(dt){
  if(hitStop>0){hitStop-=dt;return;} // 击杀首领顿帧：游戏世界瞬时冻结，特效时钟照常走
  // 屏震/闪白衰减放在状态早退之前：Boss 死亡连锁爆会把 shake 带进 clear/over 界面，
  // 若不衰减将永久冻结，结算弹窗会整帧随机平移（看起来变形、文字压框）
  flash=Math.max(0,flash-dt);shake=Math.max(0,shake-dt*30);
  if(state==='clear'){clearT=Math.max(0,clearT-dt);return;} // 播完过关动画即停在结算界面，不自动进入下一关
  if(state!=='playing')return;
  elapsed+=dt;runTime+=dt;
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
    if(elapsed>bossAt()){spawnBoss();}
    else if(stage>=2&&!miniSpawned&&elapsed>BOSS_MINI_AT){miniSpawned=true;spawnMiniBoss();}
    else{spawnT-=dt;if(spawnT<=0){const base=Math.max(1.4,2.4-(stage-1)*0.2);spawnT=Math.max(0.6,base-elapsed*0.012);spawnWave();}}
  }

  // 玩家子弹
  for(let i=bullets.length-1;i>=0;i--){const b=bullets[i];
    if(b.homing){const t=nearestEnemy(b.x,b.y);
      if(t){const a=Math.atan2(t.y-b.y,t.x-b.x),ca=Math.atan2(b.vy,b.vx);
        let d=a-ca;while(d>Math.PI)d-=Math.PI*2;while(d<-Math.PI)d+=Math.PI*2;
        const turn=clamp(d,-7*dt,7*dt);b.vx=Math.cos(ca+turn)*b.sp;b.vy=Math.sin(ca+turn)*b.sp;}}
    b.x+=b.vx*dt;b.y+=b.vy*dt;
    if(b.y<-30||b.y>H+30||b.x<-30||b.x>W+30){bullets.splice(i,1);continue;} // 补底部出界：追踪弹追下方敌机飞出屏幕后不回收会泄漏
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
    if(e.type==='grunt'){e.y+=e.vy*dt;e.fireT-=dt;if(e.fireT<=0&&e.y>0&&e.y<H*0.6){e.fireT=stage<2?4.5:2.6;eShoot(e.x,e.y+10,Math.PI/2,stage<2?130:170);}} // 第1关弹速/射速大幅放缓
    else if(e.type==='weaver'){e.y+=e.vy*dt;e.x=e.baseX+Math.sin(e.t*3)*70;}
    else if(e.type==='diver'){if(e.t<0.9)e.y+=70*dt;else{const dsp=Math.min(330,240+stage*22),a=Math.atan2(p.y-e.y,p.x-e.x);e.x+=Math.cos(a)*dsp*dt;e.y+=Math.sin(a)*dsp*dt;}} // 俯冲速度随关卡爬升，第3关初见时更温和
    else if(e.type==='turret'){if(e.y<130)e.y+=70*dt;else{e.fireT-=dt;if(e.fireT<=0&&e.y>0){e.fireT=Math.max(1.2,2.0-stage*0.1);shootAimed(e.x,e.y,3,200,0.25);}}} // 炮台第4关才解锁，射速随关卡收紧
    if(e.hp<=0){score+=e.score;explode(e.x,e.y,false);dropItem(e.x,e.y);
      ebullets=ebullets.filter(b=>(b.x-e.x)**2+(b.y-e.y)**2>70**2); // 击毁敌机顺手清除其刚射出的滞留弹（慢速弹悬停击毁点的问题）
      enemies.splice(i,1);continue;}
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
        const n = (rage ? 12 : 9) - (boss.mini ? 4 : 0) - (stage===1?2:0); for(let i=0; i<n; i++) eShoot(boss.x, boss.y + 20, Math.PI/2 + (i-(n-1)/2)*0.22, 170);
      }
      boss.aimT -= dt;
      if(boss.aimT <= 0){ boss.aimT = (rage ? 1.5 : 2.4) + (boss.mini ? 0.7 : 0); shootAimed(boss.x, boss.y + 20, (rage ? 5 : stage===1?2:3) - (boss.mini ? 1 : 0), 240, 0.16); }
      if(rage && !boss.mini && stage>=2){ boss.spiralT -= dt; // 狂暴螺旋弹第2关起才启用
        if(boss.spiralT <= 0){ boss.spiralT = 0.08; boss.spiralA += 0.42;
          eShoot(boss.x, boss.y, boss.spiralA, 150, '#ff9d3c'); eShoot(boss.x, boss.y, boss.spiralA + Math.PI, 150, '#ff9d3c'); }
      }
    }
    if(boss.hp <= 0){
      if(boss.mini){
        score += 1500;
        for(let i=0;i<3;i++)chainBooms.push({x:boss.x+rnd(-30,30),y:boss.y+rnd(-20,20),t:0.1+i*0.14}); // 连环爆：延时依次起爆
        dropItem(boss.x - 18, boss.y, true); dropItem(boss.x + 18, boss.y, true);
        boss = null; ebullets = []; spawnT = 1.2; flash = 0.3; Sfx.play('boss_boom', 0.6);
      } else {
        score += 5000; hitStop = 0.07; flash = 0.5; // 顿帧 + 连环延时爆点，收尾再来一发大爆
        for(let i=0;i<5;i++)chainBooms.push({x:boss.x+rnd(-42,42),y:boss.y+rnd(-26,26),t:0.05+i*0.16});
        chainBooms.push({x:boss.x,y:boss.y,t:0.95});
        boss = null; ebullets = []; state = 'clear'; clearT = 2.4;
        Sfx.play('boss_boom');Sfx.play('clear'); // 关底大爆 + 通关号角（BGM 保留，回 title 再停）
        grantSettleCoins(SETTLE_STAGE_CAP);
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
  const p=player;p.lives--;p.wlevel=Math.max(1,p.wlevel-1);p.mlevel=Math.max(0,p.mlevel-1);
  explode(p.x,p.y,true);flash=0.25;
  if(p.lives<=0){Sfx.play('death');gameOver();return;}
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

// 精灵恒为"大图缩小"绘制，开高质量下采样，避免缩小时出现锯齿/闪烁
try{ctx.imageSmoothingEnabled=true;if('imageSmoothingQuality' in ctx)ctx.imageSmoothingQuality='high';}catch(e){}

// 预渲染光斑精灵：径向渐变离屏画布按颜色缓存，代替逐颗子弹的 shadowBlur
//（真机上 shadowBlur 是软光栅，弹幕一多帧率崩；drawImage 光斑快一个量级且更柔）
// 关键：精灵必须按设备缩放取分辨率档。手机上逻辑 1px ≈ 2~3 物理像素，原先固定 32px 的精灵
// 被 drawImage 放大 1.3~1.7 倍，插值后发虚；取档后绘制恒为"缩小"，边缘才锐利。
const GLOW_MAX_R=50; // 单颗光斑最大绘制边长（逻辑px）：激光弹竖向拉伸后约 6*4.6*1.8≈50
const GS=clamp(Math.ceil(GLOW_MAX_R*SX/8)*8,64,192); // 光斑精灵边长（8 对齐，64~192 封顶）
const LASER_W=clamp(Math.ceil(6*1.9*SX/2)*2,24,64); // 激光弹体精灵宽：按最大弹径 r=6 的物理绘制宽取档
const glowCache={},coreCache={},laserCache={};
function hexRGB(color){
  let r=parseInt(color.slice(1,3),16),g=parseInt(color.slice(3,5),16),b=parseInt(color.slice(5,7),16);
  if(isNaN(r)||isNaN(g)||isNaN(b)){r=136;g=204;b=255;} // 非法色值兜底
  return [r,g,b];
}
function glowSprite(color){
  let s=glowCache[color];if(s)return s;
  const [r,g,b]=hexRGB(color);
  const c=wx.createCanvas();c.width=c.height=GS;
  const cx=c.getContext('2d'),h=GS/2;
  const gr=cx.createRadialGradient(h,h,0,h,h,h);
  gr.addColorStop(0,'rgba(255,255,255,0.95)');
  gr.addColorStop(0.26,`rgba(${r},${g},${b},0.85)`);
  gr.addColorStop(0.44,`rgba(${r},${g},${b},0.4)`);
  gr.addColorStop(0.74,`rgba(${r},${g},${b},0.11)`);
  gr.addColorStop(1,`rgba(${r},${g},${b},0)`);
  cx.fillStyle=gr;cx.fillRect(0,0,GS,GS);
  return glowCache[color]=c;
}
// 实心弹丸：白高光内芯 + 本色外环，硬边收敛。光晕半径 3r、弹体半径 r，弹体恒占精灵半径的
// 1/3，故一张精灵通用于所有弹径，与光斑等比叠绘即可（解决"子弹只有一团糊光"的观感）
function coreSprite(color){
  let s=coreCache[color];if(s)return s;
  const [r,g,b]=hexRGB(color);
  const S=Math.max(24,Math.round(GS/6)*2),c=wx.createCanvas();
  c.width=c.height=S;
  const cx=c.getContext('2d'),h=S/2;
  const gr=cx.createRadialGradient(h*0.78,h*0.72,0,h,h,h);
  gr.addColorStop(0,'#ffffff');
  gr.addColorStop(0.4,`rgb(${r},${g},${b})`);
  gr.addColorStop(1,`rgb(${Math.round(r*0.5)},${Math.round(g*0.5)},${Math.round(b*0.5)})`);
  cx.fillStyle=gr;cx.beginPath();cx.arc(h,h,h-0.5,0,7);cx.fill();
  return coreCache[color]=c;
}
// 激光弹弹体：竖直胶囊（亮白芯 + 本色壳），替代原 4×17 硬矩形，边缘更实、街机感更强
function laserSprite(color){
  let s=laserCache[color];if(s)return s;
  const [r,g,b]=hexRGB(color);
  const w=LASER_W,h=Math.round(w*2.2);
  const c=wx.createCanvas();c.width=w;c.height=h;
  const cx=c.getContext('2d'),rr=w/2-1;
  const gr=cx.createLinearGradient(0,0,w,0);
  gr.addColorStop(0,`rgba(${r},${g},${b},0.9)`);
  gr.addColorStop(0.4,'#ffffff');gr.addColorStop(0.6,'#ffffff');
  gr.addColorStop(1,`rgba(${r},${g},${b},0.9)`);
  cx.fillStyle=gr;
  cx.beginPath();cx.arc(w/2,rr+1,rr,Math.PI,0);cx.arc(w/2,h-rr-1,rr,0,Math.PI);
  cx.closePath();cx.fill();
  return laserCache[color]=c;
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
  // 机体随武器等级进化/退化（战机分级-01..04）；CDN 未就绪时回退程序化机体
  const img=CDN.get('战机分级-0'+clamp(p.wlevel,1,4));
  if(img){
    const w=PW,h=w*img.height/img.width; // 按宽度统一机体尺寸（原按高度 38px 绘制过小）
    ctx.drawImage(img,-w/2,-h/2,w,h);
  }else{ctx.scale(PW/34,PW/34);drawShipShape(SHIPS[shipIdx]);} // 程序化回退机体同步放大
  ctx.fillStyle='#fff';ctx.fillRect(-1,-1,2,2); // 街机式可见判定点
  ctx.restore();
}
// 敌机图鉴（CDN 素材，素材机头均朝下即朝向玩家）；[素材名, 绘制边长]
const ENEMY_IMG={grunt:['敌机-01',40],weaver:['敌机-02',46],diver:['敌机-03',40],turret:['敌机-04',50]};
function drawEnemy(e){
  ctx.save();ctx.translate(e.x,e.y);
  if(e.flash > 0) e.flash -= 0.05;
  const ei=ENEMY_IMG[e.type],img=ei&&CDN.get(ei[0]);
  if(img){
    if(e.type==='diver')ctx.rotate(Math.atan2(player.y-e.y,player.x-e.x)-Math.PI/2); // 机头指向玩家（修正原朝向公式）
    const s=ei[1];
    if(e.flash>0){ctx.globalCompositeOperation='lighter';ctx.drawImage(img,-s/2,-s/2,s,s); // 受击白闪：加亮叠绘
      ctx.globalCompositeOperation='source-over';}
    ctx.drawImage(img,-s/2,-s/2,s,s);
    ctx.restore();return;
  }
  const col = e.flash > 0 ? '#ffffff' : (
    e.type==='grunt'?'#e0555f':e.type==='weaver'?'#b06ae0':e.type==='diver'?'#ff8c42':'#6b7280'
  );
  if(e.type==='grunt'){ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(0,10);ctx.lineTo(-11,-8);ctx.lineTo(0,-3);ctx.lineTo(11,-8);ctx.closePath();ctx.fill();
    ctx.fillStyle='#ffd0d0';ctx.fillRect(-2,-4,4,4);}
  else if(e.type==='weaver'){ctx.fillStyle=col;ctx.beginPath();ctx.ellipse(0,0,13,8,0,0,7);ctx.fill();
    ctx.fillStyle='#f0d0ff';ctx.beginPath();ctx.arc(0,0,4,0,7);ctx.fill();}
  else if(e.type==='diver'){ctx.rotate(Math.atan2(player.y-e.y,player.x-e.x)-Math.PI/2);
    ctx.fillStyle=col;ctx.beginPath();ctx.moveTo(0,12);ctx.lineTo(-9,-9);ctx.lineTo(0,-4);ctx.lineTo(9,-9);ctx.closePath();ctx.fill();}
  else if(e.type==='turret'){ctx.fillStyle=col;ctx.fillRect(-14,-8,28,16);
    ctx.fillStyle='#9ca3af';ctx.fillRect(-4,-14,8,10);ctx.fillStyle='#ff5d5d';ctx.beginPath();ctx.arc(0,0,4,0,7);ctx.fill();}
  ctx.restore();
}
function drawBoss(b){
  ctx.save();ctx.translate(b.x,b.y);
  if(b.mini)ctx.scale(0.55,0.55); // 小 Boss 用同款机体缩小绘制
  const img=CDN.get('Boss-01'); // 素材机头朝下（朝向玩家），无需翻转
  if(img){
    const w=112,h=w*img.height/img.width;
    ctx.drawImage(img,-w/2,-h/2,w,h);
    ctx.restore();return;
  }
  ctx.fillStyle='#4b5563';ctx.beginPath();ctx.ellipse(0,0,46,26,0,0,7);ctx.fill();
  ctx.fillStyle='#374151';ctx.fillRect(-46,-8,92,20);
  ctx.fillStyle='#1f2937';ctx.beginPath();ctx.arc(-28,4,10,0,7);ctx.arc(28,4,10,0,7);ctx.fill();
  const rage=b.hp<b.maxhp*0.5;
  ctx.fillStyle=rage?'#ff3b3b':'#ffd23c';ctx.beginPath();ctx.arc(0,-6,9,0,7);ctx.fill();
  ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(0,-6,4,0,7);ctx.fill();
  ctx.restore();
}
// 道具图鉴（全部走 CDN 素材，CDN 未就绪/失败回退字母方块）
const ITEM_IMG={
  'w:homing':'Buff道具-02',  // R 追踪武器 → 橙色散射箭头
  'w:laser':'掉落物-02',     // B 激光武器 → 青色激光晶体
  'm:homing':'Buff道具-06',  // Y 追踪导弹 → 金色闪电
  'm:laser':'掉落物-03',     // P 激光导弹 → 紫红晶簇
  bomb:'Buff道具-04',        // M 炸弹 → 红色炸弹
  score:'掉落物-06'          // S 得分 → 金星徽章
};
function drawItem(it){
  const img=CDN.get(ITEM_IMG[it.kind==='w'||it.kind==='m'?it.kind+':'+it.val:it.kind]);
  if(img){
    const s=26;
    ctx.save();ctx.translate(it.x,it.y);ctx.drawImage(img,-s/2,-s/2,s,s);ctx.restore();
    return;
  }
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
  if(state==='settings'){Settings.draw(ctx,W,H);overlay();Ads.draw(ctx);return;} // 设置页：独立全屏页面，不叠在标题页上
  if(state==='title'||state==='rank'){drawTitle();if(state==='rank')Rank.draw(ctx,W,H);overlay();Ads.draw(ctx);return;}
  // 实体
  for(const it of items)drawItem(it);
  for(const e of enemies)drawEnemy(e);
  if(boss)drawBoss(boss);
  ctx.save();
  ctx.globalCompositeOperation='lighter'; // 光斑叠加混合，弹幕更亮更通透
  for(const b of bullets){
    if(b.laser){const R=b.r*4.6,g=glowSprite(b.color);ctx.drawImage(g,b.x-R/2,b.y-R*0.9,R,R*1.8);}
    else{const R=b.r*6,g=glowSprite(b.color);ctx.drawImage(g,b.x-R/2,b.y-R/2,R,R);}
  }
  for(const b of ebullets){const R=b.r*5,g=glowSprite(b.color);ctx.drawImage(g,b.x-R/2,b.y-R/2,R,R);}
  ctx.restore();
  // 己方弹体硬核心：光晕之上再叠实心弹丸（source-over 不叠亮过度），手机上才有清晰轮廓
  for(const b of bullets){
    if(b.laser){const s=laserSprite(b.color),w=b.r*1.9,h=w*s.height/s.width;
      ctx.drawImage(s,b.x-w/2,b.y-h/2,w,h);}
    else{const d=b.r*2.4,c=coreSprite(b.color);ctx.drawImage(c,b.x-d/2,b.y-d/2,d,d);}
  }
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
    const blink=Math.floor(Date.now()/140)%2===0;
    ctx.globalAlpha=Math.min(1,warnT)*(blink?0.95:0.5);
    ctx.fillStyle='#ff2244';ctx.textAlign='center';ctx.font='bold 24px monospace';
    ctx.fillText(boss&&boss.mini?'警 告 · 精 英 接 近':'警 告 · 首 领 接 近',W/2,H*0.3);
    ctx.fillRect(W*0.12,H*0.3+18,W*0.76,2);
    ctx.globalAlpha=1;ctx.textAlign='left';
  }
  if(flash>0){ctx.fillStyle=`rgba(255,255,255,${flash})`;ctx.fillRect(-20,-20,W+40,H+40);}
  if(state==='clear'){
    ctx.textAlign='center';
    UI.drawNeonPanel(ctx,W/2-160,H/2-90,320,260,'战区肃清','#7dff8c');
    ctx.save();ctx.shadowColor='#7dff8c';ctx.shadowBlur=20;
    ctx.fillStyle='#7dff8c';ctx.font='bold 38px monospace';
    ctx.fillText('通关成功',W/2,H/2-15);ctx.restore();
    ctx.fillStyle='#fff';ctx.font='16px monospace';
    ctx.fillText(`第 ${stage} 关通过 · 得分 ${score}`,W/2,H/2+30);
    if(settleCoins>0){
      ctx.fillStyle='#ffe600';ctx.font='bold 15px monospace';
      ctx.fillText('金币 +'+(settleDoubled?settleCoins*2:settleCoins)+(settleDoubled?' · 已翻倍':''),W/2,H/2+48);
    }
    if(clearT<=0){ // 动画结束显示选择按钮，由玩家决定是否继续
      for(const b of CLEAR_BTNS){ // 标题传空：按钮文字只画居中一遍，避免与面板标题重复叠字
        UI.drawNeonPanel(ctx,b.x,b.y,b.w,b.h,'',b.act==='next'?'#7dff8c':'#8899aa');
        ctx.fillStyle='#fff';ctx.font='bold 15px monospace';
        ctx.fillText(b.t,b.x+b.w/2,b.y+34);
      }
      if(settleCoins>0&&!settleDoubled){
        UI.drawNeonPanel(ctx,CLEAR_COIN_BTN.x,CLEAR_COIN_BTN.y,CLEAR_COIN_BTN.w,CLEAR_COIN_BTN.h,'','#ffe600');
        ctx.fillStyle=reviving?'#666':'#ffe600';ctx.font='bold 15px monospace';
        ctx.fillText(reviving?'加载中...':'▶ 看广告 金币翻倍',CLEAR_COIN_BTN.x+CLEAR_COIN_BTN.w/2,CLEAR_COIN_BTN.y+25);
      }
    }}
  if(state==='over'){
    ctx.fillStyle='rgba(0,0,0,0.7)';ctx.fillRect(0,0,W,H);
    ctx.textAlign='center';
    UI.drawNeonPanel(ctx,W/2-160,H/2-125,320,288,'最终战报','#ff0055');
    ctx.save();ctx.shadowColor='#ff0055';ctx.shadowBlur=25;
    ctx.fillStyle='#ff0055';ctx.font='bold 42px monospace';
    ctx.fillText('游戏结束',W/2,H/2-60);ctx.restore();
    ctx.fillStyle='#fff';ctx.font='bold 20px monospace';
    ctx.fillText('得分  '+String(score).padStart(7,'0'),W/2,H/2-10);
    ctx.fillStyle='#ffe600';ctx.font='14px monospace';
    ctx.fillText('最高分  '+String(hi).padStart(7,'0'),W/2,H/2+20);
    if(settleCoins>0){
      ctx.fillStyle='#ffe600';ctx.font='bold 15px monospace';
      ctx.fillText('金币 +'+(settleDoubled?settleCoins*2:settleCoins)+(settleDoubled?' · 已翻倍':''),W/2,H/2+42);
    }
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
    if(settleCoins>0&&!settleDoubled){
      UI.drawNeonPanel(ctx,OVER_COIN_BTN.x,OVER_COIN_BTN.y,OVER_COIN_BTN.w,OVER_COIN_BTN.h,'','#ffe600');
      ctx.fillStyle=reviving?'#666':'#ffe600';ctx.font='bold 15px monospace';
      ctx.fillText(reviving?'加载中...':'▶ 看广告 金币翻倍',OVER_COIN_BTN.x+OVER_COIN_BTN.w/2,OVER_COIN_BTN.y+25);
    }
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
    ctx.fillText(msg,W/2,H/2+188);ctx.restore();
  }
  overlay();
  Ads.draw(ctx); // 模拟激励视频为覆盖层，最后绘制压在所有 UI 之上
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

  // 底部文案整体上移，让开刘海屏手势条（否则"最高分"会被压在遮挡区里）
  const tbi=bottomInset();
  ctx.fillStyle=Math.floor(Date.now()/400)%2?'#00f3ff':'#ff0055';
  ctx.font='bold 22px monospace';ctx.fillText('▶ 点击屏幕开始战斗 ◀',W/2,H-170-tbi);

  ctx.fillStyle='#9ca3af';ctx.font='14px monospace';ctx.fillText('最高分: '+String(hi).padStart(7,'0'),W/2,H-130-tbi);

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
  // 全局声音开关（顶部居中喇叭）：双开亮绿，任一关闭即灰暗静音样式
  const sndOn=Sfx.sfxOn&&Sfx.bgmOn;
  UI.drawNeonPanel(ctx,SND_BTN.x,SND_BTN.y,SND_BTN.w,SND_BTN.h,'',sndOn?'#ffe600':'#4a5568');
  drawSpeaker(SND_BTN.x+24,SND_BTN.y+20,sndOn);
  ctx.fillStyle=sndOn?'#fff3b0':'#6b7686';ctx.font='bold 14px monospace';ctx.textAlign='left';
  ctx.fillText(sndOn?'声音':'静音',SND_BTN.x+42,SND_BTN.y+25);
  ctx.textAlign='center';
}
// 喇叭图标：箱体+锥形+声波弧（开）/斜杠（静音），程序化绘制避免字形渲染差异
function drawSpeaker(x,y,on){
  ctx.save();
  ctx.strokeStyle=ctx.fillStyle=on?'#ffe66d':'#6b7686';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(x-9,y-4);ctx.lineTo(x-3,y-4);ctx.lineTo(x+4,y-11);
  ctx.lineTo(x+4,y+11);ctx.lineTo(x-3,y+4);ctx.lineTo(x-9,y+4);ctx.closePath();ctx.fill();
  if(on){
    ctx.beginPath();ctx.arc(x+6,y,7,-0.9,0.9);ctx.stroke();
    ctx.beginPath();ctx.arc(x+6,y,12,-0.8,0.8);ctx.stroke();
  }else{
    ctx.strokeStyle='#ff5d7a';ctx.lineWidth=2.5;
    ctx.beginPath();ctx.moveTo(x+7,y-8);ctx.lineTo(x+16,y+8);
    ctx.moveTo(x+16,y-8);ctx.lineTo(x+7,y+8);ctx.stroke();
  }
  ctx.restore();
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
    ctx.fillStyle=Math.floor(Date.now()/300)%2?'#ff5d5d':'#ffe600';
    ctx.font='bold 20px monospace';
    ctx.fillText(boss.mini?'精英!!':'首领!!',W/2,HUD_TOP+40);
  }else{
    const cd=Math.max(0,Math.ceil(bossAt()-elapsed));
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

  // 高能炸弹圆盘按钮（随手势条高度上移避让）
  const bp=bombPos();
  UI.drawBombButton(ctx, bp.x, bp.y, 35, player.bombs, player.bombs > 0);

  // 右上角静音喇叭（仅战斗中显示与响应，结算/暂停页不出现避免误触死区）
  if (state === 'playing') drawSpeaker(W-26, HUD_TOP+12, Sfx.sfxOn && Sfx.bgmOn);

  if(boss){
    UI.drawBossBar(ctx, W, H, boss.hp, boss.maxhp, bottomInset());
  }
}

// ---------- 主循环 ----------
let last=Date.now(); // 真机基础库无全局 performance（模拟器/Node 环境有，测不出来），全游戏统一用 Date.now()
function loop(){
  const nowMs=Date.now();
  const dt=Math.min(0.05,(nowMs-last)/1000);last=nowMs;
  if(msgT>0)msgT-=dt;
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
