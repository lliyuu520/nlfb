// nulei-server —— 《怒雷风暴》世界榜后端
// 纯标准库实现：登录(code2Session)、分数上报、榜单查询、昵称设置。
// 数据落在 data/scores.json（原子写），配置在 data/config.json。
package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode"
)

// ---------- 配置 ----------

type Config struct {
	Addr            string `json:"addr"`            // 监听地址，默认仅本机（由 nginx 反代）
	BasePath        string `json:"basePath"`        // 路由前缀，需与 nginx location 一致
	AppID           string `json:"appId"`           // 小游戏 AppID
	AppSecret       string `json:"appSecret"`       // 小游戏 AppSecret，只放服务器
	TokenSecret     string `json:"tokenSecret"`     // HMAC 签名密钥，首次启动自动生成
	MaxScore        int64  `json:"maxScore"`        // 单局分数硬上限
	MaxScoreRate    int64  `json:"maxScoreRate"`    // 每秒理论最大得分（防作弊）
	MaxRunSec       int64  `json:"maxRunSec"`       // 单局时长上限（秒）：时长由客户端上报，超上限按异常拒绝
	MaxDailyReports int    `json:"maxDailyReports"` // 每玩家每日上报次数上限
	MaxNicknameLen  int    `json:"maxNicknameLen"`  // 昵称最大字符数（rune）
	TokenDays       int    `json:"tokenDays"`       // token 有效天数
	DevLogin        bool   `json:"devLogin"`        // 仅本地调试：跳过 code2Session
}

func defaultConfig() Config {
	return Config{
		Addr:            "127.0.0.1:12700",
		BasePath:        "/nulei/api",
		MaxScore:        9999999,
		MaxScoreRate:    800,
		MaxRunSec:       3600,
		MaxDailyReports: 50,
		MaxNicknameLen:  12,
		TokenDays:       30,
	}
}

func loadConfig(path string) (*Config, error) {
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		cfg := defaultConfig()
		if err := saveConfig(path, &cfg); err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("未找到配置，已生成模板 %s，请填入 appId/appSecret 后重启（本地调试将 devLogin 设为 true）", path)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	cfg := defaultConfig()
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("解析配置 %s: %w", path, err)
	}
	if cfg.TokenSecret == "" {
		buf := make([]byte, 32)
		if _, err := rand.Read(buf); err != nil {
			return nil, err
		}
		cfg.TokenSecret = hex.EncodeToString(buf)
		if err := saveConfig(path, &cfg); err != nil {
			return nil, err
		}
		log.Printf("已生成随机 tokenSecret 并写回 %s", path)
	}
	return &cfg, nil
}

func saveConfig(path string, cfg *Config) error {
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// ---------- 存储 ----------
// ponytail: 内存 map + JSON 文件原子落盘，天花板为十万级玩家、低频写（仅破纪录时写）。
// 玩家规模上去后再换 SQLite/Redis，替换点收敛在 Store 一处。

type Player struct {
	OpenID    string `json:"openid"`
	Nickname  string `json:"nickname,omitempty"`
	BestScore int64  `json:"bestScore"`
	UpdatedAt int64  `json:"updatedAt"`
	DurTotal  int64  `json:"durTotal,omitempty"` // 累计上报时长（秒）：做"总时长 ≤ 墙钟流逝"预算校验
	FirstAt   int64  `json:"firstAt,omitempty"`  // 首次上报时间，预算起点
}

type Store struct {
	mu   sync.Mutex
	path string
	byID map[string]*Player
}

func openStore(path string) (*Store, error) {
	s := &Store{path: path, byID: map[string]*Player{}}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &s.byID); err != nil {
			return nil, fmt.Errorf("解析存储 %s: %w", path, err)
		}
	}
	return s, nil
}

