# DadoFit — Stable Recovery 0.2

Esta versión reorganiza el frontend para que React/Vite viva directamente en la raíz del repositorio. Ya no existe un workspace `dice-app/`.

## Estructura esperada

```text
reto-byads/
├── data/                 # CONSERVAR: dataset original
├── images/               # CONSERVAR: JPG originales
├── videos/               # CONSERVAR: GIF originales
├── public/
│   └── data/
│       └── exercises.min.json
├── scripts/
├── src/
├── index.html            # entrada Vite
├── package.json
├── vite.config.ts
├── tsconfig*.json
├── LICENSE               # CONSERVAR
└── NOTICE.md             # CONSERVAR
```

## Instalación

```bash
npm install
npm run dev
```

Abrir `http://localhost:5175/login`.

Acceso local de recuperación:

```text
admin@dadofit.local
admin123
```

También puedes usar **Continuar como invitado** o crear una cuenta local.

> Importante: esta autenticación es local y temporal. Sirve para recuperar un flujo funcional y no reemplaza una autenticación de producción con backend.

## Validaciones

```bash
npm test
npm run build
```

El build genera `dist/` y copia `images/` y `videos/` dentro del artefacto final.

## Dataset

`scripts/prepare-dataset.mjs` lee `data/exercises.json` y genera `public/data/exercises.min.json` con solo los campos usados por la app.

## Media

Durante desarrollo Vite sirve `/images/*` y `/videos/*` directamente desde las carpetas originales de la raíz. Durante build `scripts/copy-media.mjs` las copia a `dist/`.

## Migración desde la versión con `dice-app/`

Conserva `data/`, `images/`, `videos/`, `.git/`, `LICENSE`, `NOTICE.md` y cualquier backend/base de datos que tengas. El frontend viejo `dice-app/` puede eliminarse **solo después de comprobar que esta versión arranca y que tienes un backup/commit**.
