@echo off
echo ============================================
echo    Orbit Python Vision Engine
echo    Puerto: 18790
echo ============================================
echo.
echo Verificando dependencias...
pip install -r "%~dp0requirements.txt" --quiet

echo.
echo Iniciando motor de vision...
python "%~dp0orbit_engine.py"
pause