func (s *Store) saveLocked() error {
	raw, err := json.MarshalIndent(s.byID, "", " ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// peek 只读查询，不落盘（登录不产生空记录）
func (s *Store) peek(openid string) Player {
	s.mu.Lock()
	defer s.mu.Unlock()
	if p, ok := s.byID[openid]; ok {
		return *p
	}
	return Player{OpenID: openid}
}

// durBudgetSlack：累计时长预算的宽限（秒）。单局"分数≤速率×时长"里的时长是客户端自报的，
// 可伪造大时长绕过校验；再加一层"累计上报时长 ≤ 首次上报以来的墙钟时间+宽限"封顶。
// 正常玩家玩多久报多久永远够用，宽限只覆盖重试/时钟误差。
const durBudgetSlack int64 = 3600

var errDurBudget = errors.New("上报时长超出合理范围")

func (s *Store) submit(openid string, score int64, dur int64, now int64) (best int64, updated bool, rank int64, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.byID[openid]
	if !ok {
		p = &Player{OpenID: openid}
		s.byID[openid] = p
	}
	if p.FirstAt == 0 {
		p.FirstAt = now
	}
	if p.DurTotal+dur > now-p.FirstAt+durBudgetSlack {
		return 0, false, 0, errDurBudget
	}
	p.DurTotal += dur
	if score > p.BestScore {
		p.BestScore = score
		p.UpdatedAt = now
		updated = true
	}
	if err = s.saveLocked(); err != nil { // 时长预算每次上报都要落盘，否则重启后预算清零可被刷
		return 0, false, 0, err
	}
	best = p.BestScore
	rank, err = s.rankOfLocked(openid)
	return best, updated, rank, err
}

func (s *Store) setNickname(openid, nick string) (Player, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.byID[openid]
	if !ok {
		p = &Player{OpenID: openid}
		s.byID[openid] = p
	}
	p.Nickname = nick
	if err := s.saveLocked(); err != nil {
		return Player{}, err
	}
	return *p, nil
}

// sortedLocked 返回全部上榜玩家（分数降序，同分先达到者靠前）
func (s *Store) sortedLocked() []Player {
	ps := make([]Player, 0, len(s.byID))
	for _, p := range s.byID {
		if p.BestScore > 0 {
			ps = append(ps, *p)
		}
	}
	sort.Slice(ps, func(i, j int) bool {
		if ps[i].BestScore != ps[j].BestScore {
			return ps[i].BestScore > ps[j].BestScore
		}
		return ps[i].UpdatedAt < ps[j].UpdatedAt
	})
	return ps
}

func (s *Store) rankOfLocked(openid string) (int64, error) {
	ps := s.sortedLocked()
	for i, p := range ps {
		if p.OpenID == openid {
			return int64(i + 1), nil
		}
	}
	return 0, nil
}

func (s *Store) all() []Player {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sortedLocked()
}

func (s *Store) rankOf(openid string) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, _ := s.rankOfLocked(openid)
	return r
}

// ---------- token（HMAC 无状态签名） ----------

func signToken(secret, openid string, days int) string {
	exp := strconv.FormatInt(time.Now().AddDate(0, 0, days).Unix(), 10)
	payload := openid + "." + exp
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) +
		"." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func parseToken(secret, tok string) (string, error) {
	dot := strings.LastIndexByte(tok, '.')
	if dot <= 0 || dot == len(tok)-1 {
		return "", errors.New("token 格式错误")
	}
	payload, err := base64.RawURLEncoding.DecodeString(tok[:dot])
	if err != nil {
		return "", errors.New("token 载荷错误")
	}
	macB, err := base64.RawURLEncoding.DecodeString(tok[dot+1:])
	if err != nil {
		return "", errors.New("token 签名错误")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	if subtle.ConstantTimeCompare(macB, mac.Sum(nil)) != 1 {
		return "", errors.New("token 签名不匹配")
	}
	s := string(payload)
	d := strings.LastIndexByte(s, '.')
	if d <= 0 {
		return "", errors.New("token 载荷错误")
	}
	openid, expStr := s[:d], s[d+1:]
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return "", errors.New("token 已过期")
	}
	if openid == "" {
		return "", errors.New("token 无 openid")
	}
	return openid, nil
}

func authOpenid(r *http.Request, secret string) (string, error) {
	h := r.Header.Get("Authorization")
	tok := strings.TrimPrefix(h, "Bearer ")
	if tok == "" || tok == h {
		return "", errors.New("缺少 Authorization Bearer")
	}
	return parseToken(secret, tok)
}

// ---------- 每日限额 ----------

type dailyLimiter struct {
	mu  sync.Mutex
	max int
	day string
	cnt map[string]int
}

func newDailyLimiter(max int) *dailyLimiter {
	return &dailyLimiter{max: max, cnt: map[string]int{}, day: time.Now().Format("20060102")}
}

func (l *dailyLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	today := time.Now().Format("20060102")
	if today != l.day {
		l.day, l.cnt = today, map[string]int{}
	}
	l.cnt[key]++
	return l.cnt[key] <= l.max
}

// ---------- 微信 code2Session ----------

func code2Session(cfg *Config, code string) (string, error) {
	q := url.Values{}
	q.Set("appid", cfg.AppID)
	q.Set("secret", cfg.AppSecret)
	q.Set("js_code", code)
	q.Set("grant_type", "authorization_code")
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Get("https://api.weixin.qq.com/sns/jscode2session?" + q.Encode())
	if err != nil {
		return "", fmt.Errorf("微信接口不可达: %w", err)
	}
	defer resp.Body.Close()
	var out struct {
		OpenID  string `json:"openid"`
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("微信响应解析失败: %w", err)
	}
	if out.ErrCode != 0 || out.OpenID == "" {
		return "", fmt.Errorf("code2Session 失败 errcode=%d errmsg=%s", out.ErrCode, out.ErrMsg)
	}
	return out.OpenID, nil
}

// ---------- HTTP 基础 ----------

func errOf(msg string) map[string]string { return map[string]string{"error": msg} }

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func readJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		writeJSON(w, http.StatusBadRequest, errOf("请求体不是合法 JSON"))
		return false
	}
	return true
}

