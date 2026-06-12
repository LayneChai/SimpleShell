package main

import "testing"

func TestValidateConnectionOptions(t *testing.T) {
	valid := ConnectionOptions{
		Host:       "example.com",
		Port:       22,
		Username:   "root",
		AuthMethod: "password",
		Password:   "secret",
	}

	if err := validateConnectionOptions(valid); err != nil {
		t.Fatalf("expected valid password options: %v", err)
	}

	valid.AuthMethod = "key"
	valid.Password = ""
	valid.PrivateKeyPath = "C:\\Users\\Administrator\\.ssh\\id_ed25519"
	if err := validateConnectionOptions(valid); err != nil {
		t.Fatalf("expected valid key options: %v", err)
	}

	valid.Port = 70000
	if err := validateConnectionOptions(valid); err == nil {
		t.Fatal("expected invalid port to fail")
	}
}
