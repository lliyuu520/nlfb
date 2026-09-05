# -*- coding: utf-8 -*-
"""
make_sfx.py — 《怒雷风暴》8-bit 芯片音效合成器
风格：复刻 NES/Famicom 三通道（方波 lead / 三角波低音 / 量化噪声打击）
输出：assets/audio/*.wav（22050Hz 16bit 单声道，单个体积仅几 KB，适合打进小游戏包）

通道说明：
  square(f, duty)   方波（占空比可调，12.5%/25% 是 NES 经典音色）
  tri(f)            三角波（低音/打击底鼓）
  noise(bits)       量化噪声（模拟 NES 噪声通道，量化到 2^bits 级）
"""
import numpy as np, wave, os

SR = 22050
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'audio')
os.makedirs(OUT, exist_ok=True)

def t(dur): return np.arange(int(SR * dur)) / SR

def square(f, dur, duty=0.5, vol=1.0):
    """频率可以是标量或随时间变化的数组（相位积分生成，支持平滑扫频）"""
    f = np.asarray(f, dtype=float)
    if f.ndim == 0: f = np.full(int(SR * dur), float(f))
    ph = np.cumsum(f) / SR
    d = np.interp(ph % 1.0, [0, duty, duty, 1], [1, 1, -1, -1])
    return d * vol

def tri(f, dur, vol=1.0):
    f = np.asarray(f, dtype=float)
    if f.ndim == 0: f = np.full(int(SR * dur), float(f))
    ph = np.cumsum(f) / SR
    return (2 * np.abs(2 * ((ph % 1.0) - 0.5)) - 1) * vol  # 三角波

def noise(dur, vol=1.0, bits=4):
    n = np.random.default_rng(42).integers(-(2**bits)//2, (2**bits)//2 + 1, int(SR * dur))
    return (n / (2**bits//2)) * vol

def env(x, a=0.005, r=None):
    """快攻击 + 指数衰减包络"""
    n = len(x); envl = np.ones(n)
    ai = min(int(a * SR), n)
    envl[:ai] = np.linspace(0, 1, ai)
    if r is None: r = n / SR
    envl *= np.exp(-np.arange(n) / (r * SR / 4))
    return x * envl

def mix(*tracks):
    """tracks: (offset_sec, waveform) 列表 → 混音到同一缓冲"""
    n = max(off + len(x) for off, x in tracks)
    out = np.zeros(n)
    for off, x in tracks:
        out[off:off + len(x)] += x
    return np.clip(out, -1, 1)

def seq(freqs, note, gap=0.0, **kw):
    """音序器：按拍播放方波音符序列，返回 (offset, wave) 列表"""
    tr, off = [], 0
    for f in freqs:
        if f > 0: tr.append((off, env(square(f, note, **kw), r=note * 1.2)))
        off += int(SR * (note + gap))
    return tr

def save(name, data, vol=1.0):
    data = np.clip(data * vol, -1, 1)
    pcm = (data * 32767).astype('<i2')
    with wave.open(os.path.join(OUT, name), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f'{name:16s} {len(data)/SR:.2f}s  {os.path.getsize(os.path.join(OUT,name)):>6,}B')

# ---------- 战斗类 ----------
# 射击：高→低快扫频方波，极短促（自动连发每 0.12s 一次，必须更短）
sw = t(0.07)
save('shoot.wav', env(square(950 * (1 - 0.72 * sw / 0.07), 0.07, duty=0.25, vol=0.8), a=0.002, r=0.05), 0.5)

# 敌机爆炸：噪声爆裂 + 三角波底鼓下坠
nz = env(noise(0.3, bits=4), a=0.001, r=0.09)
tb = env(tri(160 * (1 - 0.8 * t(0.15) / 0.15), 0.15), a=0.001, r=0.06) * 0.9
save('boom.wav', mix((0, nz), (0, tb)), 0.85)

# Boss 爆炸：三层叠加——超低频下坠 + 长噪声 + 中段二次爆裂
sub = env(tri(120 * (1 - 0.95 * t(0.7) / 0.7), 0.7, vol=0.9), a=0.002, r=0.35)
nz1 = env(noise(0.8, bits=4), a=0.001, r=0.22) * 0.8
nz2 = (0, env(noise(0.35, bits=3), a=0.001, r=0.10) * 0.7)  # 中段碎裂
save('boss_boom.wav', mix((0, sub), (0, nz1), nz2), 0.95)

# 玩家阵亡：下行锯感扫频（用 25% 方波）+ 噪声，悲壮坠落
sw = t(0.65)
fall = env(square(760 * (2 ** (-2.2 * sw / 0.65)), 0.65, duty=0.25, vol=0.8), a=0.005, r=0.3)
nz = env(noise(0.5, bits=4), a=0.001, r=0.15) * 0.6
save('death.wav', mix((0, fall), (0, nz)), 0.9)

# ---------- 反馈类 ----------
# 道具拾取：两连快上行方波（轻快"叮叮"）
save('pickup.wav', mix(*seq([659, 988], 0.06, gap=0.01, duty=0.5, vol=0.8)), 0.7)

# 武器升级：四音大调琶音上行（胜利感）
save('upgrade.wav', mix(*seq([523, 659, 784, 1047], 0.07, gap=0.01, duty=0.5, vol=0.8)), 0.75)

# 购买/金币：经典双音"叮-咚"（B5→E6）
save('coin.wav', mix((0, env(square(988, 0.06, vol=0.8), r=0.05)),
                     (int(SR * 0.06), env(square(1319, 0.22, vol=0.8), r=0.18))), 0.7)

# 按钮点击：超短高音 blip + 噪声 tick
save('click.wav', mix((0, env(square(1200, 0.03, duty=0.5, vol=0.7), a=0.001, r=0.02)),
                      (0, env(noise(0.02, bits=3), a=0.001, r=0.012) * 0.5)), 0.6)

# ---------- 节点类 ----------
# Boss 警报：三组 双音警笛（G4↔D5 交替），紧迫感
alarm = []
off = 0
for _ in range(3):
    alarm.append((off, env(square(392, 0.16, duty=0.5, vol=0.75), a=0.004, r=0.12)))
    alarm.append((off + int(SR * 0.16), env(square(587, 0.16, duty=0.5, vol=0.75), a=0.004, r=0.12)))
    off += int(SR * 0.36)
save('alarm.wav', mix(*alarm), 0.8)

# 通关结算：大调琶音冲刺 + 落点和弦（C-E-G-C…G C 大和弦）
fan = seq([523, 659, 784, 1047, 1319, 1568], 0.07, gap=0.005, duty=0.5, vol=0.75)
chord_off = int(SR * 0.47)
save('clear.wav', mix(*fan,
                      (chord_off, env(square(784, 0.5, duty=0.5, vol=0.5), a=0.005, r=0.4)),
                      (chord_off, env(square(988, 0.5, duty=0.5, vol=0.5), a=0.005, r=0.4)),
                      (chord_off, env(tri(262, 0.5, vol=0.9), a=0.005, r=0.4))), 0.8)

# 游戏结束：小调下行乐句（A4→F4→D4→A3 低八度收尾），沉重收场
save('over.wav', mix(*seq([440, 349, 294, 220, 110], 0.22, gap=0.03, duty=0.5, vol=0.75),
                     (int(SR * 1.15), env(tri(110, 0.6, vol=0.9), a=0.01, r=0.5))), 0.8)

print('\n全部音效已生成 →', os.path.normpath(OUT))
