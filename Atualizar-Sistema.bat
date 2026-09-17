@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { cd 'C:\Users\abrao\OneDrive\Documentos\Disparo oficial meta'; npm run deploy; Read-Host 'Pressione ENTER para fechar...' }"
