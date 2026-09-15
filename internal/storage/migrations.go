package storage

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"path"
	"strconv"
	"strings"
)

type migration struct {
	version int
	entry   fs.DirEntry
}

//go:embed migrations/*.sql
var migrationFiles embed.FS

// TODO сделать отдельную таблицу для миграций и запоминать примененные миграции
func Migrate(ctx context.Context, db *sql.DB) error {
	var currentVersion int

	if err := db.QueryRowContext(ctx, "PRAGMA user_version").
		Scan(&currentVersion); err != nil {
		return fmt.Errorf("read migration version: %w", err)
	}

	fmt.Printf("current database version: %d\n", currentVersion)

	entries, err := migrationFiles.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("read migrations directory: %w", err)
	}

	migrationsToRun := make([]migration, 0, len(entries))

	for _, entry := range entries {
		version, err := parseMigrationVersion(entry.Name())
		if err != nil {
			return fmt.Errorf("parse migration %q: %w", entry.Name(), err)
		}

		if version > currentVersion {
			migrationsToRun = append(migrationsToRun, migration{
				version: version,
				entry:   entry,
			})
		}
	}

	for _, m := range migrationsToRun {
		if err := applyMigration(ctx, db, m); err != nil {
			return fmt.Errorf("apply migration %q: %w", m.entry.Name(), err)
		}
	}

	return nil
}

func applyMigration(ctx context.Context, db *sql.DB, m migration) error {
	content, err := migrationFiles.ReadFile(path.Join("migrations", m.entry.Name()))

	if err != nil {
		return fmt.Errorf("read migration %q: %w", m.entry.Name(), err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin migration %d transaction: %w", m.version, err)
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, string(content))
	if err != nil {
		return fmt.Errorf("execute migration %d: %w", m.version, err)
	}

	_, err = tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", m.version))
	if err != nil {
		return fmt.Errorf("set migration version to %d: %w", m.version, err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migration %d: %w", m.version, err)
	}

	fmt.Printf("migration %q applied\n", m.entry.Name())
	return nil
}

func parseMigrationVersion(fileName string) (int, error) {
	prefix, _, found := strings.Cut(fileName, "_")
	if !found {
		return 0, fmt.Errorf("invalid migration filename %q", fileName)
	}

	version, err := strconv.Atoi(prefix)

	if err != nil {
		return 0, fmt.Errorf("parse migration version from %q: %w", fileName, err)
	}

	return version, nil
}
