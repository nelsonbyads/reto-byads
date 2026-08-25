# DadoFit

DadoFit es una aplicación de entrenamiento basada en dados que combina un dataset de **1.324 ejercicios**, filtros múltiples, niveles de intensidad, seguimiento de sesión y evidencias locales en foto/video.

La aplicación está construida con **React + TypeScript + Vite** y cuenta con un ambiente de desarrollo local y un ambiente Docker de producción local servido por **Nginx**.

## Estado actual

Versión visual actual: **V7**.

Funcionalidades principales:

- Login, registro y acceso como invitado.
- Selector visual de tema: **Pastel / Light / Dark**.
- Preferencia de tema persistente en el navegador.
- 1.324 ejercicios provenientes del dataset original.
- Filtros múltiples por equipo, zona corporal y objetivo.
- Cuatro niveles de entrenamiento:
  - Amateur — D20 — 9 a 20 repeticiones.
  - Principiante — D30 — 11 a 30 repeticiones.
  - Intermedio — D50 — 16 a 50 repeticiones.
  - Avanzado — D100 — 21 a 100 repeticiones.
- Tirada conjunta de repeticiones + ejercicio.
- Tirada independiente de repeticiones.
- Cambio independiente de ejercicio.
- Historial reciente de tiradas.
- Resumen de sesión.
- Imagen/GIF del ejercicio con fallback.
- Instrucciones del ejercicio.
- Evidencia en foto o video asociada a la tirada actual.
- Preview y eliminación de evidencias.
- Evidencias persistidas localmente mediante IndexedDB.
- Build de producción con Vite.
- Imagen Docker multi-stage Node + Nginx.

---

# 1. Requisitos

Antes de iniciar debes tener instalado:

- Node.js 20 o superior.
- npm.
- Git.
- Docker Desktop, únicamente para el ambiente Docker.

Comprobar Node y npm:

```bash
node -v
npm -v
```

Comprobar Docker:

```bash
docker --version
docker compose version
```

---

# 2. Estructura del proyecto

La aplicación React/Vite vive directamente en la raíz del repositorio.

```text
reto-byads/
├── .git/
├── data/                     # Dataset original
├── docker/
│   └── nginx.conf            # Configuración Nginx
├── images/                   # Imágenes originales de ejercicios
├── public/
│   └── data/
│       └── exercises.min.json
├── scripts/
│   ├── prepare-dataset.mjs
│   └── copy-media.mjs
├── src/
│   ├── auth/
│   ├── components/
│   ├── hooks/
│   ├── lib/
│   ├── pages/
│   ├── styles/
│   ├── types/
│   ├── App.tsx
│   └── main.tsx
├── videos/                   # GIF/videos originales de ejercicios
├── .dockerignore
├── .gitignore
├── docker-compose.yml
├── Dockerfile
├── index.html
├── LICENSE
├── NOTICE.md
├── package.json
├── package-lock.json
├── README.md
├── tsconfig.app.json
├── tsconfig.json
├── tsconfig.node.json
└── vite.config.ts
```

> No debe existir nuevamente una carpeta `dice-app/`. El frontend oficial vive en la raíz.

---

# 3. Instalación inicial

Después de clonar el repositorio:

```bash
git clone https://github.com/nelsonbyads/reto-byads.git
cd reto-byads
npm install
```

`npm install` solamente es necesario la primera vez o cuando cambien las dependencias de `package.json` / `package-lock.json`.

---

# 4. Ambiente de desarrollo — Vite

Este es el ambiente principal para desarrollar y revisar cambios rápidamente.

## Levantar desarrollo

Desde la raíz:

```bash
npm run dev
```

La aplicación queda disponible en:

```text
http://localhost:5175
```

Login:

```text
http://localhost:5175/login
```

Aplicación:

```text
http://localhost:5175/app
```

### Usuario local de prueba

```text
Correo: admin@dadofit.local
Contraseña: admin123
```

También puedes:

- crear una cuenta local;
- continuar como invitado.

> La autenticación actual es local. No corresponde todavía a una autenticación backend de producción.

## Cerrar Vite

En la terminal donde está ejecutándose:

```text
Ctrl + C
```

Después de detenerlo, `localhost:5175` debe dejar de responder.

---

# 5. Ambiente Docker — producción local

Docker representa el build de producción local de DadoFit.

La aplicación se compila con Node y después se sirve mediante Nginx.

Puerto:

```text
http://localhost:8781
```

## Levantar Docker normalmente

Si la imagen ya existe y no hubo cambios de código:

```bash
docker compose up -d
```

Comprobar el estado:

```bash
docker compose ps
```

Debe aparecer el servicio:

```text
dadofit-web
```

con estado similar a:

```text
Up
```

o:

```text
Up (healthy)
```

## Levantar Docker después de cambios de código

Cuando cambie `src/`, estilos, configuración o cualquier archivo involucrado en el build:

```bash
docker compose up -d --build
```

## Reconstrucción completamente limpia

Utilizar solamente cuando sospechamos que Docker está sirviendo un build viejo o existe un problema de caché:

```bash
docker compose down --remove-orphans
docker compose build --no-cache
docker compose up -d
docker compose ps
```

Después abrir:

```text
http://localhost:8781
```

## Ver logs de Docker

```bash
docker compose logs --tail=100 dadofit-web
```

Logs en tiempo real:

```bash
docker compose logs -f dadofit-web
```

Salir de los logs sin apagar Docker:

```text
Ctrl + C
```

## Cerrar Docker

Para detener y eliminar el contenedor creado por Compose:

```bash
docker compose down
```

Si únicamente quieres detenerlo temporalmente sin eliminarlo:

```bash
docker compose stop
```

Para volver a iniciar un contenedor detenido:

```bash
docker compose start
```

---

# 6. Diferencia entre los ambientes

| Ambiente | URL                     | Uso                                           |
| -------- | ----------------------- | --------------------------------------------- |
| Vite     | `http://localhost:5175` | Desarrollo diario y revisión rápida           |
| Docker   | `http://localhost:8781` | Validación del build final / producción local |

Regla de trabajo recomendada:

```text
Desarrollar y aprobar primero en 5175.
                ↓
Ejecutar tests y build.
                ↓
Cuando la versión esté aprobada, reconstruir 8781.
                ↓
Confirmar que ambos ambientes se comportan igual.
```

No es necesario reconstruir Docker con cada pequeño cambio visual mientras todavía se está iterando en Vite.

---

# 7. Tests obligatorios

Antes de considerar estable cualquier entrega:

```bash
npm test
```

Actualmente los tests cubren principalmente:

- filtros;
- selección aleatoria;
- rangos de los dados.

Resultado esperado actual:

```text
Test Files  2 passed
Tests       14 passed
```

Si algún test falla, no se debe subir la versión como estable hasta corregirlo.

---

# 8. Build obligatorio

Antes de pasar una versión a Docker o realizar un commit estable:

```bash
npm run build
```

Este proceso realiza:

```text
prepare dataset
      ↓
TypeScript build
      ↓
Vite production build
      ↓
copia de imágenes
      ↓
copia de videos
```

El dataset se prepara mediante:

```text
scripts/prepare-dataset.mjs
```

y genera:

```text
public/data/exercises.min.json
```

El build de producción se genera en:

```text
dist/
```

Las carpetas `images/` y `videos/` también son copiadas dentro de `dist/` mediante:

```text
scripts/copy-media.mjs
```

---

# 9. Checklist antes de aprobar una versión

Cada cambio importante debe pasar estos checks.

## Check técnico

```bash
npm test
npm run build
```

Ambos deben terminar sin errores.

## Check Vite — 5175

Abrir:

```text
http://localhost:5175/app
```

Validar:

- [ ] Login abre correctamente.
- [ ] Registro abre correctamente.
- [ ] Acceso como invitado funciona.
- [ ] Logout funciona.
- [ ] `/app` carga sin pantalla en blanco.
- [ ] Se muestran los 1.324 ejercicios cuando no existen filtros.
- [ ] Filtros permiten selección múltiple.
- [ ] Filtros activos se pueden retirar.
- [ ] D20 devuelve resultados entre 9 y 20.
- [ ] D30 devuelve resultados entre 11 y 30.
- [ ] D50 devuelve resultados entre 16 y 50.
- [ ] D100 devuelve resultados entre 21 y 100.
- [ ] `LANZAR DADOS` cambia ejercicio y repeticiones.
- [ ] `Solo repeticiones` funciona.
- [ ] `Cambiar ejercicio` funciona.
- [ ] Imagen/GIF del ejercicio carga correctamente.
- [ ] Instrucciones se despliegan correctamente.
- [ ] Foto de evidencia se puede cargar.
- [ ] Video de evidencia se puede cargar.
- [ ] Preview de evidencia funciona.
- [ ] Evidencia se puede eliminar.
- [ ] Evidencia queda asociada al ejercicio/tirada correcta.
- [ ] Botón `HECHO` actualiza la sesión.
- [ ] Historial muestra las últimas tiradas.
- [ ] Tema Pastel funciona.
- [ ] Tema Light funciona.
- [ ] Tema Dark funciona.
- [ ] El tema seleccionado permanece después de refrescar.
- [ ] No existe overflow horizontal en móvil.

## Check Docker — 8781

Después de aprobar Vite:

```bash
docker compose up -d --build
docker compose ps
```

Abrir:

```text
http://localhost:8781/app
```

Validar:

- [ ] Docker está `Up` / `healthy`.
- [ ] Login funciona.
- [ ] `/app` funciona.
- [ ] Imágenes cargan.
- [ ] GIF/videos cargan.
- [ ] React Router permite refrescar `/app` sin 404.
- [ ] Pastel / Light / Dark funcionan.
- [ ] Evidencias pueden gestionarse.
- [ ] El diseño se ve igual al ambiente Vite.

