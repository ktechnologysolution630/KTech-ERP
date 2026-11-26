@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist boq_config.json (
  python boq_from_archicad.py -c boq_config.json -o BOQ_Archicad.csv
) else (
  python boq_from_archicad.py -o BOQ_Archicad.csv
)
pause