func realIP(r *http.Request) string {
	if v := r.Header.Get("X-Real-IP"); v != "" {
		return v
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func sanitizeNickname(s string, max int) string {
	var b strings.Builder
	n := 0
	for _, r := range strings.TrimSpace(s) {
		if unicode.IsControl(r) || r == 0x200B {
			continue
		}
		b.WriteRune(r)
		n++
		if n >= max {
			break
		}
	}
	return b.String()
}

func displayName(p Player) string {
	if p.Nickname != "" {
		return p.Nickname
	}
	oid := p.OpenID
	suffix := oid
	if len(oid) > 4 {
		suffix = oid[len(oid)-4:]
	}
	return "玩家_" + suffix
}

// ---------- 业务 handler ----------

type app struct {
	cfg       *Config
	store     *Store
	loginLim  *dailyLimiter // 按 IP 限登录
	reportLim *dailyLimiter // 按 openid 限上报
}

func (a *app) handlePing(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "now": time.Now().Unix()})
}

func (a *app) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code string `json:"code"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	code := strings.TrimSpace(req.Code)
	if len(code) < 4 || len(code) > 128 {
		writeJSON(w, http.StatusBadRequest, errOf("code 长度异常"))
		return
	}
	var openid string
	if a.cfg.DevLogin {
		// 本地调试：code 直接当 openid，仅允许安全字符
		for _, c := range code {
			if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-') {
				writeJSON(w, http.StatusBadRequest, errOf("devLogin 模式 code 仅限字母数字_-"))
				return
			}
		}
		openid = "dev_" + code
	} else {
		if !a.loginLim.allow(realIP(r)) {
			writeJSON(w, http.StatusTooManyRequests, errOf("登录请求过于频繁"))
			return
		}
		var err error
		openid, err = code2Session(a.cfg, code)
		if err != nil {
			log.Printf("login 失败: %v", err)
			writeJSON(w, http.StatusUnauthorized, errOf("登录失败，请重试"))
			return
		}
	}
	p := a.store.peek(openid)
	writeJSON(w, http.StatusOK, map[string]any{
		"token":  signToken(a.cfg.TokenSecret, openid, a.cfg.TokenDays),
		"name":   displayName(p),
		"best":   p.BestScore,
		"custom": p.Nickname != "",
	})
}

func (a *app) requireAuth(w http.ResponseWriter, r *http.Request) (string, bool) {
	openid, err := authOpenid(r, a.cfg.TokenSecret)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errOf("未登录或登录已过期"))
		return "", false
	}
	return openid, true
}

func (a *app) handleScore(w http.ResponseWriter, r *http.Request) {
	openid, ok := a.requireAuth(w, r)
	if !ok {
		return
	}
	var req struct {
		Score    int64 `json:"score"`
		Duration int64 `json:"duration"` // 本局秒数
	}
	if !readJSON(w, r, &req) {
		return
	}
	if req.Score < 0 || req.Score > a.cfg.MaxScore {
		writeJSON(w, http.StatusBadRequest, errOf("分数异常"))
		return
	}
	if req.Duration < 1 || req.Duration > a.cfg.MaxRunSec {
		writeJSON(w, http.StatusBadRequest, errOf("时长异常"))
		return
	}
	if req.Score > a.cfg.MaxScoreRate*req.Duration+2000 {
		writeJSON(w, http.StatusBadRequest, errOf("分数与时长不匹配"))
		return
	}
	if !a.reportLim.allow(openid) {
		writeJSON(w, http.StatusTooManyRequests, errOf("今日上报次数已达上限"))
		return
	}
	best, updated, rank, err := a.store.submit(openid, req.Score, req.Duration, time.Now().Unix())
	if err != nil {
		if errors.Is(err, errDurBudget) {
			writeJSON(w, http.StatusBadRequest, errOf("上报时长异常"))
			return
		}
		log.Printf("score 存储失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, errOf("存储失败"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"best": best, "rank": rank, "updated": updated})
}

func (a *app) handleRank(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 200 {
		limit = 200
	}
	top := a.store.all()
	total := len(top)
	if len(top) > limit {
		top = top[:limit]
	}
	type item struct {
		Rank   int64  `json:"rank"`
		Name   string `json:"name"`
		Score  int64  `json:"score"`
		Custom bool   `json:"custom"`
	}
	list := make([]item, 0, len(top))
	for i, p := range top {
		list = append(list, item{Rank: int64(i + 1), Name: displayName(p), Score: p.BestScore, Custom: p.Nickname != ""})
	}
	var me any
	if hdr := r.Header.Get("Authorization"); hdr != "" {
		if openid, err := authOpenid(r, a.cfg.TokenSecret); err == nil {
			p := a.store.peek(openid)
			if p.BestScore > 0 {
				me = map[string]any{"rank": a.store.rankOf(openid), "score": p.BestScore, "name": displayName(p), "custom": p.Nickname != ""}
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"list": list, "me": me, "total": total})
}

func (a *app) handleNickname(w http.ResponseWriter, r *http.Request) {
	openid, ok := a.requireAuth(w, r)
	if !ok {
		return
	}
	var req struct {
		Nickname string `json:"nickname"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	nick := sanitizeNickname(req.Nickname, a.cfg.MaxNicknameLen)
	if nick == "" {
		writeJSON(w, http.StatusBadRequest, errOf("昵称不能为空"))
		return
	}
	p, err := a.store.setNickname(openid, nick)
	if err != nil {
		log.Printf("nickname 存储失败: %v", err)
		writeJSON(w, http.StatusInternalServerError, errOf("存储失败"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"name": displayName(p), "custom": true})
}

