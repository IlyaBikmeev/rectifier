package app

import (
	"fmt"
	"net/http"
)

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

	fmt.Fprintf(w, `
		<!doctype html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">

    <title>Rectifier</title>

    <link
        href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"
        rel="stylesheet"
    >
</head>

<body class="bg-light">

<div class="container py-4">

    <!-- Header -->
    <div class="d-flex justify-content-between align-items-center mb-4">
        <div>
            <h1 class="mb-1">Rectifier</h1>
            <div class="text-secondary">
                Мониторинг ректификационной колонны
            </div>
        </div>

        <div class="text-end">
            <div class="text-secondary small mb-1">
                Состояние процесса
            </div>

            <span class="badge text-bg-secondary fs-6">
                ОСТАНОВЛЕН
            </span>
        </div>
    </div>


    <!-- Process -->
    <div class="card shadow-sm mb-4">
        <div class="card-body">
            <div class="row align-items-center g-3">

                <div class="col">
                    <div class="text-secondary small">
                        Текущий процесс
                    </div>

                    <div class="fs-5 fw-semibold">
                        Остановлен
                    </div>

                    <!--
                    Когда процесс будет запущен:

                    <div class="fs-5 fw-semibold">
                        Запущен · 01:42:17
                    </div>
                    -->
                </div>

                <div class="col-auto">
                    <div class="d-flex gap-2">

                        <button
                            type="button"
                            class="btn btn-success"
                        >
                            Старт
                        </button>

                        <button
                            type="button"
                            class="btn btn-danger"
                        >
                            Стоп
                        </button>

                    </div>
                </div>

            </div>
        </div>
    </div>


    <!-- Sensors header -->
    <div class="d-flex justify-content-between align-items-center mb-3">
        <h2 class="h4 mb-0">
            Датчики
        </h2>

        <span class="text-secondary">
            3 подключено
        </span>
    </div>


    <!-- Sensors -->
    <div class="row g-3">

        <!-- Sensor: Cube -->
        <div class="col-12 col-md-6 col-lg-4">
            <div class="card h-100 shadow-sm">
                <div class="card-body">

                    <div class="d-flex justify-content-between align-items-start">

                        <div>
                            <h5 class="card-title mb-1">
                                Куб
                            </h5>

                            <div class="text-secondary small">
                                28-00000abc1234
                            </div>
                        </div>

                        <span class="badge text-bg-success">
                            ONLINE
                        </span>

                    </div>

                    <div class="mt-4">
                        <span class="display-5 fw-semibold">
                            92.4
                        </span>

                        <span class="fs-4 text-secondary">
                            °C
                        </span>
                    </div>

                </div>
            </div>
        </div>


        <!-- Sensor: Column top -->
        <div class="col-12 col-md-6 col-lg-4">
            <div class="card h-100 shadow-sm">
                <div class="card-body">

                    <div class="d-flex justify-content-between align-items-start">

                        <div>
                            <h5 class="card-title mb-1">
                                Царга верх
                            </h5>

                            <div class="text-secondary small">
                                28-00000def5678
                            </div>
                        </div>

                        <span class="badge text-bg-success">
                            ONLINE
                        </span>

                    </div>

                    <div class="mt-4">
                        <span class="display-5 fw-semibold">
                            78.3
                        </span>

                        <span class="fs-4 text-secondary">
                            °C
                        </span>
                    </div>

                </div>
            </div>
        </div>


        <!-- Sensor: Cooling water -->
        <div class="col-12 col-md-6 col-lg-4">
            <div class="card h-100 shadow-sm">
                <div class="card-body">

                    <div class="d-flex justify-content-between align-items-start">

                        <div>
                            <h5 class="card-title mb-1">
                                Вода выход
                            </h5>

                            <div class="text-secondary small">
                                28-00000aaa9999
                            </div>
                        </div>

                        <span class="badge text-bg-success">
                            ONLINE
                        </span>

                    </div>

                    <div class="mt-4">
                        <span class="display-5 fw-semibold">
                            27.1
                        </span>

                        <span class="fs-4 text-secondary">
                            °C
                        </span>
                    </div>

                </div>
            </div>
        </div>

    </div>

</div>


<script
    src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js">
</script>

</body>
</html>
	
	`)
}