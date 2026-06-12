package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/ssh"
)

func TestSettingsStoreNormalizesAndPersists(t *testing.T) {
	store := &SettingsStore{path: filepath.Join(t.TempDir(), "settings.json")}

	if err := store.Save(TerminalSettings{
		BackgroundColorHex: "not-a-color",
		BackgroundOpacity:  4,
	}); err != nil {
		t.Fatalf("save settings: %v", err)
	}

	settings := store.Load()
	if settings.BackgroundColorHex != "#24343a" {
		t.Fatalf("expected default color, got %s", settings.BackgroundColorHex)
	}
	if settings.BackgroundOpacity != 0.92 {
		t.Fatalf("expected opacity clamp to 0.92, got %f", settings.BackgroundOpacity)
	}
}

func TestHostKeyStoreTrustAndChangeDetection(t *testing.T) {
	store := &HostKeyStore{path: filepath.Join(t.TempDir(), "known_hosts.json")}
	firstKey := testPublicKey(t)
	secondKey := testPublicKey(t)

	if _, found, changed, err := store.Check("server.local", 22, firstKey); err != nil || found || changed {
		t.Fatalf("unexpected initial check result found=%v changed=%v err=%v", found, changed, err)
	}

	if err := store.Add("server.local", 22, firstKey); err != nil {
		t.Fatalf("add host key: %v", err)
	}

	if _, found, changed, err := store.Check("SERVER.local", 22, firstKey); err != nil || !found || changed {
		t.Fatalf("expected trusted key found without change, found=%v changed=%v err=%v", found, changed, err)
	}

	if _, found, changed, err := store.Check("server.local", 22, secondKey); err != nil || !found || !changed {
		t.Fatalf("expected changed key detection, found=%v changed=%v err=%v", found, changed, err)
	}
}

func testPublicKey(t *testing.T) ssh.PublicKey {
	t.Helper()

	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	signer, err := ssh.NewSignerFromSigner(privateKey)
	if err != nil {
		t.Fatalf("create signer: %v", err)
	}

	return signer.PublicKey()
}
