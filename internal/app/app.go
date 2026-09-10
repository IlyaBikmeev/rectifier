package app

import (
	_ "embed"
	"fmt"
	"net/http"
)

//go:embed templates/index.html
var indexHTML string

func Run() {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /", handleIndex)

	addr := ":8080"

	fmt.Printf("Server started on %s\n", addr)

	err := http.ListenAndServe(addr, mux)

	if err != nil {
		fmt.Printf("Error starting server: %v\n", err)
	}
}

func handleIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	fmt.Fprintf(w, indexHTML)
}