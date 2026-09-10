
"use strict";
const UI = require('./ui.js');
const T = require('./theme.js'); // 军武航空仪表静态主题 token
const Ads = require('./ads.js');
const Rank = require('./rank.js');
const CDN = require('./cdn.js');
const Settings = require('./settings.js'); // 设置页（独立全屏页面：左侧菜单 + 右侧内容区）
const Sfx = require('./sfx.js'); // SFX 池 + BGM（assets/audio wav 打包进包，BGM 走 CDN）
// CDN 素材预热：开机即后台拉取（未就绪期间各绘制函数回退程序化画法，游戏不受影响）
CDN.preload(['Boss-01','战机分级-01','战机分级-02','战机分级-03','战机分级-04',
  'Buff道具-02','Buff道具-06','掉落物-02','掉落物-03','掉落物-06',
  '敌机-01','敌机-02','敌机-03','敌机-04']);
const cv=wx.createCanvas(),ctx=cv.getContext('2d');
// 画布分辨率 = 逻辑尺寸 × DPR（钳 1~2；__beian_hd 调试标志可强制 3）。微信主画布默认只有逻辑
// 像素（如 375×667），真机上被 GPU 拉伸到物理面板导致全屏发虚、文字最明显；按 DPR 起画布后所有
// 绘制仍走 setTransform(SX..) 等比映射，光斑/激光精灵分辨率档位随 SX 自动跟上。上限 2 兼顾低端机填充率
const beianHd=(()=>{try{return !!wx.getStorageSync('__beian_hd');}catch(e){return false;}})();
try{
  const bi=(typeof wx.getWindowInfo==='function')?wx.getWindowInfo():wx.getSystemInfoSync();
  const dpr=beianHd?3:Math.min(Math.max(bi.pixelRatio||2,1),2);
  cv.width=Math.round(bi.windowWidth*dpr);
  cv.height=Math.round(bi.windowHeight*dpr);
}catch(e){}
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
// 微信胶囊按钮（右上角"… ⊙"）下缘换算到游戏坐标：胶囊是系统层，画布绘制压不住、点它还会唤起
// 小程序菜单，顶部功能元素必须整体让到其下。接口失败时按"状态栏+32px 胶囊"折算保守兜底
let capBottom=0;
try{
  const mb=(typeof wx.getMenuButtonBoundingClientRect==='function')?wx.getMenuButtonBoundingClientRect():null;
  if(mb&&mb.height>0)capBottom=Math.round(mb.bottom*H/winH);
}catch(e){}
if(!isFinite(capBottom)||capBottom<=0)capBottom=safeTop+46;
// 设计分辨率 W×H → 实际画布（设备像素）的绘制缩放；画布尺寸异常时回退 1:1，避免 NaN 变换导致黑屏
const SX=(cv.width&&cv.width>0)?cv.width/W:1,SY=(cv.height&&cv.height>0)?cv.height/H:1;
function fit(){}

const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const rnd=(a,b)=>a+Math.random()*(b-a);
// storage 容错包装：读档/存档抛异常（存储满、基础库异常）不允许带崩冷启动或整局流程
const lsGet=(k,d)=>{try{const v=wx.getStorageSync(k);return(v===''||v==null)?d:v;}catch(e){return d;}};
const lsSet=(k,v)=>{try{wx.setStorageSync(k,v);}catch(e){}};


// ---------- 全局状态 ----------
let state='title',stage=1,score=0,hi=+(lsGet('nulei_hi',0))||0;
let elapsed=0,runTime=0,spawnT=1,boss=null,clearT=0,shake=0,flash=0,miniSpawned=false,warnT=0,hitStop=0;
const BOSS_AT=55; // 常规关卡 Boss 出现时间（秒），HUD 倒计时与刷怪逻辑共用
const BOSS_MINI_AT=25; // 小 Boss（精英）出场时间（秒），第2关起每关一次
const bossAt=()=>stage===1?35:BOSS_AT; // 第1关 Boss 提前登场，缩短新手关时长
let bullets=[],ebullets=[],enemies=[],items=[],parts=[],shockwaves=[],chainBooms=[],meteors=[],meteorT=4,eid=0;
const PW=54; // 玩家机体显示宽度（雷电式大机型，按宽度统一各分级素材尺寸）
const player={x:W/2,y:H-90,r:5,hp:100,maxHp:100,inv:2,weapon:'std',wlevel:2,mis:'none',mlevel:0,fireT:0,misT:0,_switchedOnce:false,_misSwitchedOnce:false,
  buffs:{},shield:0,shieldT:0}; // v0.2 血条制：hp/maxHp 替代旧 lives 命数；wlevel 起步 2（掉落退役后武器成长走补给站，开局自带双联装）


const HUD_TOP=Math.max(safeTop+8,capBottom+8); // 顶部 HUD 起始 y：刘海之下，且低于右上角微信胶囊
const HUD_H=76;
const PLAY_TOP=HUD_TOP+HUD_H; // 玩家可移动的最高位置与 HUD 实际底部一致
// 触摸坐标：屏幕逻辑像素 → 游戏坐标（480×H 等比映射，H 已随设备比例自适应）
const toGame=t=>({x:t.clientX*W/winW,y:t.clientY*H/winH});
// 广告模块初始化：仅激励视频（复活/金币翻倍，玩家主动触发），无常驻 Banner
Ads.setup({gameW:W,gameH:H,topSafe:HUD_TOP}); // topSafe：模拟广告跳过按钮避开微信胶囊
// bottomInset 用惰性取值：本行在其 const 定义之前执行，直接传引用会踩 TDZ
Rank.setup({sx:SX,sy:SY,bottomInset:()=>bottomInset(),onClose:()=>{state='title';}});
// 底部不可用高度：让开刘海屏底部的手势条，避免误触上滑返回桌面
const bottomInset=()=>safeBottom;
const playBottom=()=>H-44-bottomInset(); // 玩家可移动的最低位置（机体半高留量 + 让开手势条）

// 复活流程（激励视频）
const MAX_REVIVE=2;
let reviveUsed=0,reviving=false,msg='',msgT=0;
const REVIVE_BTN={x:W/2-150,y:H/2+52,w:145,h:48};
const restartRect=()=>reviveUsed<MAX_REVIVE&&!ADS_OFF?{x:W/2+5,y:H/2+52,w:145,h:48}:{x:W/2-72,y:H/2+52,w:144,h:48};
// 结算金币（v0.2.0）：金币为局内货币（商店购牌），死亡/返回主页时剩余按 1/5 折算为局外存款，可看广告翻倍一次
let settleDoubled=false,runSettled=false; // runSettled：本局是否已入账，防止死亡结算与回标题二次折算
const OVER_COIN_BTN={x:W/2-140,y:H/2+112,w:280,h:38};
function convertLeftoverCoins(){
  if(runSettled)return; // 幂等：gameOver 与 goTitle 都可能触达，只入账一次
  runSettled=true;
  settleConverted=Math.ceil(runCoins/5);
  if(settleConverted>0){coins+=settleConverted;saveCoins();}
  settleDoubled=false;
}
function requestSettleDouble(){
  if(ADS_OFF||reviving||settleDoubled||settleConverted<=0)return;
  reviving=true;
  Ads.playRewarded(ok=>{
    reviving=false;
    if(ok===true){coins+=settleConverted;saveCoins();settleDoubled=true;Sfx.play('coin');}
    else toast(ok===null?'广告暂不可用，请稍后再试':'需完整观看广告才能翻倍');
  });
}
const WPN_ZH={std:'机炮',homing:'追踪',laser:'激光'}; // HUD 武器中文名
// 暂停菜单按钮（双击屏幕呼出）
const PAUSE_BTNS=[ // 飞控冻结面板按钮（顺序/文案/热区不变，仅换军武语义色）
  {x:W/2-100,y:H/2-84,w:200,h:44,c:T.ok,t:'继续游戏'},
  {x:W/2-100,y:H/2-28,w:200,h:44,c:T.danger,t:'重新开始'},
  {x:W/2-100,y:H/2+28,w:200,h:44,c:T.amber,t:'回到标题'},
];
const inRect=(t,b)=>t.x>=b.x&&t.x<=b.x+b.w&&t.y>=b.y&&t.y<=b.y+b.h;
function toast(s){msg=s;msgT=2.2;}
function requestRevive(){
  if(ADS_OFF||reviving||reviveUsed>=MAX_REVIVE)return;
  reviving=true;
  Ads.playRewarded(ok=>{
    reviving=false;
    if(ok===true)revive();
    else toast(ok===null?'广告暂不可用，请稍后再试':'需完整观看广告才能复活');
  });
}
function revive(){
  reviveUsed++;state='playing';
  player.hp=Math.ceil(player.maxHp/2);player.inv=3; // 复活半血
  ebullets=[];
  for(const e of enemies){if((e.x-player.x)**2+(e.y-player.y)**2<160**2)e.y=-60;}
  Sfx.play('upgrade');
}

