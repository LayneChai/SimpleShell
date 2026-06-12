package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"golang.org/x/crypto/ssh"
)

const appConfigDirName = "SimpleShell"

type HostKeyRecord struct {
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Algorithm   string `json:"algorithm"`
	Fingerprint string `json:"fingerprint"`
}

type SettingsStore struct {
	path string
	mu   sync.Mutex
}

type HostKeyStore struct {
	path string
	mu   sync.Mutex
}

func NewSettingsStore() *SettingsStore {
	return &SettingsStore{path: filepath.Join(configDir(), "settings.json")}
}

func NewHostKeyStore() *HostKeyStore {
	return &HostKeyStore{path: filepath.Join(configDir(), "known_hosts.json")}
}

func (s *SettingsStore) Load() TerminalSettings {
	s.mu.Lock()
	defer s.mu.Unlock()

	settings := defaultTerminalSettings()
	data, err := os.ReadFile(s.path)
	if err != nil {
		return settings
	}

	if err := json.Unmarshal(data, &settings); err != nil {
		return defaultTerminalSettings()
	}

	return normalizeTerminalSettings(settings)
}

func (s *SettingsStore) Save(settings TerminalSettings) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	settings = normalizeTerminalSettings(settings)
	if err := os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return err
	}

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(s.path, data, 0600)
}

func (s *HostKeyStore) Check(host string, port int, key ssh.PublicKey) (HostKeyRecord, bool, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	records, err := s.loadLocked()
	if err != nil {
		return HostKeyRecord{}, false, false, err
	}

	host = strings.ToLower(strings.TrimSpace(host))
	fingerprint := ssh.FingerprintSHA256(key)

	for _, record := range records {
		if strings.ToLower(record.Host) == host && record.Port == port {
			return record, true, record.Fingerprint != fingerprint || record.Algorithm != key.Type(), nil
		}
	}

	return HostKeyRecord{}, false, false, nil
}

func (s *HostKeyStore) Add(host string, port int, key ssh.PublicKey) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	records, err := s.loadLocked()
	if err != nil {
		return err
	}

	host = strings.ToLower(strings.TrimSpace(host))
	next := HostKeyRecord{
		Host:        host,
		Port:        port,
		Algorithm:   key.Type(),
		Fingerprint: ssh.FingerprintSHA256(key),
	}

	replaced := false
	for index, record := range records {
		if strings.ToLower(record.Host) == host && record.Port == port {
			records[index] = next
			replaced = true
			break
		}
	}
	if !replaced {
		records = append(records, next)
	}

	return s.saveLocked(records)
}

func (s *HostKeyStore) loadLocked() ([]HostKeyRecord, error) {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return []HostKeyRecord{}, nil
	}
	if err != nil {
		return nil, err
	}

	var records []HostKeyRecord
	if err := json.Unmarshal(data, &records); err != nil {
		return nil, fmt.Errorf("could not read known hosts: %w", err)
	}

	return records, nil
}

func (s *HostKeyStore) saveLocked(records []HostKeyRecord) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return err
	}

	data, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(s.path, data, 0600)
}

func defaultTerminalSettings() TerminalSettings {
	return TerminalSettings{
		BackgroundColorHex: "#24343a",
		BackgroundOpacity:  0.78,
	}
}

func normalizeTerminalSettings(settings TerminalSettings) TerminalSettings {
	settings.BackgroundColorHex = strings.TrimSpace(settings.BackgroundColorHex)
	if !isHexColor(settings.BackgroundColorHex) {
		settings.BackgroundColorHex = defaultTerminalSettings().BackgroundColorHex
	}
	if settings.BackgroundOpacity < 0.1 {
		settings.BackgroundOpacity = 0.1
	}
	if settings.BackgroundOpacity > 0.92 {
		settings.BackgroundOpacity = 0.92
	}
	return settings
}

func isHexColor(value string) bool {
	if len(value) != 7 || value[0] != '#' {
		return false
	}
	for _, char := range value[1:] {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')) {
			return false
		}
	}
	return true
}

func configDir() string {
	dir, err := os.UserConfigDir()
	if err != nil || dir == "" {
		home, homeErr := os.UserHomeDir()
		if homeErr != nil || home == "" {
			return appConfigDirName
		}
		return filepath.Join(home, appConfigDirName)
	}
	return filepath.Join(dir, appConfigDirName)
}
