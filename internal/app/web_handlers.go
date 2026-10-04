package app

import (
	"embed"
	"html/template"
	"log/slog"
	"net/http"
	"strings"
)

//go:embed templates/index.html
var indexHTML string

//go:embed templates/icon.png
var iconPNG []byte

var indexTemplate = template.Must(
	template.New("index").Parse(indexHTML),
)

//go:embed static
var staticFiles embed.FS
var staticHandler = http.FileServerFS(staticFiles)

type indexView struct {
	Version string
}

func handleIndex(w http.ResponseWriter, r *http.Request, version string) {
	data := indexView{Version: version}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	if err := indexTemplate.Execute(w, data); err != nil {
		slog.Error("rendering index", "error", err)
	}
}

func handleStatic(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/static/js/") ||
		strings.HasPrefix(r.URL.Path, "/static/css/") {
		w.Header().Set("Cache-Control", "no-cache")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=86400")
	}
	staticHandler.ServeHTTP(w, r)
}

func handleIcon(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	if _, err := w.Write(iconPNG); err != nil {
		slog.Error("serving icon", "error", err)
	}
}
