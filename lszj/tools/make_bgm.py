# -*- coding: utf-8 -*-
"""
make_bgm.py — 《怒雷风暴》BGM：芯片音乐作曲器（与 make_sfx.py 同管线）
风格：复刻 NES 四通道——方波主旋律 / 25%占空比琶音 / 三角波贝斯 / 量化噪声鼓组
曲式：前奏(4bar) → A主题(16bar) → 间奏(8bar) → A'加强(16bar) ⇒ 无缝循环
     150 BPM，A小调，总计 44 小节 = 70.4 秒
输出：assets/audio/bgm.wav → ffmpeg 转 bgm.mp3（CDN 用）
"""
import numpy as np, wave, os, subprocess

SR = 22050
BPM = 150
STEP = 60 / BPM / 4          # 十六分音符步长 = 0.1s
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'audio')

# ---------- 音符工具 ----------
def m2f(m): return 440.0 * 2 ** ((m - 69) / 12)   # MIDI → 频率
_PC = dict(C=0, Cs=1, D=2, Ds=3, E=4, F=5, Fs=6, G=7, Gs=8, A=9, As=10, B=11)
N = {f'{n}{o}': 12 * (o + 1) + s for o in range(1, 9) for n, s in _PC.items()}  # N['A4']=69
# 常用音（简写）：如 N['A4']=69

# ---------- 芯片通道（与 make_sfx.py 同款音色） ----------
def square(f, dur, duty=0.5, vol=1.0):
    f = np.asarray(f, dtype=float)
    if f.ndim == 0: f = np.full(int(SR * dur), float(f))
    ph = np.cumsum(f) / SR
    return np.interp(ph % 1.0, [0, duty, duty, 1], [1, 1, -1, -1]) * vol

def tri(f, dur, vol=1.0):
    f = np.asarray(f, dtype=float)
    if f.ndim == 0: f = np.full(int(SR * dur), float(f))
    ph = np.cumsum(f) / SR
    return (2 * np.abs(2 * ((ph % 1.0) - 0.5)) - 1) * vol