// ---------- 金币与升级（看广告领金币；掉率/火力升级预留） ----------
let coins=Number(lsGet('nulei_coins',0))||0;
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
let shipIdx=lsGet('nulei_ship',0)||0;if(!(shipIdx>=0&&shipIdx<SHIPS.length))shipIdx=0;
let bgIdx=lsGet('nulei_bg',0)||0;if(!(bgIdx>=0&&bgIdx<BGS.length))bgIdx=0;
const saveShip=()=>lsSet('nulei_ship',shipIdx);
const saveBg=()=>lsSet('nulei_bg',bgIdx);
const SHIP_PRICE=[0,800,1500],BG_PRICE=[0,400,800]; // 皮肤/背景解锁价（0=免费），下标与 SHIPS/BGS 对应
let owned=Object.assign({ships:[true,false,false],bgs:[true,false,false]},lsGet('nulei_owned',{}));
if(!Array.isArray(owned.ships)||owned.ships.length!==SHIPS.length)owned.ships=SHIPS.map((_,i)=>i===0);
if(!Array.isArray(owned.bgs)||owned.bgs.length!==BGS.length)owned.bgs=BGS.map((_,i)=>i===0);
if(!owned.ships[shipIdx])shipIdx=0;
if(!owned.bgs[bgIdx])bgIdx=0;
const saveOwned=()=>lsSet('nulei_owned',owned);
const TIPS=['[ 拖动屏幕 ] 控制战机移动并自动射击','[ 击杀敌机 ] 拾取金币袋 · 小心掉血','[ 血条见底 ] 战机损毁 · 无敌帧内穿过弹幕','[ 中心小白点 ] 战机核心判定区','[ 双击屏幕 ] 暂停 / 继续','[ Boss 通关 ] 补给站金币购牌 · 升级主炮/导弹/维修'];
const SET_BTN={x:W-92,y:HUD_TOP+4,w:80,h:40}; // 主页右上角设置入口（打开独立设置页）
const RANK_BTN={x:20,y:HUD_TOP+4,w:80,h:40}; // 主页左上角排行榜入口（与设置入口镜像）
const SND_BTN={x:W/2-40,y:HUD_TOP+4,w:80,h:40}; // 主页顶部居中：全局声音总开关（SFX+BGM 一键全关/全开）
// 标题屏静态绘制对象：提为模块级常量，避免每帧分配（评审 P2 收口）
const TITLE_NAMEPLATE={x:38,y:158,w:W-76,h:118}; // 任务铭牌矩形
const TITLE_KEY_SET={x:SET_BTN.x,y:SET_BTN.y,w:SET_BTN.w,h:SET_BTN.h};
const TITLE_KEY_RANK={x:RANK_BTN.x,y:RANK_BTN.y,w:RANK_BTN.w,h:RANK_BTN.h};
const TITLE_KEY_SND={x:SND_BTN.x,y:SND_BTN.y,w:SND_BTN.w,h:SND_BTN.h};
const TITLE_SIL_SKIN={body:'#131924',fin:'#0F141E',trail:null}; // 待机剪影涂装（trail=null 不画拖尾，防随机闪跳）
const TITLE_SIGNS=[-1,1];
// 战斗中静音按钮放顶部左上角（得分左侧，与主页顶部声音开关呼应）：右上角是微信胶囊按钮地盘，放那儿会被盖住还可能误触退出菜单
const mutePos=()=>({x:26,y:HUD_TOP+27}); // 与 drawHUD 中的小喇叭位置保持一致
const REWARD_COINS=50; // 每次完整观看激励视频奖励金币
// 上线首版隐藏全部广告入口（流量主未开通，模拟广告不宜提审）；开通后置 false 恢复全部入口
const ADS_OFF=true;
// 新手引导（极简版）：仅首次游戏开局 8 秒显示操作提示，看满写档永不再出（30 秒内知道怎么玩）
let tutDone=!!lsGet('nulei_tut',false);
const VERSION='0.2.4'; // 与 version.json 的 latest 保持一致（设置页"关于"展示）
// 升级项预留：数值效果已接入掉率(dropItem)与伤害(update)，商店 UI 上线后调 buyUpgrade 即可
const UPGRADES={
  drop:{max:5,cost:l=>120*(l+1),val:l=>1+l*0.25}, // 掉落率：每级 +25%（关卡基础值 dropRate() × 倍率）
  power:{max:5,cost:l=>150*(l+1),val:l=>1+l*0.1}, // 火力强度：每级 +10% 伤害
};

// ---------- 局内肉鸽（v0.2.0 土豆兄弟式波次商店）：Boss 通关进商店，局内金币多轮购牌，构筑=主动经济决策 ----------
const BUFFS=[
  {id:'dmg',   name:'弹头强化', rar:'N', max:5, letter:'攻', desc:'所有伤害 +25%'},
  {id:'rapid', name:'速射装置', rar:'N', max:4, letter:'速', desc:'主炮射速 +18%'},
  {id:'wing',  name:'翼炮扩展', rar:'N', max:3, letter:'翼', desc:'主炮增 1 对侧翼斜射弹'},
  {id:'big',   name:'重型弹头', rar:'N', max:3, letter:'重', desc:'主炮弹径+ 伤害+10%'},
  {id:'magnet',name:'磁力吸附', rar:'N', max:3, letter:'磁', desc:'道具拾取范围 +12'},
  {id:'drop',  name:'幸运徽章', rar:'N', max:3, letter:'运', desc:'道具掉落率 +30%'},
  {id:'greed', name:'贪婪芯片', rar:'N', max:3, letter:'财', desc:'击杀金币 +20%'},
  {id:'armor', name:'纳米装甲', rar:'N', max:2, letter:'甲', desc:'生命上限+25 并立即回复25'},
  {id:'invuln',name:'相位涂层', rar:'N', max:2, letter:'隐', desc:'受击无敌时间 +0.5秒'},
  {id:'crit',  name:'暴击核心', rar:'R', max:3, letter:'暴', desc:'12% 概率双倍伤害'},
  {id:'laser', name:'激光增幅', rar:'R', max:3, letter:'激', desc:'激光伤害+40% 弹径+'},
  {id:'missile',name:'蜂巢导弹',rar:'R', max:3, letter:'蜂', desc:'导弹每轮 +1 发'},
  {id:'shield',name:'能量护盾', rar:'R', max:3, letter:'盾', desc:'护盾每25秒重挡1次伤害'},
  {id:'fix',   name:'紧急维修', rar:'R', max:1, letter:'修', desc:'受击不再降武器等级'},
  {id:'mini',  name:'微型机体', rar:'R', max:2, letter:'微', desc:'受击判定缩小 30%'},
  {id:'rear',  name:'尾部机炮', rar:'R', max:2, letter:'尾', desc:'增 1 发尾向直射弹'},
  {id:'over',  name:'超频协议', rar:'R', max:1, letter:'超', desc:'射速+35% 受击后失效'},
  // —— 核心牌（0.2.x 流派核心）：每局限 1 张，构筑从"数值堆叠"升级为"流派承诺"；need 不满足不进池 ——
  {id:'c_swarm',name:'翼炮阵列', rar:'R', max:1, letter:'阵', core:true, need:()=>buffLv('wing')>0, desc:'翼炮每对侧翼弹变双联'},
  {id:'c_prism',name:'三棱镜',   rar:'R', max:1, letter:'棱', core:true, need:()=>player.weapon==='laser', desc:'主激光分裂为 3 束平行光'},
  {id:'c_hive', name:'饱和轰击', rar:'R', max:1, letter:'饱', core:true, need:()=>player.mis!=='none', desc:'导弹每轮装弹数翻倍'},
  {id:'c_phase',name:'相转移装甲',rar:'R', max:1, letter:'移', core:true, need:()=>buffLv('shield')>0, desc:'护盾重置间隔 25→12秒'},
];
const RESERVE_BUFF={id:'reserve',name:'战备资金',rar:'N',max:1,letter:'储',desc:'立即 +100 金币'}; // 池抽空时的填位牌
const BUFF_BY_ID=BUFFS.reduce((m,b)=>(m[b.id]=b,m),{reserve:RESERVE_BUFF}); // 构筑摘要按 id 反查字与稀有度
const buffLv=id=>player.buffs[id]||0;
let runCoins=0,offer=[],runPicks=0,shopRefreshN=0,adRefreshUsed=false,adRefreshBusy=false,coinDoubled=false;
let runCoinsAtStage=0,runCoinIncome=0,settleConverted=0; // 本关金币收支与死亡折算
let runTopBuff={name:'',n:0}; // 结算摘要：本局拿得最多的牌
// 补给站布局（构图 B，稿见 drafts/ui/shop-redesign-v1.html）：基准 400×800 在安全区内垂直居中，
// 按可用高度等比缩放，顶部从 HUD_TOP（微信胶囊之下）起排；H 下限 800 时 K≈0.95，钳 0.85 下限防字号过细
const SHOP_K=clamp((H-HUD_TOP-safeBottom-8)/800,0.85,1);
const SHOP_PANEL={x:W/2-200*SHOP_K,y:0,w:400*SHOP_K,h:800*SHOP_K};
SHOP_PANEL.y=Math.round(HUD_TOP+(H-HUD_TOP-safeBottom-8-SHOP_PANEL.h)/2);
// 设计稿坐标(面板相对) → 实际矩形；绘制与 inRect 命中判定共用同一份坐标
const sr=(x,y,w,h)=>({x:SHOP_PANEL.x+x*SHOP_K,y:SHOP_PANEL.y+y*SHOP_K,w:w*SHOP_K,h:h*SHOP_K});
const sx=v=>SHOP_PANEL.x+v*SHOP_K, sy=v=>SHOP_PANEL.y+v*SHOP_K;
const sn=v=>v*SHOP_K;                      // 设计稿长度 → 实际像素
const sbl=n=>n*0.62*SHOP_K;                // 字号 → 文本框视觉中线偏移（配合 textBaseline='middle'）
const SFS=(n,b)=>(b?'bold ':'')+Math.max(10,Math.round(n*SHOP_K))+'px '+T.fontData; // 数据字号随面板缩放（下限 10：低于此真机 CJK 笔画粘连）
const SFL=(n,b)=>(b?'bold ':'')+Math.max(10,Math.round(n*SHOP_K))+'px '+T.fontUI;   // 中文标签字号（sans-serif）
const SHOP_HEAD=sr(14,12,372,36);
const SHOP_CARDS=[0,1,2].map(i=>sr(20,118+i*120,360,96));       // 卡间距 24
const SHOP_SEC={x:sx(20),y:sy(466),w:360*SHOP_K};
const SHOP_FIX_CARDS=[0,1,2,3].map(i=>sr(20+i*93,492,81,76));   // 项间距 12
const SHOP_REFRESH=sr(20,592,174,48), SHOP_GO=sr(206,592,174,48); // 按钮间距 12
const SHOP_ADCOIN=sr(20,656,360,44);                            // 热区高 44
const SHOP_BUILD=sr(20,730,360,50);
// 触控下限换算：brief 的 44 是逻辑 px，而设计宽固定 480（窄屏 1 设计 px < 1 逻辑 px），
// 故只把"命中矩形"按设备补足，绘制仍用构图 B 的视觉高度，版式不变
const SHOP_HIT_H=44*W/winW;
const shopHit=r=>{const pad=Math.max(0,(SHOP_HIT_H-r.h/SHOP_K)/2)*SHOP_K;return{x:r.x,y:r.y-pad,w:r.w,h:r.h+pad*2};};
// 补给站固定升级项：掉落退役后武器/血线的确定性消费通道（与随机牌互补）
const SHOP_FIX=[
  {id:'gun',  name:'主炮强化', cost:()=>50+30*player.wlevel, can:()=>player.wlevel<4, buy(){player.wlevel++;}},
  {id:'laser',name:'激光改造', cost:()=>150, can:()=>player.weapon!=='laser'&&player.wlevel>=2, buy(){player.weapon='laser';}},
  {id:'mis',  name:'导弹吊舱', cost:()=>80+40*player.mlevel, can:()=>player.mlevel<3, buy(){if(player.mis==='none')player.mis='homing';player.mlevel=Math.min(3,player.mlevel+1);}},
  {id:'fix',  name:'战场维修', cost:()=>50, can:()=>player.hp<player.maxHp, buy(){player.hp=Math.min(player.maxHp,player.hp+40);}},
];
function buyFix(i){ // 固定项购买：满级/不适用置灰，买不起提示
  const f=SHOP_FIX[i];if(!f||!f.can())return;
  const c=f.cost();
  if(runCoins<c){toast('金币不足');Sfx.play('click');return;}
  runCoins-=c;f.buy();Sfx.play('upgrade');
}
// 牌价：基础价 × 关卡通胀 × 同名已购溢价；刷新费随次数与关卡递增（每关重置）
const BUFF_PRICE_BASE={N:40,R:100};
const priceOf=b=>b.id==='reserve'?30:b.core?Math.round(300*(1+0.2*(stage-1))):Math.round(BUFF_PRICE_BASE[b.rar]*(1+0.2*(stage-1))*(1+0.5*buffLv(b.id))); // 核心牌：高价一件式，不吃同名溢价
const refreshCost=()=>Math.round(20*(1+0.5*shopRefreshN)*(1+0.2*(stage-1)));
// 局内金币唯一入账口（贪婪芯片加成）；runCoinIncome 只记自然收入供"本关金币翻倍"用
function addCoin(n,bonus){const v=Math.round(n*(1+0.2*buffLv('greed')));runCoins+=v+(bonus||0);runCoinIncome+=v;}
// 伤害综合倍率：局外火力强化 × 局内弹头强化
function dmgMulAll(){return UPGRADES.power.val(upVal('power'))*(1+0.25*buffLv('dmg'));}
// 子弹命中伤害统一出口（暴击在命中瞬间 roll，lastCritHit 供命中点取用，避免热点路径分配对象）
let lastCritHit=false;
function dmgOf(b){lastCritHit=Math.random()<0.12*buffLv('crit');const d=b.dmg*dmgMulAll()*(lastCritHit?2:1);return d;}
function roll3(){ // N:R=100:35 按张抽取去重；满级/前置不足的牌不进池，池不足用填位牌补位
  const pool=BUFFS.filter(b=>buffLv(b.id)<b.max&&(!b.need||b.need())),out=[];
  while(out.length<3&&pool.length){
    let tw=0;for(const b of pool)tw+=b.rar==='R'?35:100;
    let r=Math.random()*tw,pick=pool[0];
    for(const b of pool){r-=b.rar==='R'?35:100;if(r<=0){pick=b;break;}}
    out.push(pick);pool.splice(pool.indexOf(pick),1);
  }
  while(out.length<3)out.push(RESERVE_BUFF);
  // 核心牌保底：第 2 关起，前置已满足且未持有的核心必占 1 席（构筑承诺 → 核心兑现，土豆兄弟式）
  if(stage>=2&&!out.some(b=>b.core)){
    const cores=pool.filter(b=>b.core);
    if(cores.length)out[2]=cores[Math.floor(Math.random()*cores.length)];
  }
  return out;
}
function applyBuff(b){ // 纯应用，购买节奏由商店控制（多轮：买完出新三张）
  if(b.id==='reserve'){addCoin(100,true);}
  else{
    player.buffs[b.id]=(player.buffs[b.id]||0)+1;runPicks++;
    if(runTopBuff.n===0||player.buffs[b.id]>runTopBuff.n)runTopBuff={name:b.name,n:player.buffs[b.id]};
    if(b.id==='armor'){player.maxHp+=25;player.hp=Math.min(player.maxHp,player.hp+25);} // 纳米装甲：血条制下=上限+25 并回 25
    else if(b.id==='mini'){player.r=5*(1-0.3*player.buffs.mini);}
    else if(b.id==='shield'){player.shield=player.buffs.shield;player.shieldT=0;}
  }
  Sfx.play('upgrade');
}
function buyCard(i){ // 商店购牌：扣金币→应用→出新三张（多轮选择）
  const b=offer[i];if(!b)return;
  const p=priceOf(b);
  if(runCoins<p){toast('金币不足');Sfx.play('click');return;}
  runCoins-=p;applyBuff(b);offer=roll3();
}
function enterShop(){ // Boss 通关 clear 动画结束后进入：每关一次选购节点
  state='shop';offer=roll3();shopRefreshN=0;adRefreshUsed=ADS_OFF;coinDoubled=false;
  // 土豆兄弟式波末自动回收：场上残留金币袋直接入账（避免冻结半空/滚入下一关收入）
  for(const it of items)if(it.kind==='coin')addCoin(it.coin);
  items=[];Sfx.play('coin');
}
function requestShopRefresh(){ // 刷新两用：优先看广告免费刷（每关 1 次），已用则金币刷（费用递增）
  if(adRefreshBusy||state!=='shop')return;
  if(!adRefreshUsed&&!ADS_OFF){
    adRefreshBusy=true;
    Ads.playRewarded(ok=>{
      adRefreshBusy=false;
      if(ok===true){adRefreshUsed=true;offer=roll3();Sfx.play('upgrade');}
      else toast(ok===null?'广告暂不可用，请稍后再试':'需完整观看才能免费刷新');
    });
    return;
  }
  const c=refreshCost();
  if(runCoins<c){toast('金币不足');Sfx.play('click');return;}
  runCoins-=c;shopRefreshN++;offer=roll3();Sfx.play('click');
}
function requestCoinDouble(){ // 本关金币收入翻倍（每关 1 次，仅商店内）
  if(ADS_OFF||coinDoubled||adRefreshBusy||state!=='shop'||runCoinIncome<=0)return;
  adRefreshBusy=true;
  Ads.playRewarded(ok=>{
    adRefreshBusy=false;
    if(ok===true){runCoins+=runCoinIncome;coinDoubled=true;Sfx.play('coin');}
    else toast(ok===null?'广告暂不可用，请稍后再试':'需完整观看才能翻倍');
  });
}
let ups=Object.assign({drop:0,power:0},lsGet('nulei_up',{}));
const saveCoins=()=>lsSet('nulei_coins',coins);
const saveUps=()=>lsSet('nulei_up',ups);
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
  if(ADS_OFF||reviving)return;
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
  sx:SX, sy:SY, safeTop:Math.max(safeTop,capBottom), // 页眉起排高度含胶囊让位（设置页内部 headY=safeTop+8）
  bottomInset:()=>bottomInset(), // 惰性取值：页面底部需让开 Banner / 手势条
  onClose:()=>{state='title';},
  data:()=>({coins,hi,shipIdx,bgIdx,owned,ups,ships:SHIPS,bgs:BGS,
    shipPrice:SHIP_PRICE,bgPrice:BG_PRICE,upsDef:UPGRADES,reward:REWARD_COINS,tips:TIPS,
    version:VERSION,adOff:ADS_OFF,sfxOn:Sfx.sfxOn,bgmOn:Sfx.bgmOn,drawShip:drawShipShape}),
  act:{pickShip,pickBg,ad:requestCoinAd,buy:tryBuyUpgrade,
    sfx:()=>{Sfx.toggleSfx();if(Sfx.sfxOn)Sfx.play('click');}, // 开时响一声确认，关时无声
    bgm:()=>{Sfx.toggleBgm();Sfx.play('click');},
    click:()=>Sfx.play('click')},
});

