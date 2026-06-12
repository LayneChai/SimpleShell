package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"
)

const (
	statusConnecting   = "Connecting"
	statusConnected    = "Connected"
	statusDisconnected = "Disconnected"
	statusError        = "Error"
)

type ConnectionOptions struct {
	SessionID            string `json:"sessionId"`
	Host                 string `json:"host"`
	Port                 int    `json:"port"`
	Username             string `json:"username"`
	AuthMethod           string `json:"authMethod"`
	Password             string `json:"password"`
	PrivateKeyPath       string `json:"privateKeyPath"`
	PrivateKeyPassphrase string `json:"privateKeyPassphrase"`
}

type TerminalSettings struct {
	BackgroundColorHex string  `json:"backgroundColorHex"`
	BackgroundOpacity  float64 `json:"backgroundOpacity"`
}

type ConnectionStatus struct {
	SessionID string `json:"sessionId"`
	State     string `json:"state"`
	Message   string `json:"message"`
}

type TerminalOutput struct {
	SessionID string `json:"sessionId"`
	Data      string `json:"data"`
}

type HostKeyPrompt struct {
	ID          string `json:"id"`
	SessionID   string `json:"sessionId"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Remote      string `json:"remote"`
	Algorithm   string `json:"algorithm"`
	Fingerprint string `json:"fingerprint"`
}

type sshSession struct {
	id      string
	client  *ssh.Client
	session *ssh.Session
	stdin   io.WriteCloser
	cols    int
	rows    int
}

type App struct {
	ctx context.Context

	mu       sync.Mutex
	sessions map[string]*sshSession
	cols     int
	rows     int

	settings *SettingsStore
	hostKeys *HostKeyStore

	pendingMu       sync.Mutex
	pendingHostKeys map[string]chan bool
}

func NewApp() *App {
	return &App{
		sessions:        make(map[string]*sshSession),
		cols:            80,
		rows:            24,
		settings:        NewSettingsStore(),
		hostKeys:        NewHostKeyStore(),
		pendingHostKeys: make(map[string]chan bool),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) shutdown(ctx context.Context) {
	_ = a.DisconnectAll()
}

func (a *App) Connect(options ConnectionOptions) (string, error) {
	options.SessionID = strings.TrimSpace(options.SessionID)
	options.Host = strings.TrimSpace(options.Host)
	options.Username = strings.TrimSpace(options.Username)
	options.AuthMethod = strings.TrimSpace(options.AuthMethod)

	if options.SessionID == "" {
		options.SessionID = fmt.Sprintf("session-%d", time.Now().UnixNano())
	}

	if err := validateConnectionOptions(options); err != nil {
		a.emitError(options.SessionID, err.Error())
		return "", err
	}

	a.mu.Lock()
	if _, exists := a.sessions[options.SessionID]; exists {
		a.mu.Unlock()
		err := fmt.Errorf("session %s already exists", options.SessionID)
		a.emitError(options.SessionID, err.Error())
		return "", err
	}
	cols, rows := a.cols, a.rows
	a.mu.Unlock()

	a.emitStatus(options.SessionID, statusConnecting, fmt.Sprintf("Connecting to %s:%d", options.Host, options.Port))

	authMethods, err := buildAuthMethods(options)
	if err != nil {
		a.emitStatus(options.SessionID, statusError, err.Error())
		a.emitError(options.SessionID, err.Error())
		return "", err
	}

	config := &ssh.ClientConfig{
		User:            options.Username,
		Auth:            authMethods,
		HostKeyCallback: a.hostKeyCallback(options.SessionID, options.Host, options.Port),
		Timeout:         20 * time.Second,
	}

	address := net.JoinHostPort(options.Host, strconv.Itoa(options.Port))
	client, err := ssh.Dial("tcp", address, config)
	if err != nil {
		err = fmt.Errorf("SSH connection failed: %w", err)
		a.emitStatus(options.SessionID, statusError, err.Error())
		a.emitError(options.SessionID, err.Error())
		return "", err
	}

	session, err := client.NewSession()
	if err != nil {
		_ = client.Close()
		err = fmt.Errorf("could not create SSH session: %w", err)
		a.emitStatus(options.SessionID, statusError, err.Error())
		a.emitError(options.SessionID, err.Error())
		return "", err
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		_ = session.Close()
		_ = client.Close()
		err = fmt.Errorf("could not open SSH input stream: %w", err)
		a.emitStatus(options.SessionID, statusError, err.Error())
		a.emitError(options.SessionID, err.Error())
		return "", err
	}

	stdout, err := session.StdoutPipe()
	if err != nil {
		_ = session.Close()
		_ = client.Close()
		err = fmt.Errorf("could not open SSH output stream: %w", err)
		a.emitStatus(options.SessionID, statusError, err.Error())
		a.emitError(options.SessionID, err.Error())
		return "", err
	}

	stderr, err := session.StderrPipe()
	if err != nil {
		_ = session.Close()
		_ = client.Close()
		err = fmt.Errorf("could not open SSH error stream: %w", err)
		a.emitStatus(options.SessionID, statusError, err.Error())
		a.emitError(options.SessionID, err.Error())
		return "", err
	}

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := session.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		_ = session.Close()
		_ = client.Close()
		err = fmt.Errorf("could not request remote PTY: %w", err)
		a.emitStatus(options.SessionID, statusError, err.Error())
		a.emitError(options.SessionID, err.Error())
		return "", err
	}

	active := &sshSession{
		id:      options.SessionID,
		client:  client,
		session: session,
		stdin:   stdin,
		cols:    cols,
		rows:    rows,
	}

	a.mu.Lock()
	a.sessions[options.SessionID] = active
	a.mu.Unlock()

	if err := session.Shell(); err != nil {
		a.removeSession(options.SessionID, active)
		_ = session.Close()
		_ = client.Close()
		err = fmt.Errorf("could not start remote shell: %w", err)
		a.emitStatus(options.SessionID, statusError, err.Error())
		a.emitError(options.SessionID, err.Error())
		return "", err
	}

	go a.pipeOutput(options.SessionID, stdout)
	go a.pipeOutput(options.SessionID, stderr)
	go a.waitForSession(options.SessionID, active)

	a.emitStatus(options.SessionID, statusConnected, fmt.Sprintf("Connected to %s:%d", options.Host, options.Port))
	return options.SessionID, nil
}

func (a *App) Disconnect(sessionID string) error {
	sessionID = strings.TrimSpace(sessionID)
	active := a.popSession(sessionID)
	if active == nil {
		a.emitStatus(sessionID, statusDisconnected, "Disconnected")
		return nil
	}

	closeSSHSession(active)
	a.emitStatus(sessionID, statusDisconnected, "Disconnected")
	return nil
}

func (a *App) DisconnectAll() error {
	a.mu.Lock()
	sessions := make([]*sshSession, 0, len(a.sessions))
	for id, active := range a.sessions {
		sessions = append(sessions, active)
		delete(a.sessions, id)
	}
	a.mu.Unlock()

	for _, active := range sessions {
		closeSSHSession(active)
		a.emitStatus(active.id, statusDisconnected, "Disconnected")
	}
	return nil
}

func (a *App) SendInput(sessionID string, data string) error {
	active := a.getSession(sessionID)
	if active == nil || active.stdin == nil {
		return errors.New("当前没有可用的 SSH 连接")
	}

	_, err := io.WriteString(active.stdin, data)
	return err
}

func (a *App) Resize(sessionID string, cols int, rows int) error {
	if cols < 1 || rows < 1 {
		return nil
	}

	a.mu.Lock()
	a.cols = cols
	a.rows = rows
	active := a.sessions[strings.TrimSpace(sessionID)]
	if active != nil {
		active.cols = cols
		active.rows = rows
	}
	a.mu.Unlock()

	if active == nil || active.session == nil {
		return nil
	}

	return active.session.WindowChange(rows, cols)
}

func (a *App) LoadSettings() TerminalSettings {
	return a.settings.Load()
}

func (a *App) SaveSettings(settings TerminalSettings) error {
	return a.settings.Save(settings)
}

func (a *App) SelectPrivateKey() (string, error) {
	if a.ctx == nil {
		return "", errors.New("application is not ready")
	}

	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择 SSH 私钥文件",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "SSH 私钥文件",
				Pattern:     "*.pem;id_*;*.key;*",
			},
		},
	})
}

func (a *App) ConfirmHostKey(id string, accept bool) error {
	a.pendingMu.Lock()
	ch, ok := a.pendingHostKeys[id]
	if ok {
		delete(a.pendingHostKeys, id)
	}
	a.pendingMu.Unlock()

	if !ok {
		return fmt.Errorf("host key confirmation expired")
	}

	ch <- accept
	return nil
}

func (a *App) pipeOutput(sessionID string, reader io.Reader) {
	buffer := make([]byte, 8192)
	for {
		n, err := reader.Read(buffer)
		if n > 0 && a.ctx != nil {
			runtime.EventsEmit(a.ctx, "ssh:output", TerminalOutput{
				SessionID: sessionID,
				Data:      string(buffer[:n]),
			})
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				a.emitError(sessionID, err.Error())
			}
			return
		}
	}
}

func (a *App) waitForSession(sessionID string, active *sshSession) {
	err := active.session.Wait()
	if a.removeSession(sessionID, active) {
		if err != nil && !strings.Contains(strings.ToLower(err.Error()), "eof") {
			a.emitStatus(sessionID, statusError, err.Error())
			a.emitError(sessionID, err.Error())
			return
		}
		a.emitStatus(sessionID, statusDisconnected, "Remote shell exited")
	}
}

func (a *App) hostKeyCallback(sessionID string, host string, port int) ssh.HostKeyCallback {
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		record, found, changed, err := a.hostKeys.Check(host, port, key)
		if err != nil {
			return err
		}
		if found && !changed {
			return nil
		}
		if changed {
			return fmt.Errorf("host key changed for %s:%d; expected %s but received %s", host, port, record.Fingerprint, ssh.FingerprintSHA256(key))
		}

		accepted := a.requestHostKeyDecision(sessionID, host, port, remote.String(), key)
		if !accepted {
			return fmt.Errorf("host key was not trusted for %s:%d", host, port)
		}

		return a.hostKeys.Add(host, port, key)
	}
}

func (a *App) requestHostKeyDecision(sessionID string, host string, port int, remote string, key ssh.PublicKey) bool {
	if a.ctx == nil {
		return false
	}

	id := fmt.Sprintf("%s:%d:%d", host, port, time.Now().UnixNano())
	ch := make(chan bool, 1)

	a.pendingMu.Lock()
	a.pendingHostKeys[id] = ch
	a.pendingMu.Unlock()

	runtime.EventsEmit(a.ctx, "ssh:hostkey-confirm", HostKeyPrompt{
		ID:          id,
		SessionID:   sessionID,
		Host:        host,
		Port:        port,
		Remote:      remote,
		Algorithm:   key.Type(),
		Fingerprint: ssh.FingerprintSHA256(key),
	})

	select {
	case accepted := <-ch:
		return accepted
	case <-time.After(90 * time.Second):
		a.pendingMu.Lock()
		delete(a.pendingHostKeys, id)
		a.pendingMu.Unlock()
		return false
	}
}

func (a *App) getSession(sessionID string) *sshSession {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.sessions[strings.TrimSpace(sessionID)]
}

func (a *App) popSession(sessionID string) *sshSession {
	a.mu.Lock()
	defer a.mu.Unlock()
	active := a.sessions[strings.TrimSpace(sessionID)]
	delete(a.sessions, strings.TrimSpace(sessionID))
	return active
}

func (a *App) removeSession(sessionID string, active *sshSession) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.sessions[sessionID] != active {
		return false
	}
	delete(a.sessions, sessionID)
	return true
}

func closeSSHSession(active *sshSession) {
	if active == nil {
		return
	}
	if active.session != nil {
		_ = active.session.Close()
	}
	if active.client != nil {
		_ = active.client.Close()
	}
}

func (a *App) emitStatus(sessionID string, state string, message string) {
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "ssh:status", ConnectionStatus{
			SessionID: sessionID,
			State:     state,
			Message:   message,
		})
	}
}

func (a *App) emitError(sessionID string, message string) {
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "ssh:error", TerminalOutput{
			SessionID: sessionID,
			Data:      message,
		})
	}
}

func validateConnectionOptions(options ConnectionOptions) error {
	if options.Host == "" {
		return errors.New("请输入主机地址")
	}
	if options.Port < 1 || options.Port > 65535 {
		return errors.New("端口必须在 1 到 65535 之间")
	}
	if options.Username == "" {
		return errors.New("请输入用户名")
	}
	switch options.AuthMethod {
	case "password":
		if options.Password == "" {
			return errors.New("请输入密码")
		}
	case "key":
		if options.PrivateKeyPath == "" {
			return errors.New("请选择私钥文件")
		}
	default:
		return errors.New("认证方式必须是密码或私钥")
	}
	return nil
}

func buildAuthMethods(options ConnectionOptions) ([]ssh.AuthMethod, error) {
	switch options.AuthMethod {
	case "password":
		return []ssh.AuthMethod{ssh.Password(options.Password)}, nil
	case "key":
		keyPath, err := expandPath(options.PrivateKeyPath)
		if err != nil {
			return nil, err
		}

		keyBytes, err := os.ReadFile(keyPath)
		if err != nil {
			return nil, fmt.Errorf("could not read private key: %w", err)
		}

		var signer ssh.Signer
		if options.PrivateKeyPassphrase == "" {
			signer, err = ssh.ParsePrivateKey(keyBytes)
		} else {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(keyBytes, []byte(options.PrivateKeyPassphrase))
		}
		if err != nil {
			return nil, fmt.Errorf("could not parse private key: %w", err)
		}

		return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil
	default:
		return nil, errors.New("unsupported auth method")
	}
}

func expandPath(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", errors.New("path is empty")
	}

	if path == "~" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return home, nil
	}

	if strings.HasPrefix(path, "~"+string(os.PathSeparator)) || strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, strings.TrimPrefix(strings.TrimPrefix(path, "~/"), "~"+string(os.PathSeparator))), nil
	}

	return path, nil
}
