DADOFIT V7 — LAYOUT + 3 TEMAS
==============================

ESTA ENTREGA INCLUYE:
- Nuevo layout visual basado en la propuesta aprobada.
- Tema Pastel.
- Tema Light.
- Tema Dark.
- Selector de tema dentro del header.
- El tema seleccionado se guarda en localStorage.
- Resultado reorganizado en 3 zonas: ejercicio/media, datos, evidencia.
- Evidencia vinculada visualmente a la tirada actual.
- Historial reciente convertido en cards.
- Responsive desktop/tablet/mobile.

COPIAR Y REEMPLAZAR:
- src/main.tsx
- src/pages/WorkoutPage.tsx
- src/components/AppHeader.tsx
- src/components/DiceLevelSelector.tsx
- src/components/EvidencePanel.tsx
- src/components/ExerciseResult.tsx
- src/components/RollHistory.tsx

COPIAR COMO ARCHIVO NUEVO:
- src/styles/v7-themes.css

NO TOCAR:
- data/
- images/
- videos/
- public/
- scripts/
- package.json
- package-lock.json
- Dockerfile
- docker-compose.yml
- login / registro / AuthContext

NOTA:
- src/styles/byads-v3.css puede quedarse. V7 ya no lo importa.
- No se agregaron dependencias nuevas.

PRUEBA PRIMERO SOLO EN VITE:
1. npm test
2. npm run build
3. npm run dev
4. abrir http://localhost:5175/app

NO reconstruir Docker hasta aprobar visualmente V7.