let drag=null;
const DBG_AID=false; // TEMP DEBUG: 调试辅助（网格坐标线+玩家定位十字），上线前置 false
const DBG_GOD=false; // TEMP DEBUG: 调试无敌（挂机验证商店/Boss 流程用），上线前置 false
// 双击暂停检测：两次"干净点按"（快速按下-抬起且未移动）间隔 <350ms 且位置相近
let tStart=0,tStartX=0,tStartY=0,tMoved=false;
let lastTapT=0,lastTapX=0,lastTapY=0;
wx.onTouchStart(e => {
  const touch = e.touches[0];
  if (!touch) return;
  const t = toGame(touch);
  if (Ads.onTouchStart(t)) return; // 模拟广告展示中：点击只作用于广告层
  if (state === 'playing') {
    // 静音按钮（顶部左上角小喇叭）：先于拖动判定吞掉点按，不带动机体移动
    const mp=mutePos();
    if ((t.x-mp.x)**2+(t.y-mp.y)**2 < 36**2) { const on = Sfx.toggleAll(); if (on) Sfx.play('click'); return; }
    tStart=Date.now();tStartX=t.x;tStartY=t.y;tMoved=false; // 记录触点供双击判定
    drag = { x: t.x, y: t.y, px: player.x, py: player.y };
    return;
  }
  if (state === 'over') {
    if (reviving) return;
    if (!ADS_OFF && reviveUsed<MAX_REVIVE && inRect(t,REVIVE_BTN)) { requestRevive(); return; }
    if (!ADS_OFF && settleConverted>0 && !settleDoubled && inRect(t,OVER_COIN_BTN)) { requestSettleDouble(); return; }
    if (inRect(t,restartRect())) startGame();
    return;
  }
  if (state === 'clear') return; // 通关动画只按原计时进入补给站，禁止触摸透传到标题逻辑
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
  if (state === 'shop') { // 补给站：购牌（买了出新三张）/固定升级/刷新/出战/本关金币翻倍；未命中区域吞掉不透传
    for (let i = 0; i < 3; i++) {
      if (offer[i] && inRect(t, SHOP_CARDS[i])) { buyCard(i); return; }
    }
    for (let i = 0; i < SHOP_FIX.length; i++) {
      if (inRect(t, SHOP_FIX_CARDS[i])) { buyFix(i); return; }
    }
    if (inRect(t, shopHit(SHOP_REFRESH))) { requestShopRefresh(); return; }
    if (inRect(t, shopHit(SHOP_GO))) { Sfx.play('click'); nextStage(); return; }
    if (!ADS_OFF && inRect(t, shopHit(SHOP_ADCOIN))) { requestCoinDouble(); return; }
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
  reviveUsed=0;reviving=false;msgT=0;settleConverted=0;settleDoubled=false;runSettled=false;
  Object.assign(player,{x:W/2,y:H-90,hp:100,maxHp:100,inv:2,weapon:'std',wlevel:2,mis:'none',mlevel:0,fireT:0,misT:0,
    buffs:{},shield:0,shieldT:0,r:5});
  runCoins=0;offer=[];runPicks=0;runTopBuff={name:'',n:0};adRefreshUsed=ADS_OFF;adRefreshBusy=false;shopRefreshN=0;runCoinsAtStage=0;runCoinIncome=0;coinDoubled=false;
  Sfx.play('click');Sfx.bgmStart(); // 进入战斗：BGM 起（CDN 未就绪/失败则静默，无碍游玩）
}
function nextStage(){stage++;elapsed=0;spawnT=1;boss=null;ebullets=[];miniSpawned=false;warnT=0;hitStop=0;state='playing';player.inv=Math.max(player.inv,1);runCoinsAtStage=runCoins;runCoinIncome=0;Sfx.bgmStart();} // 出战给 1s 无敌缓冲
function goTitle(){if(runCoins>0||state==='over')convertLeftoverCoins();state='title';boss=null;warnT=0;hitStop=0;bullets=[];ebullets=[];enemies=[];items=[];parts=[];shockwaves=[];chainBooms=[];drag=null;Sfx.bgmStop();}
function gameOver(){
  state='over';
  Sfx.bgmStop();Sfx.play('over');
  // 仍有复活机会时先不折算：复活后局内金币继续用于补给站；真正结束（无复活或回标题）再入账
  if(ADS_OFF||reviveUsed>=MAX_REVIVE)convertLeftoverCoins();
  if(score>hi){hi=score;lsSet('nulei_hi',hi);
    // 双榜同步：好友榜走微信托管 KV（子域读取），世界榜上报 nulei-server（失败静默）
    try{wx.setUserCloudStorage({KVDataList:[{key:'nulei_hi',value:String(hi)}],fail:()=>{}});}catch(e){}
    Rank.report(hi,runTime);
  }
}
// ---------- 生成敌人 ----------
const hpMul=()=>1+0.25*(stage-1); // 肉鸽版难度：小怪血量随关卡爬升（构筑后玩家输出为基准 2.5~4 倍）
const eBulletSpd=()=>stage>=3?Math.min(1.4,1+(stage-2)*0.1):1; // 敌弹速：第3关起 +10%/关封顶 +40%
function addEnemy(o){o.id=++eid;o.t=0;o.fireT=rnd(0.5,1.5);o.hp=Math.ceil(o.hp*hpMul());enemies.push(o);}
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
  const hp=stage===1?260:260+stage*240; // 第1关 Boss 血量单独调低（掉落退役后首关火力起步低，避免拖沓）
  warnT=1.6;Sfx.play('alarm');
  boss={x:W/2,y:-90,hp,maxhp:hp,r:46,t:0,fireT:1.2,aimT:2.4,spiralA:0,spiralT:0.5};
}
function spawnMiniBoss(){ // 关卡中段精英：弱于关底 Boss，击杀不清关
  const hp=70+stage*50;
  warnT=1.6;Sfx.play('alarm');
  boss={x:W/2,y:-70,hp,maxhp:hp,r:26,t:0,fireT:1.2,aimT:2.0,spiralA:0,spiralT:0.5,mini:true};
}

// ---------- 射击 ----------
function eShoot(x,y,ang,sp,color){sp*=eBulletSpd();ebullets.push({x,y,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp,r:4,color:color||'#ff5d7a'});}
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
  const bigM=1+0.1*buffLv('big'),bigR=buffLv('big');           // 重型弹头：主炮弹伤害/弹径
  const lzM=1+0.4*buffLv('laser'),lzR=buffLv('laser');         // 激光增幅：仅主武器=激光时生效
  if(p.weapon==='laser'){
    const beams=buffLv('c_prism')?[-10,0,10]:[0]; // 三棱镜核心：主激光分裂 3 束平行光
    for(const off of beams)bullets.push({x:p.x+off,y:p.y-26,vx:0,vy:-sp*1.3,sp:sp*1.3,dmg:(2+p.wlevel*0.5)*bigM*lzM,pierce:true,hits:new Set(),r:(p.wlevel>=4?9:4+p.wlevel)+bigR+lzR,color:'#5df0ff',laser:true});
    Sfx.play('shoot',0.4);
  }else if(p.weapon==='homing'){
    for(let i=0;i<p.wlevel;i++){const a=-Math.PI/2+rnd(-0.6,0.6);
      bullets.push({x:p.x+rnd(-16,16),y:p.y-16,vx:Math.cos(a)*420,vy:Math.sin(a)*420,sp:420,dmg:1.5*bigM,homing:true,r:4+bigR,color:'#ff9d3c'});}
    Sfx.play('shoot',0.4);
  }else{
    const lv=p.wlevel,off=lv>=2?10:0,ang=lv>=3?0.16:0;
    bullets.push({x:p.x,y:p.y-26,vx:0,vy:-sp,sp,dmg:1*bigM,r:3+bigR,color:'#ffe66d'});
    if(lv>=2)bullets.push({x:p.x-off,y:p.y-16,vx:0,vy:-sp,sp,dmg:1*bigM,r:3+bigR,color:'#ffe66d'});
    if(lv>=3)bullets.push({x:p.x+off,y:p.y-16,vx:0,vy:-sp,sp,dmg:1*bigM,r:3+bigR,color:'#ffe66d'});
    if(lv>=4){for(const s of[-1,1])bullets.push({x:p.x+s*13,y:p.y-13,vx:s*Math.sin(0.3)*sp,vy:-Math.cos(0.3)*sp,sp,dmg:1*bigM,r:3+bigR,color:'#ffe66d'});}
    Sfx.play('shoot');
  }
  // 肉鸽翼炮扩展（仅机炮）：每级增 1 对侧翼斜射弹，级数越高夹角越开避免弹道重叠；翼炮阵列核心：每对变双联
  if(p.weapon==='std'){const dbl=buffLv('c_swarm')?2:1;
    for(let i=0;i<buffLv('wing');i++){const a=0.5+i*0.18;
      for(const s of[-1,1])for(let k=0;k<dbl;k++)bullets.push({x:p.x+s*(14+k*7),y:p.y-10,vx:s*Math.sin(a)*sp,vy:-Math.cos(a)*sp,sp,dmg:1*bigM,r:3+bigR,color:'#ffe66d'});}}
  // 肉鸽尾部机炮：直射尾弹（通用主武器），仅对入屏敌机有威胁
  for(let i=0;i<buffLv('rear');i++)bullets.push({x:p.x,y:p.y+18,vx:0,vy:sp,sp,dmg:1*bigM,r:3+bigR,color:'#ffe66d'});
}
function fireMissile(){
  const p=player,extra=buffLv('missile'),dbl=buffLv('c_hive')?2:1; // 蜂巢导弹：每轮增发；饱和轰击核心：翻倍
  if(p.mis==='homing'){
    for(let i=0;i<(p.mlevel+1+extra)*dbl;i++){const s=i%2?1:-1,k=i>>1; // k=同侧序号：起点/横速错开，多发不重叠（饱和轰击翻倍后可见）
      bullets.push({x:p.x+s*(22+k*12),y:p.y,vx:s*(160+k*40),vy:-260,sp:260,dmg:3,homing:true,r:4,color:'#ffd23c',mis:true});}
    Sfx.play('shoot',0.35);
  }else if(p.mis==='laser'){
    for(let i=0;i<(1+extra)*dbl;i++)
      bullets.push({x:p.x+(i%2?1:-1)*Math.ceil(i/2)*8,y:p.y-32,vx:0,vy:-1100,sp:1100,dmg:2+p.mlevel,pierce:true,hits:new Set(),r:5+p.mlevel,color:'#c77dff',laser:true});
    Sfx.play('shoot',0.3);
  }
}

