# PlacePrep AI — start all three services
# Run this from anywhere: powershell -ExecutionPolicy Bypass -File start.ps1

$root = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Host "Starting PlacePrep AI..." -ForegroundColor Cyan

# Kill anything already on these ports
foreach ($port in @(5173, 4000, 8000)) {
    $pids = (netstat -ano | Select-String ":$port\s" | ForEach-Object { ($_ -split '\s+')[-1] } | Sort-Object -Unique)
    foreach ($p in $pids) {
        if ($p -match '^\d+$' -and $p -ne '0') {
            try { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } catch {}
        }
    }
}

Start-Sleep -Seconds 1

# Terminal 1: AI service
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\ai-service'; .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000"

Start-Sleep -Seconds 2

# Terminal 2: Backend API
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; .\node_modules\.bin\tsx.cmd watch .\backend\src\server.ts"

Start-Sleep -Seconds 2

# Terminal 3: Frontend — MUST run from frontend\ subfolder
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\frontend'; ..\node_modules\.bin\vite.cmd --host 0.0.0.0 --port 5173"

Write-Host ""
Write-Host "Three terminals opened. Wait for each to show its ready message." -ForegroundColor Green
Write-Host "Frontend:  http://localhost:5173" -ForegroundColor Yellow
Write-Host "Backend:   http://localhost:4000/api/v1/health" -ForegroundColor Yellow
Write-Host "AI:        http://localhost:8000/health" -ForegroundColor Yellow
