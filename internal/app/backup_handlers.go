package app

import (
	"fmt"
	"log/slog"
	"net/http"
	"rectifier/internal/storage"
	"strconv"
	"time"
)

func handleBackup(w http.ResponseWriter, r *http.Request, backupService storage.BackupService) {
	data, err := backupService.Backup(r.Context())
	if err != nil {
		slog.Error("create SQLite backup", "error", err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}

	filename := fmt.Sprintf(
		"rectifier-backup-%s.db",
		time.Now().UTC().Format("2006-01-02T15-04-05Z"),
	)

	w.Header().Set("Content-Type", "application/vnd.sqlite3")
	w.Header().Set(
		"Content-Disposition",
		fmt.Sprintf(`attachment; filename="%s"`, filename),
	)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)

	if _, err := w.Write(data); err != nil {
		slog.Error("send SQLite backup", "error", err)
	}
}