// ---------- 掉落（v0.2：肉鸽制掉落只出金币袋，武器成长走补给站购买） ----------
let lastDropT=-9; // 上次掉落时间（runTime 计），防连杀密集掉箱
let killsSinceDrop=0; // 连续击杀未掉落计数，满 6 触发保底
const dropRate=()=>stage<2?0.5:Math.min(0.6,0.45+(stage-1)*0.02); // 金币袋掉率：第1关 50%，爬升封顶 60%
function dropItem(x,y,force){ // force=true 必掉（小 Boss 掉落用）
  if(!force){
    killsSinceDrop++;
    const pity=killsSinceDrop>=6; // 保底：连续 6 杀未掉必掉，保证金币流不断
    if(!pity&&(runTime-lastDropT<1.2||Math.random()>dropRate()*UPGRADES.drop.val(upVal('drop'))*(1+0.3*buffLv('drop'))))return;
    killsSinceDrop=0;
  }
  lastDropT=runTime;
  const v=force?(12+Math.floor(Math.random()*6)):(2+Math.floor(Math.random()*3)); // 普通袋 ¥2-4，精英/Boss 强制大袋 ¥12-17
  items.push({x,y,vy:90,color:'#ffd23c',letter:'¥',kind:'coin',coin:v});
}
function pickup(it){
  const p=player;
  if(it.kind==='coin'){addCoin(it.coin);Sfx.play('coin');}
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
  if(state==='clear'){clearT=Math.max(0,clearT-dt);if(clearT<=0)enterShop();return;} // 播完通关动画进补给站（土豆兄弟式选购节点）
  if(state!=='playing')return;
  elapsed+=dt;runTime+=dt;
  if(!tutDone&&runTime>=8){tutDone=true;lsSet('nulei_tut',true);} // 提示看满 8 秒即完成
  if(warnT>0)warnT-=dt;
  const p=player;
  if(DBG_GOD)p.inv=1; // 调试无敌：免伤验证流程（伤害数值/金币入账不受影响）
  if(p.inv>0)p.inv-=dt;
  // 能量护盾充能：拿牌瞬间补满一层，之后每 25 秒回充至上限（层数=牌等级）
  if(buffLv('shield')>0&&p.shield<buffLv('shield')){p.shieldT+=dt;if(p.shieldT>=(buffLv('c_phase')?12:25)){p.shieldT=0;p.shield++;Sfx.play('pickup');}} // 相转移装甲核心：重置间隔减半
  // 引擎尾焰：低频短命粒子（预留粒子池余量给爆炸）
  if(parts.length<PARTS_MAX-24&&Math.random()<0.8)
    parts.push({x:p.x+rnd(-3,3),y:p.y+15,vx:rnd(-12,12),vy:rnd(90,160),life:rnd(0.12,0.28),t:0,color:'#ffb347',r:2.2});

  // 移动逻辑已完全通过 touch 事件处理，此处移除键盘依赖
  // const sp=380;
  // const mx=(keys.ArrowRight||keys.KeyD?1:0)-(keys.ArrowLeft||keys.KeyA?1:0);
  // const my=(keys.ArrowDown||keys.KeyS?1:0)-(keys.ArrowUp||keys.KeyW?1:0);
  // if(mx||my){p.x=clamp(p.x+mx*sp*dt,12,W-12);p.y=clamp(p.y+my*sp*dt,70,H-16);}

  // 玩家开火（射速：局内速射装置 × 超频协议，加法叠乘）
  p.fireT-=dt;if(p.fireT<=0){p.fireT=(p.weapon==='laser'?0.11:0.09)/((1+0.18*buffLv('rapid'))*(1+0.35*buffLv('over')));firePlayer();}
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
      if(b.pierce){if(!b.hits.has(hit.id||'boss')){b.hits.add(hit.id||'boss');hit.hp-=dmgOf(b);hit.flash=0.1;spark(b.x,b.y,lastCritHit?'#ffe66d':b.color,3);}}
      else{hit.hp-=dmgOf(b);hit.flash=0.1;spark(b.x,b.y,lastCritHit?'#ffe66d':b.color,lastCritHit?6:4);bullets.splice(i,1);} // 暴击：火花更亮更多
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
    if(p.inv<=0&&(e.x-p.x)**2+(e.y-p.y)**2<(e.r+p.r+6)**2){hurtPlayer(25);enemies.splice(i,1);}
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
        dropItem(boss.x - 24, boss.y, true); dropItem(boss.x, boss.y, true); dropItem(boss.x + 24, boss.y, true); // 大额金币袋散落
        boss = null; ebullets = []; spawnT = 1.2; flash = 0.3; Sfx.play('boss_boom', 0.6);
      } else {
        score+=5000;hitStop = 0.07; flash = 0.5; // 顿帧 + 连环延时爆点，收尾再来一发大爆
        for(let i=0;i<5;i++)chainBooms.push({x:boss.x+rnd(-42,42),y:boss.y+rnd(-26,26),t:0.05+i*0.16});
        chainBooms.push({x:boss.x,y:boss.y,t:0.95});
        for(let i=0;i<6;i++)dropItem(boss.x-42+i*17, boss.y, true); // 6 袋大额金币：补给站构筑预算的主体
        boss = null; ebullets = []; state = 'clear'; clearT = 2.4;
        Sfx.play('boss_boom');Sfx.play('clear'); // 关底大爆 + 通关号角（BGM 保留，回 title 再停）
      }
    }
    else if(p.inv <= 0 && boss.y > 0 && (boss.x-p.x)**2+(boss.y-p.y)**2 < (boss.r+p.r)**2) hurtPlayer(35);
  }

  // 敌弹
  for(let i=ebullets.length-1;i>=0;i--){const b=ebullets[i];b.x+=b.vx*dt;b.y+=b.vy*dt;
    if(b.y<-20||b.y>H+20||b.x<-20||b.x>W+20){ebullets.splice(i,1);continue;}
    if(p.inv<=0&&(b.x-p.x)**2+(b.y-p.y)**2<(b.r+p.r)**2){ebullets.splice(i,1);hurtPlayer(20);}
  }

  // 道具（金币袋：进入吸附半径后自动飞向玩家，其余持续下落出屏——走位捡钱是收益动机，磁力牌扩大吸附半径）
  for(let i=items.length-1;i>=0;i--){const it=items[i];
    if(it.kind==='coin'){
      const d2=(it.x-p.x)**2+(it.y-p.y)**2,rr=(90+15*buffLv('magnet'))**2;
      if(it.magnet||d2<rr){it.magnet=true;const a=Math.atan2(p.y-it.y,p.x-it.x);
        it.x+=Math.cos(a)*430*dt;it.y+=Math.sin(a)*430*dt;}
      else it.y+=it.vy*dt;
    }else it.y+=it.vy*dt;
    if(it.y>H+20){items.splice(i,1);continue;}
    if((it.x-p.x)**2+(it.y-p.y)**2<(22+12*buffLv('magnet'))**2){pickup(it);items.splice(i,1);} // 磁力吸附：拾取半径逐级外扩
  }

  // 粒子
  for(let i=parts.length-1;i>=0;i--){const q=parts[i];q.t+=dt;
    if(q.t>=q.life){parts.splice(i,1);continue;}q.x+=q.vx*dt;q.y+=q.vy*dt;q.vx*=0.96;q.vy*=0.96;}
}
function hurtPlayer(dmg){ // 血条制：敌弹 20 / 撞机 25 / Boss 撞 35，血空即终结
  const p=player;
  // 能量护盾优先消耗：挡下一次伤害不掉武器等级，短无敌作反馈
  if(p.shield>0){p.shield--;p.inv=1.5;spark(p.x,p.y,'#00f3ff',12);Sfx.play('pickup');return;}
  p.hp-=dmg||20;
  if(buffLv('over')>0)p.buffs.over=0; // 超频协议：受击即失效
  if(!buffLv('fix')){p.wlevel=Math.max(1,p.wlevel-1);p.mlevel=Math.max(0,p.mlevel-1);} // 紧急维修：免疫降级
  explode(p.x,p.y,true);flash=0.25;
  if(p.hp<=0){Sfx.play('death');gameOver();return;}
  p.x=W/2;p.y=H-90;p.inv=2.5+0.5*buffLv('invuln');ebullets=ebullets.filter(b=>(b.x-p.x)**2+(b.y-p.y)**2>140**2); // 相位涂层延长无敌
}