---

# 10. Validación rápida completa

Cuando solo necesitamos comprobar rápidamente la aplicación:

```bash
npm test
npm run build
npm run dev
```

Revisar `5175`.

Cuando quede aprobado:

```bash
docker compose up -d --build
docker compose ps
```

Revisar `8781`.

---

# 11. Flujo recomendado de desarrollo

```text
1. Levantar Vite
   npm run dev

2. Desarrollar / revisar en localhost:5175

3. Ejecutar tests
   npm test

4. Ejecutar build
   npm run build

5. Corregir cualquier error

6. Aprobar visual y funcionalmente 5175

7. Construir Docker
   docker compose up -d --build

8. Validar localhost:8781

9. Verificar git status
   git status

10. Crear commit

11. Push a GitHub
```

---

# 12. Git antes de subir cambios

Ver estado:

```bash
git status
```

Revisar cambios:

```bash
git diff
```

Agregar cambios:

```bash
git add .
```

Crear commit:

```bash
git commit -m "feat: descripcion del cambio"
```

Subir:

```bash
git push origin main
```

Antes del commit estable se recomienda siempre:

```bash
npm test
npm run build
```

---

# 13. Solución de problemas frecuentes

## `localhost:5175` está en blanco

1. Abrir `F12`.
2. Revisar `Console`.
3. Detener Vite.
4. Limpiar caché Vite si es necesario:

```bash
rm -rf node_modules/.vite
npm run dev
```

## Puerto 5175 ocupado

En Windows / Git Bash:

```bash
netstat -ano | findstr :5175
```

Identificar el PID y detener únicamente el proceso correcto.

## Docker no aparece en `docker compose ps`

Ejecutar:

```bash
docker compose up -d --build
```

Si falla, revisar la salida del build.

También revisar contenedores detenidos:

```bash
docker ps -a
```

## Docker muestra una versión anterior

Primero reconstruir:

```bash
docker compose down --remove-orphans
docker compose build --no-cache
docker compose up -d
```

Después realizar hard refresh:

```text
Ctrl + F5
```

## Docker falla durante `npm ci`

El Dockerfile oficial utiliza:

```dockerfile
RUN npm ci --ignore-scripts
```

Esto evita ejecutar `prepare` antes de que Docker haya copiado `scripts/` y `data/` al contenedor.

Posteriormente:

```dockerfile
COPY . .
RUN npm run build
```

prepara correctamente el dataset y construye la aplicación.

---

# 14. Persistencia local

Actualmente existen datos que viven exclusivamente en el navegador.

Entre ellos pueden estar:

- sesión local;
- filtros;
- nivel de dado;
- tema Pastel / Light / Dark;
- autenticación local;
- evidencias mediante IndexedDB.

Esto significa que Vite y Docker pueden tener almacenamiento independiente porque utilizan orígenes distintos:

```text
localhost:5175
localhost:8781
```

Una evidencia creada en `5175` no necesariamente aparecerá en `8781`.

Esto es esperado en la arquitectura local actual.

---

# 15. Datos y media que no deben eliminarse

Estas carpetas forman parte esencial de DadoFit:

```text
data/
images/
videos/
```

También deben conservarse:

```text
LICENSE
NOTICE.md
```

No eliminar estos archivos durante una limpieza de frontend.

Sí pueden regenerarse cuando corresponda:

```text
dist/
public/data/exercises.min.json
node_modules/
```

`node_modules/` se recupera con:

```bash
npm install
```

---

# 16. Resumen de comandos

## Desarrollo

Levantar:

```bash
npm run dev
```

Cerrar:

```text
Ctrl + C
```

## Tests

```bash
npm test
```

## Build

```bash
npm run build
```

## Docker

Levantar:

```bash
docker compose up -d
```

Reconstruir después de cambios:

```bash
docker compose up -d --build
```

Estado:

```bash
docker compose ps
```

Logs:

```bash
docker compose logs -f dadofit-web
```

Cerrar:

```bash
docker compose down
```

Reconstrucción limpia:

```bash
docker compose down --remove-orphans
docker compose build --no-cache
docker compose up -d
docker compose ps
```

---

# 17. Regla de estabilidad del proyecto

Una versión de DadoFit solamente se considera lista cuando cumple las cuatro condiciones:

```text
npm test              ✅
npm run build         ✅
localhost:5175        ✅
localhost:8781        ✅
```

Si cualquiera falla, se corrige antes de marcar la versión como estable o subirla como entrega final.

---

## Licencia y atribución

DadoFit utiliza como base el dataset original de ejercicios incluido en este repositorio.

Los archivos:

```text
LICENSE
NOTICE.md
```

deben mantenerse para conservar la licencia y atribución correspondiente del contenido original.