// ---------- 日志包装 ----------

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (sw *statusWriter) WriteHeader(code int) {
	sw.status = code
	sw.ResponseWriter.WriteHeader(code)
}

func (a *app) logged(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		h(sw, r)
		log.Printf("%s %s -> %d %s ip=%s", r.Method, r.URL.Path, sw.status, time.Since(start).Round(time.Millisecond), realIP(r))
	}
}

// ---------- main ----------

func main() {
	confPath := flag.String("c", "data/config.json", "配置文件路径")
	flag.Parse()

	cfg, err := loadConfig(*confPath)
	if err != nil {
		log.Fatal(err)
	}
	if !cfg.DevLogin && (cfg.AppID == "" || cfg.AppSecret == "") {
		log.Fatalf("请在 %s 填入 appId/appSecret", *confPath)
	}
	store, err := openStore(filepath.Join(filepath.Dir(*confPath), "scores.json"))
	if err != nil {
		log.Fatal(err)
	}

	a := &app{
		cfg:       cfg,
		store:     store,
		loginLim:  newDailyLimiter(200),
		reportLim: newDailyLimiter(cfg.MaxDailyReports),
	}

	p := strings.TrimSuffix(cfg.BasePath, "/")
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+p+"/ping", a.logged(a.handlePing))
	mux.HandleFunc("POST "+p+"/login", a.logged(a.handleLogin))
	mux.HandleFunc("POST "+p+"/score", a.logged(a.handleScore))
	mux.HandleFunc("GET "+p+"/rank", a.logged(a.handleRank))
	mux.HandleFunc("POST "+p+"/nickname", a.logged(a.handleNickname))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotFound, errOf("not found"))
	})

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		log.Printf("nulei-server 监听 %s，路由前缀 %s，devLogin=%v，上榜玩家数=%d",
			cfg.Addr, p, cfg.DevLogin, len(store.all()))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("启动失败: %v", err)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("优雅关闭超时: %v", err)
	}
	log.Printf("nulei-server 已退出")
}
