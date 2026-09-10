// theme.js - 军武 + 航空仪表 静态主题 token（深空战机任务控制界面）
// 只放主域静态语义色板与数据字体：不做运行时换肤、不做配置项、不做存储开关。
// openDataContext（沙箱子域）不导入本模块，保留自己的本地镜像色板。
const THEME = {
  // 背景（深空）
  bg: '#090B11',
  bg2: '#0D111A',
  // 面板（枪灰实底）
  panel: '#1E222B',
  panel2: '#232A35',
  panelDeep: '#161A22',
  // 钢灰描边
  stroke: '#384351',
  strokeHi: '#7A8694',
  // 文字（米白为主，弱化灰阶辅助）
  text: '#ECE6D7',
  textDim: '#98A0AA',
  textFaint: '#5D6672',
  // 唯一主强调色：航空琥珀橙
  amber: '#D5892D',
  amberHi: '#F0A93F',
  amberDim: '#8A5A22',
  // 状态语义
  ok: '#7BA05B',      // 成功军绿
  okHi: '#9CC27B',
  warn: '#D5A02D',    // 警戒黄（玩家血量中段阈值等）
  danger: '#E0553A',  // 危险橙红
  dangerHi: '#F07A5C',
  // 稀有度：普通冷钢蓝 / 稀有琥珀金 / 核心低饱和警戒紫红
  rareN: '#7FA8C9',
  rareR: '#D9A03F',
  rareCore: '#A85570',
  // 数据字体：数字、分数、价格、序列号
  fontData: 'monospace',
  fontUI: 'sans-serif',
};
module.exports = THEME;