_rng = np.random.default_rng(7)
def noise(dur, vol=1.0, bits=4):
    n = _rng.integers(-(2**bits)//2, (2**bits)//2 + 1, int(SR * dur))
    return (n / (2**bits//2)) * vol

def env(x, a=0.004, r=None):
    n = len(x); e = np.ones(n)
    ai = min(int(a * SR), n); e[:ai] = np.linspace(0, 1, ai)
    if r is None: r = n / SR
    e *= np.exp(-np.arange(n) / (r * SR / 4))
    return x * e

def place(buf, x, at_step):
    """把波形 x 放进总缓冲的指定步位置（十六分音符步）"""
    off = int(at_step * STEP * SR)
    end = min(off + len(x), len(buf))
    if off < len(buf): buf[off:end] += x[:end - off]

# ---------- 鼓组 ----------
def kick():  return env(tri(150 * (1 - 0.9 * np.arange(int(SR*0.09))/ (SR*0.09)), 0.09, vol=1.0), a=0.001, r=0.05)
def snare(): return env(noise(0.12, bits=4), a=0.001, r=0.045) * 0.8
def hat():   return env(noise(0.03, bits=3), a=0.001, r=0.012) * 0.45
_K, _S = kick(), snare()

# ---------- 曲谱 ----------
# 44 小节，每小节 16 步；总长精确取整保证循环无缝
BARS = 44
TOTAL = int(BARS * 16 * STEP * SR)
lead = np.zeros(TOTAL); arp = np.zeros(TOTAL); bass = np.zeros(TOTAL); drum = np.zeros(TOTAL)

# 和弦进行（每小节一个和弦，用于琶音/贝斯）：Am F C G | Am F E(7) Am …
CH = {
  'intro': ['Am','Am','F','G'],
  'A':     ['Am','F','C','G','Am','F','Dm','E','Am','F','C','G','Dm','Am','E','E'],
  'B':     ['Dm','Am','Dm','Am','F','G','E','E'],
  'A2':    ['Am','F','C','G','Am','F','Dm','E','Am','F','C','G','Dm','Am','E','Am'],
}
CHORD_TONES = {  # 和弦 → [根,三,五,八度] MIDI（琶音用，A3 起）
  'Am':[N['A3'],N['C4'],N['E4'],N['A4']], 'F':[N['F3'],N['A3'],N['C4'],N['F4']],
  'C' :[N['C3'],N['E3'],N['G3'],N['C4']], 'G' :[N['G3'],N['B3'],N['D4'],N['G4']],
  'Dm':[N['D3'],N['F3'],N['A3'],N['D4']], 'E' :[N['E3'],N['Gs3'],N['B3'],N['E4']],
}
ROOT = {c: t[0] - 12 for c, t in CHORD_TONES.items()}  # 贝斯根音低八度

def bar_chords(sec, i): return CH[sec][i % len(CH[sec])]

# ---- 主旋律（十六分步记谱：(midi, 步长) 序列，None=休止）----
def phrase_a1():  # Am F C G — 主题第一句：上行冲顶后回落
    return [(N['A4'],2),(N['C5'],2),(N['E5'],3),(N['D5'],1),(N['C5'],2),(N['D5'],2),
            (N['E5'],4),(None,2),(N['G4'],2),(N['A4'],4)]
def phrase_a2():  # 第二句：模进到高八度，更有推进感
    return [(N['A4'],2),(N['C5'],2),(N['E5'],2),(N['A5'],3),(N['G5'],1),(N['E5'],2),(N['G5'],2),
            (N['E5'],4),(None,4)]
def phrase_a3():  # Dm → E：小调转折，制造张力
    return [(N['D5'],3),(N['E5'],1),(N['F5'],2),(N['E5'],2),(N['D5'],2),(N['C5'],2),
            (N['B4'],6),(N['Gs4'],2),(N['B4'],4),(None,2)]
def phrase_a4():  # 收束句：E7 悬置 → 回 Am
    return [(N['E5'],2),(N['D5'],2),(N['C5'],2),(N['B4'],2),(N['Gs4'],4),(N['B4'],4),
            (N['A4'],6),(None,2)]
MELODY_A = [phrase_a1(), phrase_a2(), phrase_a3(), phrase_a4()]  # 4 小节一句 ×4 = 16 小节

def phrase_b1():  # 间奏：长音蓄力 + 琶音接力
    return [(N['D5'],8),(N['C5'],4),(N['D5'],4)]
def phrase_b2():
    return [(N['F5'],6),(N['E5'],2),(N['D5'],4),(N['C5'],4)]
def phrase_b3():  # E 和弦上攀升，接入 A' 段
    return [(N['E5'],2),(N['Gs5'],2),(N['B5'],4),(N['E5'],2),(N['Gs5'],2),(N['B5'],4)]
def phrase_b4():
    return [(N['B5'],8),(None,8)]
MELODY_B = [phrase_b1(), phrase_b2(), phrase_b3(), phrase_b4()]  # ×2 = 8 小节

def render_melody(phrases, start_bar, duty=0.5, vol=0.32):
    for pi, ph in enumerate(phrases):
        step = (start_bar + pi) * 16
        for midi, dur in ph:
            if midi:
                d = dur * STEP
                w = env(square(m2f(midi), d, duty=duty, vol=vol), a=0.004, r=min(d * 1.35, 0.22))
                place(lead, w, step)
            step += dur

# ---- 逐段渲染 ----
# 前奏 4 小节：鼓点铺垫 + 贝斯脉冲 + 上行琶音渐强，无主旋律
for i in range(4):
    b = i; ch = bar_chords('intro', i)
    for s in range(0, 16, 2): place(drum, _K, b * 16 + s) if i >= 2 else None
    if i >= 1:
        for s in (4, 12): place(drum, _S, b * 16 + s)
    for s in range(0, 16, 2):  # 八分贝斯脉冲
        place(bass, env(tri(m2f(ROOT[ch]), STEP * 1.6, vol=0.85), a=0.003, r=0.09), b * 16 + s)
    tones = CHORD_TONES[ch]
    for s in range(16):  # 十六分琶音（音量随小节渐强）
        v = 0.05 + 0.07 * i / 3
        place(arp, env(square(m2f(tones[s % 4] + 12), STEP * 0.9, duty=0.25, vol=v), a=0.002, r=0.05), b * 16 + s)

# A 段 16 小节：全编制
def render_full_section(sec, start_bar, lead_vol=0.32, drums=True, arp_oct=12):
    bars = len(CH[sec])
    for i in range(bars):
        b = start_bar + i; ch = bar_chords(sec, i); tones = CHORD_TONES[ch]
        if drums:  # 鼓组：底鼓 0/8，军鼓 4/12，踩镲每 2 步
            place(drum, _K, b * 16); place(drum, _K, b * 16 + 8)
            place(drum, _S, b * 16 + 4); place(drum, _S, b * 16 + 12)
            for s in range(0, 16, 2): place(drum, hat(), b * 16 + s)
        r = ROOT[ch]
        for s, m in enumerate([r, r, r+12, r, r, r+12, r, r] + [r, r, r+12, r, r, r, r+12, r]):  # 行进感贝斯
            place(bass, env(tri(m2f(m), STEP * 1.5, vol=0.9), a=0.003, r=0.08), b * 16 + s)
        for s in range(16):  # 琶音（和弦音上行循环）
            place(arp, env(square(m2f(tones[s % 4] + arp_oct), STEP * 0.9, duty=0.25, vol=0.10), a=0.002, r=0.05), b * 16 + s)

render_full_section('A', 4)
render_melody(MELODY_A, 4)

# 间奏 8 小节：去鼓留底噪律动，琶音接力主旋律
render_full_section('B', 20, drums=False, arp_oct=12)
render_melody(MELODY_B, 20, duty=0.25, vol=0.26)  # 间奏主旋律换 25% 占空比音色，听感变"远"
for i in range(6, 8):  # 间奏最后 2 小节鼓点滚奏填充，拉回 A'
    b = 20 + i
    for s in range(0, 16, 1): place(drum, snare() * (0.3 + 0.5 * s / 16), b * 16 + s) if s % 2 == 0 else place(drum, hat(), b * 16 + s)

# A' 段 16 小节：主题重现 + 加强（琶音高八度、主旋律更亮）
render_full_section('A2', 28, arp_oct=24)
render_melody(MELODY_A, 28, duty=0.5, vol=0.34)

# ---- 主旋律加回声（3/16 拍延迟，街机厅的感觉） ----
d = int(3 * STEP * SR)
echo = np.zeros_like(lead); echo[d:] = lead[:-d] * 0.28
lead += echo

# ---- 混音 ----
mixdown = np.clip(lead + arp + bass + drum, -1, 1)
# 轻压限防削波：tanh 软饱和
mixdown = np.tanh(mixdown * 1.1) * 0.92

def save(name, data):
    pcm = (np.clip(data, -1, 1) * 32767).astype('<i2')
    with wave.open(os.path.join(OUT, name), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f'{name}: {len(data)/SR:.1f}s  {os.path.getsize(os.path.join(OUT,name)):,}B')

save('bgm.wav', mixdown)

# 循环无缝校验：首尾 20ms 电平
head, tail = np.abs(mixdown[:441]).max(), np.abs(mixdown[-441:]).max()
print(f'循环接缝电平：头 {head:.3f} / 尾 {tail:.3f}（均应接近 0）')
