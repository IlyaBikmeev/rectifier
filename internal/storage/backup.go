package storage

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
)

type BackupService interface {
	Backup(ctx context.Context) ([]byte, error)
}

type SQLiteBackupService struct {
	db *sql.DB
}

var _ BackupService = (*SQLiteBackupService)(nil)

func NewSQLiteBackupService(db *sql.DB) *SQLiteBackupService {
	return &SQLiteBackupService{db}
}

func (s *SQLiteBackupService) Backup(ctx context.Context) ([]byte, error) {
	tempDir, err := os.MkdirTemp("", "rectifier-backup-*")
	if err != nil {
		return nil, fmt.Errorf("create temporary backup directory: %w", err)
	}
	defer os.RemoveAll(tempDir)

	backupPath := filepath.Join(tempDir, "backup.db")

	if _, err := s.db.ExecContext(
		ctx,
		"VACUUM INTO ?",
		backupPath,
	); err != nil {
		return nil, fmt.Errorf("create SQLite backup: %w", err)
	}

	data, err := os.ReadFile(backupPath)
	if err != nil {
		return nil, fmt.Errorf("read SQLite backup: %w", err)
	}

	return data, nil
}