// ---------- 绘制 ----------
// 三层视差星空：远层小而暗慢，近层大而亮快，滚动产生纵深
const stars=[];
for(let i=0;i<80;i++){const l=Math.random();
  stars.push({x:Math.random()*W,y:Math.random()*H,v:25+l*135,s:l<0.5?1:(l<0.85?2:3),l:l<0.5?0:(l<0.85?1:2)});}

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
// 调试辅助：60px 间隔网格线（120px 标注刻度）+ 玩家定位十字与逻辑坐标——配合 automation 校准触摸坐标系用
function drawDebugAid(){
  ctx.save();
  ctx.lineWidth=1;ctx.strokeStyle='rgba(0,243,255,0.16)';ctx.fillStyle='rgba(0,243,255,0.5)';ctx.font='10px monospace';ctx.textAlign='left';
  for(let x=60;x<W;x+=60){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  for(let y=60;y<H;y+=60){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  for(let x=120;x<W;x+=120)ctx.fillText(x,x+2,12);
  for(let y=120;y<H;y+=120)ctx.fillText(y,2,y-2);
  const p=player;
  ctx.strokeStyle='rgba(125,255,140,0.55)';
  ctx.beginPath();ctx.moveTo(0,p.y);ctx.lineTo(W,p.y);ctx.moveTo(p.x,0);ctx.lineTo(p.x,H);ctx.stroke();
  ctx.fillStyle='#7dff8c';
  ctx.fillText('P '+Math.round(p.x)+','+Math.round(p.y),Math.min(p.x+14,W-90),p.y-10);
  ctx.restore();
}
function drawShipShape(sk){
  ctx.fillStyle=sk.body;
  ctx.beginPath();ctx.moveTo(0,-17);ctx.lineTo(5,-3);ctx.lineTo(17,9);ctx.lineTo(7,7);ctx.lineTo(4,13);
  ctx.lineTo(-4,13);ctx.lineTo(-7,7);ctx.lineTo(-17,9);ctx.lineTo(-5,-3);ctx.closePath();ctx.fill();
  ctx.fillStyle=sk.fin;ctx.fillRect(-3,-12,6,9);
  if(sk.trail){ctx.fillStyle=sk.trail;ctx.fillRect(-3,13,6,3+Math.random()*5);} // trail=null 时不画拖尾（标题剪影防随机闪跳）
}
function drawShip(){
  const p=player;if(p.inv>0&&!DBG_GOD&&Math.floor(p.inv*16)%2)return; // DBG_GOD 常驻无敌会让闪烁恒隐身，调试时跳过
  ctx.save();ctx.translate(p.x,p.y);
  // 机体随武器等级进化/退化（战机分级-01..04）；CDN 未就绪时回退程序化机体
  const img=CDN.get('战机分级-0'+clamp(p.wlevel,1,4));
  if(img){
    const w=PW,h=w*img.height/img.width; // 按宽度统一机体尺寸（原按高度 38px 绘制过小）
    ctx.drawImage(img,-w/2,-h/2,w,h);
  }else{ctx.scale(PW/34,PW/34);drawShipShape(SHIPS[shipIdx]);} // 程序化回退机体同步放大
  ctx.fillStyle='#fff';ctx.fillRect(-1,-1,2,2); // 街机式可见判定点
  if(p.shield>0){ // 能量护盾：机体外圈青环，层数越多环越大越亮
    ctx.strokeStyle=`rgba(0,243,255,${0.35+0.18*p.shield})`;ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(0,0,26+2*p.shield,0,7);ctx.stroke();
  }
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
  coin:'掉落物-06'           // ¥ 金币箱 → 金星徽章
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
  ctx.fillStyle='#0a0a12';ctx.font='bold 13px monospace';ctx.textAlign='center';ctx.textBaseline='middle';
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
  if(state==='settings'){Settings.draw(ctx,W,H);Ads.draw(ctx);return;} // 设置页：独立全屏页面，不叠在标题页上
  if(state==='title'||state==='rank'){drawTitle();if(state==='rank')Rank.draw(ctx,W,H);Ads.draw(ctx);return;}
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
  if(state==='playing')drawTutorial();
  if(state==='shop')drawShop();
  if(state==='playing'&&warnT>0){ // 首领/精英出场：航空警戒条（斜纹带 + 闪烁文案）
    const blink=Math.floor(Date.now()/140)%2===0;
    const wy=HUD_TOP+HUD_H+20;
    ctx.globalAlpha=Math.min(1,warnT)*(blink?0.95:0.55);
    UI.hazardStrip(ctx,W*0.12,wy-18,W*0.76,26,T.danger);
    ctx.fillStyle=T.dangerHi;ctx.textAlign='center';ctx.font='bold 22px '+T.fontUI;
    ctx.fillText(boss&&boss.mini?'警 告 · 精 英 接 近':'警 告 · 首 领 接 近',W/2,wy+3);
    ctx.globalAlpha=1;ctx.textAlign='left';
  }
  if(flash>0){ctx.fillStyle=`rgba(255,255,255,${flash})`;ctx.fillRect(-20,-20,W+40,H+40);}
  if(state==='clear'){ // 任务完成报告（2.4s）：大字+战果，播完自动进补给站
    ctx.textAlign='center';
    UI.drawNeonPanel(ctx,W/2-160,H/2-70,320,150,'战区肃清',T.ok);
    ctx.fillStyle=T.okHi;ctx.font='bold 38px '+T.fontUI;
    ctx.fillText('通关成功',W/2,H/2+5);
    ctx.fillStyle=T.text;ctx.font='16px '+T.fontData;
    ctx.fillText(`第 ${stage} 关通过 · 得分 ${score}`,W/2,H/2+50);
    ctx.textAlign='left';
  }
  if(state==='over'){
    ctx.fillStyle='rgba(0,0,0,0.7)';ctx.fillRect(0,0,W,H);
    ctx.textAlign='center';
    UI.drawNeonPanel(ctx,W/2-160,H/2-125,320,288,'最终战报',T.danger);
    ctx.fillStyle=T.dangerHi;ctx.font='bold 42px '+T.fontUI;
    ctx.fillText('游戏结束',W/2,H/2-60);
    ctx.fillStyle=T.text;ctx.font='bold 20px '+T.fontData;
    ctx.fillText('得分  '+String(score).padStart(7,'0'),W/2,H/2-10);
    ctx.fillStyle=T.amber;ctx.font='14px '+T.fontData;
    ctx.fillText('最高分  '+String(hi).padStart(7,'0'),W/2,H/2+20);
    if(settleConverted>0){
      ctx.fillStyle=T.amber;ctx.font='bold 15px '+T.fontData;
      ctx.fillText('剩余金币 '+runCoins+' · 存款 +'+(settleDoubled?settleConverted*2:settleConverted)+(settleDoubled?' · 已翻倍':''),W/2,H/2+42);
    }
    // 复活 / 重新开始按钮
    if(!ADS_OFF&&reviveUsed<MAX_REVIVE){
      UI.drawNeonPanel(ctx,REVIVE_BTN.x,REVIVE_BTN.y,REVIVE_BTN.w,REVIVE_BTN.h,'复活机会 '+(MAX_REVIVE-reviveUsed),T.strokeHi);
      ctx.fillStyle=reviving?T.textFaint:T.text;ctx.font='bold 15px '+T.fontUI;
      ctx.fillText(reviving?'加载中...':'▶ 看广告复活',REVIVE_BTN.x+REVIVE_BTN.w/2,REVIVE_BTN.y+34);
    }
    const rb=restartRect();
    UI.drawNeonPanel(ctx,rb.x,rb.y,rb.w,rb.h,'再来一局',T.danger);
    ctx.fillStyle=T.text;ctx.font='bold 15px '+T.fontUI;
    ctx.fillText('重新开始',rb.x+rb.w/2,rb.y+34);
    if(settleConverted>0&&!settleDoubled&&!ADS_OFF){
      UI.drawNeonPanel(ctx,OVER_COIN_BTN.x,OVER_COIN_BTN.y,OVER_COIN_BTN.w,OVER_COIN_BTN.h,'',T.amber);
      ctx.fillStyle=reviving?T.textFaint:T.amberHi;ctx.font='bold 15px '+T.fontUI;
      ctx.fillText(reviving?'加载中...':'▶ 看广告 存款翻倍',OVER_COIN_BTN.x+OVER_COIN_BTN.w/2,OVER_COIN_BTN.y+25);
    }
    drawRunSummary();
  }
  if(state==='pause'){ // 飞控冻结报告：按钮顺序/文案/热区不变
    ctx.setTransform(SX,0,0,SY,0,0); // 摆脱震动偏移，菜单稳定
    ctx.fillStyle=UI.rgba(T.bg,0.78);ctx.fillRect(0,0,W,H);
    ctx.textAlign='center';
    UI.drawNeonPanel(ctx,W/2-128,H/2-124,256,196,'已暂停',T.amber);
    for(const b of PAUSE_BTNS){
      UI.drawNeonPanel(ctx,b.x,b.y,b.w,b.h,'',b.c);
      ctx.fillStyle=b.c;ctx.font='bold 16px '+T.fontUI;
      ctx.fillText(b.t,b.x+b.w/2,b.y+28);
    }
  }
  if(msgT>0){
    ctx.save();ctx.globalAlpha=Math.min(1,msgT);
    ctx.fillStyle=T.amber;ctx.font='bold 14px '+T.fontUI;ctx.textAlign='center';
    ctx.fillText(msg,W/2,H/2+188);ctx.restore();
  }
  if(DBG_AID)drawDebugAid();
  Ads.draw(ctx); // 模拟激励视频为覆盖层，最后绘制压在所有 UI 之上
}
// 标题页：任务铭牌（航空刻度 + 任务编号）+ 待机战机能见轮廓 + 琥珀呼吸开始提示
function drawTitle(){
  ctx.textAlign='center';

  // 待机战机剪影：停机位上的深色大轮廓，压在标题铭牌之下（低密度装饰，不抢信息）
  ctx.save();
  ctx.translate(W/2,H*0.66);ctx.scale(7.2,7.2);
  ctx.globalAlpha=0.5;
  drawShipShape(TITLE_SIL_SKIN);
  ctx.restore();

  // 任务铭牌：不对称装甲切角 + 顶部航空刻度 + 序列号 + 角部短刻度
  const np=TITLE_NAMEPLATE;
  UI.drawChamferPanel(ctx,np.x,np.y,np.w,np.h,{c:T.strokeHi,fill:T.panel,cut:14,asym:true,lw:2});
  // 铭牌顶部航空刻度带（0-10 长刻度 + 细分短刻度）
  ctx.strokeStyle=UI.rgba(T.strokeHi,0.55);ctx.lineWidth=1;
  ctx.beginPath();
  for(let i=0;i<=40;i++){
    const tx=np.x+np.w*0.24+i*(np.w*0.52/40),long=i%4===0;
    ctx.moveTo(tx,np.y-4);ctx.lineTo(tx,np.y-4-(long?7:3.5));
  }
  ctx.stroke();
  ctx.fillStyle=T.textFaint;ctx.font='9px '+T.fontData;
  ctx.fillText('0',np.x+np.w*0.24,np.y-14);
  ctx.fillText('5',np.x+np.w*0.5,np.y-14);
  ctx.fillText('10',np.x+np.w*0.76,np.y-14);
  // 任务编号（左）与密级角标（右）
  ctx.textAlign='left';ctx.fillStyle=T.textFaint;ctx.font='10px '+T.fontData;
  ctx.fillText('SERIAL/NR-01',np.x+16,np.y+18);
  ctx.textAlign='right';ctx.fillStyle=T.amber;
  ctx.fillText('★ 5',np.x+np.w-16,np.y+18);
  ctx.textAlign='center';

  // 标题：橙色挤出层（右下偏移）+ 黑硬描边 + 米白正面字
  const ty=np.y+68;
  ctx.font='bold 56px '+T.fontUI;
  ctx.fillStyle=T.amberDim;
  ctx.fillText('怒雷风暴',W/2+3,ty+3);
  ctx.strokeStyle='#05070B';ctx.lineWidth=4;
  ctx.strokeText('怒雷风暴',W/2,ty);
  ctx.fillStyle=T.text;
  ctx.fillText('怒雷风暴',W/2,ty);
  ctx.lineWidth=1;

  // 副标题：弹幕射击，两侧斜杠纹饰
  ctx.fillStyle=T.textDim;ctx.font='bold 15px '+T.fontUI;
  ctx.fillText('弹 幕 射 击',W/2,ty+34);
  ctx.strokeStyle=UI.rgba(T.strokeHi,0.4);ctx.lineWidth=2;
  for(const s of TITLE_SIGNS){
    ctx.beginPath();
    for(let i=0;i<5;i++){const bx0=W/2+s*(86+i*9);
      ctx.moveTo(bx0,ty+36);ctx.lineTo(bx0+s*5,ty+28);}
    ctx.stroke();
  }

  // 底部文案整体上移，让开刘海屏手势条（否则"最高分"会被压在遮挡区里）
  const tbi=bottomInset();
  // 开始提示：琥珀色亮度呼吸（正弦调透明度，不再双色交替）
  UI.hazardStrip(ctx,56,H-186-tbi,W-112,4,T.amber);
  const br=0.55+0.45*Math.sin(Date.now()/380);
  ctx.save();ctx.globalAlpha=br;
  ctx.fillStyle=T.amberHi;ctx.font='bold 22px '+T.fontUI;
  ctx.fillText('点击屏幕开始战斗',W/2,H-158-tbi);
  ctx.restore();

  // 最高分：低亮度军用数据样式
  ctx.fillStyle=T.textFaint;ctx.font='bold 14px '+T.fontData;
  ctx.fillText('最高分 '+String(hi).padStart(7,'0'),W/2,H-128-tbi);

  // 装甲功能键：设置（右上齿轮）/ 排行（左上军衔章）/ 声音（顶部居中喇叭），入口与坐标不变
  UI.instButton(ctx,TITLE_KEY_SET);
  drawGear(SET_BTN.x+26,SET_BTN.y+20,10);
  ctx.fillStyle=T.text;ctx.font='bold 14px '+T.fontUI;ctx.textAlign='left';
  ctx.fillText('设置',SET_BTN.x+44,SET_BTN.y+25);
  UI.instButton(ctx,TITLE_KEY_RANK);
  drawRankChevrons(RANK_BTN.x+24,RANK_BTN.y+22);
  ctx.fillStyle=T.text;ctx.font='bold 14px '+T.fontUI;ctx.textAlign='left';
  ctx.fillText('排行',RANK_BTN.x+40,RANK_BTN.y+25);
  const sndOn=Sfx.sfxOn&&Sfx.bgmOn;
  TITLE_KEY_SND.on=sndOn;
  UI.instButton(ctx,TITLE_KEY_SND);
  drawSpeaker(SND_BTN.x+24,SND_BTN.y+20,sndOn);
  ctx.fillStyle=sndOn?T.text:T.textFaint;ctx.font='bold 14px '+T.fontUI;ctx.textAlign='left';
  ctx.fillText(sndOn?'声音':'静音',SND_BTN.x+42,SND_BTN.y+25);
  ctx.textAlign='center';
}
// 喇叭图标：箱体+锥形+声波弧（开）/斜杠（静音），程序化绘制避免字形渲染差异
function drawSpeaker(x,y,on){
  ctx.save();
  ctx.strokeStyle=ctx.fillStyle=on?T.amberHi:T.textFaint;ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(x-9,y-4);ctx.lineTo(x-3,y-4);ctx.lineTo(x+4,y-11);
  ctx.lineTo(x+4,y+11);ctx.lineTo(x-3,y+4);ctx.lineTo(x-9,y+4);ctx.closePath();ctx.fill();
  if(on){
    ctx.beginPath();ctx.arc(x+6,y,7,-0.9,0.9);ctx.stroke();
    ctx.beginPath();ctx.arc(x+6,y,12,-0.8,0.8);ctx.stroke();
  }else{
    ctx.strokeStyle=T.dangerHi;ctx.lineWidth=2.5;
    ctx.beginPath();ctx.moveTo(x+7,y-8);ctx.lineTo(x+16,y+8);
    ctx.moveTo(x+16,y-8);ctx.lineTo(x+7,y+8);ctx.stroke();
  }
  ctx.restore();
}
// 军衔章图标：三道 V 形军衔杠（排行榜入口用，程序化绘制避免字形差异）
function drawRankChevrons(x,y){
  ctx.save();
  ctx.strokeStyle=T.amberHi;ctx.lineWidth=2.5;ctx.lineJoin='miter';
  for(let i=0;i<3;i++){const cy=y-8+i*7;
    ctx.beginPath();ctx.moveTo(x-9,cy-3);ctx.lineTo(x,cy+3);ctx.lineTo(x+9,cy-3);ctx.stroke();}
  ctx.restore();
}
// 齿轮图标：外圈 + 8 齿 + 中孔（避免依赖 ⚙ 字形的渲染差异）
function drawGear(x,y,r){
  ctx.save();
  ctx.strokeStyle=T.strokeHi;ctx.fillStyle=T.strokeHi;ctx.lineWidth=2;
  ctx.beginPath();ctx.arc(x,y,r*0.62,0,7);ctx.stroke();
  for(let i=0;i<8;i++){const a=i*Math.PI/4;
    ctx.fillRect(x+Math.cos(a)*r*0.78-2,y+Math.sin(a)*r*0.78-2,4,4);}
  ctx.beginPath();ctx.arc(x,y,r*0.2,0,7);ctx.fill();
  ctx.restore();
}
// 首次游戏开局提示：闪烁两行文案覆盖在玩法区下方，不挡机体初始位置（H-90）
function drawTutorial(){
  if(tutDone||stage>1||runTime>=8)return;
  const a=0.55+0.45*Math.sin(runTime*5);
  ctx.save();ctx.globalAlpha=a;ctx.textAlign='center';
  ctx.fillStyle=T.text;ctx.font='bold 17px '+T.fontUI;
  ctx.fillText('拖动屏幕 移动机体 · 自动开火',W/2,H*0.62);
  ctx.fillStyle=T.amber;ctx.font='13px '+T.fontUI;
  ctx.fillText('击毁敌机拾金币 · 小心红色弹幕',W/2,H*0.62+26);
  ctx.restore();
}
// HUD：航空仪表风——细刻度、钢灰分隔线、米白数据、琥珀状态（无面板底框，减少视野遮挡）
function drawHUD(){
  ctx.setTransform(SX,0,0,SY,0,0);
  ctx.textAlign='left'; // 显式钉死对齐，避免其他状态遗留的 center 泄漏
  // 第一行：得分（左）/ 关卡与倒计时（中）/ 生命（右）
  ctx.fillStyle=UI.rgba(T.textDim,0.75);ctx.font='12px '+T.fontUI;
  ctx.fillText('得分',50,HUD_TOP+14); // 左移让位给顶部左上角静音喇叭
  ctx.save();ctx.textAlign='center';
  ctx.fillStyle=UI.rgba(T.amber,0.75);
  ctx.fillText('第 '+stage+' 关',W/2,HUD_TOP+14);
  ctx.restore();
  ctx.fillStyle=T.text;ctx.font='bold 22px '+T.fontData;
  ctx.fillText(String(score).padStart(7,'0'),50,HUD_TOP+40);
  ctx.save();ctx.textAlign='center';
  if(boss){
    ctx.fillStyle=Math.floor(Date.now()/300)%2?T.dangerHi:T.amber;
    ctx.font='bold 20px '+T.fontUI;
    ctx.fillText(boss.mini?'精英!!':'首领!!',W/2,HUD_TOP+40);
  }else{
    const cd=Math.max(0,Math.ceil(bossAt()-elapsed));
    ctx.fillStyle=cd<=10?T.dangerHi:T.amber;
    ctx.font='bold 20px '+T.fontData;
    ctx.fillText(cd+'秒',W/2,HUD_TOP+40);
  }
  ctx.restore();
  // 金币（分数行右）+ 血条（武器行右）：随 HUD_TOP 整体排在微信胶囊之下，不再与其重叠
  ctx.save();ctx.textAlign='right';
  ctx.fillStyle=T.amber;ctx.font='bold 16px '+T.fontData;
  ctx.fillText('¥ '+runCoins,W-12,HUD_TOP+40);
  ctx.restore();
  {
    // 机体结构值：玩家血量绿/黄/红阈值保留，装甲槽式量表
    const bw=96,bx=W-12-bw,by=HUD_TOP+58,hpr=clamp(player.hp/player.maxHp,0,1);
    ctx.fillStyle=T.panelDeep;ctx.fillRect(bx,by,bw,10);
    ctx.fillStyle=hpr>0.35?T.ok:(hpr>0.18?T.warn:T.danger);
    ctx.fillRect(bx,by,bw*hpr,10);
    ctx.strokeStyle=UI.rgba(T.strokeHi,0.5);ctx.lineWidth=1;ctx.strokeRect(bx-0.5,by-0.5,bw+1,11);
    ctx.textAlign='right';ctx.fillStyle=T.text;ctx.font='11px '+T.fontData;
    ctx.fillText(Math.ceil(player.hp)+'/'+player.maxHp,W-13,by+9);
    ctx.textAlign='left';
  }
  // 第二行：武器（左）+ HUD 底部细刻度分隔线
  ctx.fillStyle=T.textDim;ctx.font='14px '+T.fontUI;
  ctx.fillText('武器 '+(WPN_ZH[player.weapon]||player.weapon)+' '+player.wlevel+'级',50,HUD_TOP+66);
  ctx.strokeStyle=UI.rgba(T.stroke,0.55);ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(12,HUD_TOP+HUD_H-2);ctx.lineTo(W-12,HUD_TOP+HUD_H-2);ctx.stroke();
  ctx.strokeStyle=UI.rgba(T.strokeHi,0.5);
  ctx.beginPath();
  for(let i=0;i<=10;i++){const tx=12+(W-24)*i/10;
    ctx.moveTo(tx,HUD_TOP+HUD_H-2);ctx.lineTo(tx,HUD_TOP+HUD_H-2+(i%5===0?5:2.5));}
  ctx.stroke();

  // 顶部左上角静音喇叭（仅战斗中显示与响应，结算/暂停页不出现避免误触死区）
  if (state === 'playing'){ const mp=mutePos(); drawSpeaker(mp.x, mp.y, Sfx.sfxOn && Sfx.bgmOn); }

  if(boss){
    UI.drawBossBar(ctx, W, H, boss.hp, boss.maxhp, bottomInset());
  }
}
// 补给站（shop 态）：土豆兄弟式波次选购——三张牌带价格，买了出新三张，多轮消费到点"出战"
// 视觉=军械补给终端：枪灰托盘、弹药舱式图标槽、琥珀价格与出战指令，全程零 shadowBlur / 零 halo
// 牌面两套视觉通道分离：稀有度=色相（N 冷钢蓝 / R 琥珀金 / 核心 低饱和警戒紫红），
// 购买力=描边与亮度（可买 / 差一点 / 买不起），买不起也不掉稀有度色相
let shopHdGrad=null,shopBuildCache=null,shopBuildN=-1;
const shopTextWidthCache={};
function shopTextWidth(text,font){
  const key=font+'|'+text;
  if(shopTextWidthCache[key]==null){
    ctx.save();ctx.font=font;shopTextWidthCache[key]=ctx.measureText(text).width;ctx.restore();
  }
  return shopTextWidthCache[key];
}
function shopBuildList(){ // 构筑摘要 7 格：等级降序，只在买牌后重算（避免每帧建数组+排序）
  if(shopBuildN!==runPicks){
    const list=[];
    for(const id in player.buffs){
      const lv=player.buffs[id],b=BUFF_BY_ID[id];
      if(lv>0&&b)list.push({letter:b.letter,rar:b.rar,lv});
    }
    list.sort((a,c)=>c.lv-a.lv);
    shopBuildCache=list.slice(0,7);
    while(shopBuildCache.length<7)shopBuildCache.push(null);
    shopBuildN=runPicks;
  }
  return shopBuildCache;
}
function drawShop(){
  ctx.save();
  ctx.textBaseline='middle';ctx.textAlign='left';
  ctx.fillStyle=UI.rgba(T.bg,0.78);ctx.fillRect(0,0,W,H);
  UI.drawChamferPanel(ctx,SHOP_PANEL.x,SHOP_PANEL.y,SHOP_PANEL.w,SHOP_PANEL.h,{c:T.strokeHi,fill:T.panel,cut:sn(14),asym:true});
  // 标题带：左琥珀右枪灰（面板坐标恒定，渐变对象建一次复用）
  if(!shopHdGrad){
    shopHdGrad=ctx.createLinearGradient(SHOP_HEAD.x,0,SHOP_HEAD.x+SHOP_HEAD.w,0);
    shopHdGrad.addColorStop(0,'rgba(74,52,22,0.95)');shopHdGrad.addColorStop(0.62,'rgba(35,42,53,0.95)');
  }
  UI.drawChamferPanel(ctx,SHOP_HEAD.x,SHOP_HEAD.y,SHOP_HEAD.w,SHOP_HEAD.h,{c:T.amber,fill:shopHdGrad,cut:sn(7),lw:1,ticks:false,inner:false});
  ctx.fillStyle=T.amberHi;ctx.font=SFL(17,true);
  ctx.fillText('补 给 站 · 第 '+stage+' 关',sx(28),sy(21)+sbl(17));
  ctx.textAlign='right';ctx.fillStyle=UI.rgba(T.amber,0.55);ctx.font=SFS(11);
  ctx.fillText('STATION 0'+stage,sx(375),sy(26)+sbl(11));
  // 余额（主视觉）+ 本关收入（右侧次级）
  ctx.textAlign='left';ctx.fillStyle=T.amberHi;ctx.font=SFS(29,true);
  ctx.fillText('¥ '+runCoins,sx(16),sy(56)+sbl(29));
  ctx.textAlign='right';ctx.fillStyle=T.okHi;ctx.font=SFS(13,true);
  ctx.fillText('本关收入 +'+runCoinIncome,sx(384),sy(64)+sbl(13));
  if(coinDoubled){ctx.fillStyle=T.amber;ctx.font=SFL(11);ctx.fillText('已翻倍',sx(384),sy(80)+sbl(11));}
  ctx.textAlign='left';
  // 三张随机强化牌
  for(let i=0;i<3;i++){
    const b=offer[i];if(!b)continue;
    const c=SHOP_CARDS[i],R=b.rar==='R',CORE=b.core,p=priceOf(b),can=runCoins>=p;
    const rc0=CORE?T.rareCore:(R?T.rareR:T.rareN); // 稀有度主色
    const near=!can&&runCoins>=p*0.55; // 差一点：给余额进度条与差额，引导"再杀几架"
    UI.drawChamferPanel(ctx,c.x,c.y,c.w,c.h,{
      c:can?rc0:(near?UI.rgba(T.dangerHi,0.75):(CORE?UI.rgba(T.rareCore,0.45):T.stroke)), // 核心牌全程紫红：远处也认得出"这是攒钱目标"
      fill:can?T.panel2:(near?T.panel2:T.panelDeep),
      cut:sn(10),lw:1.5,ticks:false});
    // 弹药舱式图标槽：切角舱位 + 稀有度色单字（亮度随购买力降级，舱底保留稀有度）
    const iw=sn(54),ix=c.x+sn(12),iy=c.y+sn(21),tx=c.x+sn(78);
    ctx.fillStyle=can?UI.rgba(rc0,0.15):(near?'rgba(140,160,190,0.10)':UI.rgba(rc0,0.08));
    UI.chamferPath(ctx,ix,iy,iw,iw,sn(7));ctx.fill();
    ctx.strokeStyle=can?UI.rgba(rc0,0.5):UI.rgba(T.strokeHi,0.3);ctx.lineWidth=1;
    UI.chamferPath(ctx,ix,iy,iw,iw,sn(7));ctx.stroke();
    ctx.textAlign='center';ctx.font=SFS(28,true);
    ctx.fillStyle=can?rc0:(near?'#8fa3bd':T.textFaint);
    ctx.fillText(b.letter,ix+iw/2,iy+iw/2);
    ctx.textAlign='left';const nameFont=SFL(17,true);ctx.font=nameFont;
    const nameW=shopTextWidth(b.name,nameFont);
    ctx.fillStyle=can?T.text:(near?'#c9d2dd':T.textFaint);
    ctx.fillText(b.name,tx,c.y+sn(22)+sbl(17));
    ctx.font=SFS(12);ctx.fillStyle=can?rc0:T.textFaint;
    ctx.fillText('Lv'+(buffLv(b.id)+1)+'/'+b.max,tx+nameW+sn(6),c.y+sn(22)+sbl(17));
    ctx.font=SFL(12);
    ctx.fillStyle=can?UI.rgba(T.textDim,0.9):(near?UI.rgba(T.textDim,0.55):UI.rgba(T.textDim,0.4));
    ctx.fillText(b.desc,tx,c.y+sn(50)+sbl(12));
    // 稀有度角标（核心牌标「核」）
    ctx.font=SFS(11);
    const rlab=b.core?'核':b.rar;
    const cw=shopTextWidth(rlab,SFS(11))+sn(12),ch=sn(15),cx0=c.x+c.w-sn(14)-cw,cy0=c.y+sn(14);
    const rcol=can?rc0:(near?UI.rgba(rc0,0.8):UI.rgba(rc0,0.32));
    ctx.strokeStyle=rcol;ctx.lineWidth=1;
    UI.chamferPath(ctx,cx0,cy0,cw,ch,sn(3));ctx.stroke();
    ctx.fillStyle=rcol;ctx.textAlign='center';
    ctx.fillText(rlab,cx0+cw/2,cy0+ch/2);ctx.textAlign='left';
    if(near){ // 差额提示：橙红细条走完 = 本关收入再叠一截就买得起
      const bw=sn(150),bx=c.x+sn(78),by=c.y+sn(70),bh=Math.max(1,sn(2));
      ctx.fillStyle='rgba(255,255,255,0.1)';ctx.fillRect(bx,by,bw,bh);
      ctx.fillStyle=T.dangerHi;ctx.fillRect(bx,by,bw*Math.min(1,runCoins/p),bh);
      ctx.font=SFL(11);ctx.fillStyle=T.dangerHi;
      ctx.fillText('差 ¥'+(p-runCoins)+' · 击杀敌机补足',bx,c.y+sn(76)+sbl(11));
    }else if(!can){ // 完全买不起：锁形（两段线画，替代稿中 SVG 图标）；左移避开稀有度角标
      const ls=sn(14),lx=c.x+c.w-sn(46)-ls/2,ly=c.y+sn(13);
      ctx.strokeStyle=T.textFaint;ctx.lineWidth=Math.max(1,sn(1.6));
      ctx.strokeRect(lx,ly+ls*0.38,ls,ls*0.62);
      ctx.beginPath();ctx.arc(lx+ls/2,ly+ls*0.38,ls*0.28,Math.PI,Math.PI*2);ctx.stroke();
    }
    ctx.textAlign='right';ctx.font=SFS(17,true);
    ctx.fillStyle=can?T.amberHi:T.dangerHi;
    ctx.fillText('¥ '+p,c.x+c.w-sn(14),c.y+sn(64)+sbl(17));
    ctx.textAlign='left';
  }
  // 固定升级项：战力与血线的确定性消费（掉落退役后的武器成长通道）
  UI.sectionTitle(ctx,SHOP_SEC.x,SHOP_SEC.y+sbl(11),SHOP_SEC.w,'固定升级 · FIXED',T.rareN);
  for(let i=0;i<SHOP_FIX.length;i++){
    const f=SHOP_FIX[i],c=SHOP_FIX_CARDS[i],usable=f.can(),cost=f.cost(),can2=usable&&runCoins>=cost;
    const maxed=!usable&&(f.id==='gun'?player.wlevel>=4:f.id==='mis'?player.mlevel>=3:false); // 满级(MAX)与不适用(—)分开：前者是成就、后者是当前无关
    UI.drawChamferPanel(ctx,c.x,c.y,c.w,c.h,{
      c:can2?T.ok:(!usable?(maxed?UI.rgba(T.rareN,0.42):T.stroke):T.stroke),
      fill:T.panelDeep,cut:sn(8),lw:1.5,ticks:false,inner:false});
    const gw=sn(22),gx=c.x+c.w/2-gw/2;
    ctx.fillStyle=can2?UI.rgba(T.ok,0.16):(!usable?(maxed?UI.rgba(T.rareN,0.10):'rgba(120,140,170,0.08)'):'rgba(120,140,170,0.12)');
    UI.chamferPath(ctx,gx,c.y+sn(9),gw,gw,sn(5));ctx.fill();
    ctx.textAlign='center';ctx.font=SFS(13,true);
    ctx.fillStyle=can2?T.okHi:(!usable?(maxed?UI.rgba(T.rareN,0.45):T.textFaint):T.textDim);
    ctx.fillText(f.name.charAt(0),c.x+c.w/2,c.y+sn(9)+gw/2);
    ctx.font=SFL(12);
    ctx.fillStyle=can2?T.text:(!usable?(maxed?T.textFaint:T.textFaint):T.textDim);
    ctx.fillText(f.name,c.x+c.w/2,c.y+sn(34)+sbl(12));
    ctx.font=SFS(12,true);
    ctx.fillStyle=usable?(can2?T.amberHi:T.dangerHi):(maxed?T.rareN:T.textFaint);
    ctx.fillText(usable?'¥ '+cost:(maxed?'MAX':'—'),c.x+c.w/2,c.y+sn(53)+sbl(12));
    ctx.textAlign='left';
  }
  // 刷新两用：优先看广告免费刷（每关 1 次），已用则金币刷（费用递增）
  const rc=refreshCost(),c1=SHOP_REFRESH;
  UI.drawChamferPanel(ctx,c1.x,c1.y,c1.w,c1.h,{
    c:!adRefreshUsed?T.danger:(runCoins>=rc?T.rareN:T.stroke),
    fill:!adRefreshUsed?'rgba(52,24,16,0.92)':T.panelDeep,
    cut:sn(9),lw:1.5,ticks:false});
  ctx.textAlign='center';ctx.font=SFL(!adRefreshUsed?13:14,true);
  ctx.fillStyle=adRefreshBusy?T.textFaint:(!adRefreshUsed?T.dangerHi:(runCoins>=rc?T.rareN:T.textFaint));
  ctx.fillText(adRefreshUsed?'刷新 ¥'+rc:'▶ 看广告 免费刷新',c1.x+c1.w/2,c1.y+c1.h/2);
  // 出战：带构筑进下一关（琥珀出战指令）
  const c2=SHOP_GO;
  UI.drawChamferPanel(ctx,c2.x,c2.y,c2.w,c2.h,{c:T.amber,fill:'rgba(62,42,16,0.94)',cut:sn(9),lw:1.5,ticks:false});
  ctx.fillStyle=T.amberHi;ctx.font=SFL(16,true);
  ctx.fillText('出 战',c2.x+c2.w/2-sn(8),c2.y+c2.h/2);
  const ay=c2.y+c2.h/2;
  ctx.beginPath();ctx.moveTo(c2.x+c2.w-sn(16),ay-sn(5));ctx.lineTo(c2.x+c2.w-sn(9),ay);ctx.lineTo(c2.x+c2.w-sn(16),ay+sn(5));ctx.closePath();ctx.fill();
  ctx.fillStyle=UI.rgba(T.amber,0.5);
  ctx.beginPath();ctx.moveTo(c2.x+c2.w-sn(24),ay-sn(5));ctx.lineTo(c2.x+c2.w-sn(17),ay);ctx.lineTo(c2.x+c2.w-sn(24),ay+sn(5));ctx.closePath();ctx.fill();
  // 本关金币翻倍（每关 1 次；ADS_OFF 时整块入口不画）
  const c3=SHOP_ADCOIN,on=!ADS_OFF&&!coinDoubled&&runCoinIncome>0;
  if(!ADS_OFF){
    UI.drawChamferPanel(ctx,c3.x,c3.y,c3.w,c3.h,{c:on?T.amber:T.stroke,fill:on?'rgba(62,42,16,0.94)':UI.rgba(T.panelDeep,0.8),cut:sn(8),lw:1.5,ticks:false});
    ctx.fillStyle=on?T.amberHi:T.textFaint;ctx.font=SFL(13,true);
    ctx.fillText(coinDoubled?'本关金币已翻倍':(on?'▶ 看广告 本关金币翻倍 +'+runCoinIncome:'本关暂无金币收入'),c3.x+c3.w/2,c3.y+c3.h/2);
  }
  // 本局构筑摘要：广告关闭时上移占用原广告区，不保留空洞
  const c4=ADS_OFF?SHOP_ADCOIN:SHOP_BUILD;
  UI.drawChamferPanel(ctx,c4.x,c4.y,c4.w,c4.h,{c:T.stroke,fill:T.panelDeep,cut:sn(7),lw:1,ticks:false,inner:false});
  ctx.fillStyle=UI.rgba(T.textDim,0.85);ctx.font=SFL(11);
  ctx.fillText('本局构筑 '+runPicks+' 张',c4.x+sn(12),c4.y+sn(8)+sbl(11));
  const bl=shopBuildList(),ts=sn(28);
  for(let i=0;i<7;i++){
    const e=bl[i],bx=c4.x+sn(108+i*33),by=c4.y+sn(11);
    ctx.fillStyle=e?UI.rgba(e.rar==='R'?T.rareR:T.rareN,0.15):'rgba(120,140,170,0.08)';
    UI.chamferPath(ctx,bx,by,ts,ts,sn(5));ctx.fill();
    if(e){
      ctx.textAlign='center';ctx.font=SFS(14,true);
      ctx.fillStyle=e.rar==='R'?T.rareR:T.rareN;
      ctx.fillText(e.letter,bx+ts/2,by+ts/2);ctx.textAlign='left';
    }
  }
  if(runTopBuff.n>0){
    ctx.font=SFL(11);ctx.fillStyle=UI.rgba(T.textDim,0.85);
    const k='最强 ',kf=SFL(11);
    ctx.font=kf;ctx.fillText(k,c4.x+sn(12),c4.y+sn(28)+sbl(11));
    ctx.fillStyle=T.amberHi;ctx.font=SFL(11,true);
    ctx.fillText(runTopBuff.name+' ×'+runTopBuff.n,c4.x+sn(12)+shopTextWidth(k,kf),c4.y+sn(28)+sbl(11));
  }
  ctx.restore();
}
// 结算面板构筑摘要：本局拿牌数 + 最多的牌（纯展示，给结算页一点"这局玩了个什么流派"的谈资）
function drawRunSummary(){
  if(runPicks<=0)return;
  ctx.fillStyle=T.textDim;ctx.font='13px '+T.fontUI;ctx.textAlign='center';
  ctx.fillText(`构筑 ${runPicks} 张 · ${runTopBuff.name}×${runTopBuff.n}`,W/2,H/2+206); // 下移避开 toast 行(H/2+188)
  ctx.textAlign='left';
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
