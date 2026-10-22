# Actualización de seguridad de runtimes — octubre de 2026

## Alcance revisado

- El proyecto no contiene código, dependencias, contenedores ni procesos PHP. Las versiones
  corregidas de PHP 8.2–8.5 no aplican a este repositorio.
- Node.js se usa para desarrollo, pruebas y para compilar la SPA en la primera etapa del
  `Dockerfile`.
- La imagen final de producción usa Nginx y solo contiene los archivos estáticos de `dist/`;
  Node.js no queda expuesto como proceso del servidor.

## Riesgo y mitigación

La rama Node.js 22.x anterior a 22.23.4 está afectada por vulnerabilidades publicadas el
21 de octubre de 2026, incluidas fallas de severidad alta en DNS, validación TLS y el
decodificador Brotli. Aunque el runtime no permanece en producción, una versión vulnerable
puede afectar instalaciones, scripts, pruebas y compilaciones que procesen entradas o
conexiones no confiables.

Se fija Node.js 22.23.4 en:

- `Dockerfile`, mediante `node:22.23.4-alpine`;
- `.nvmrc`, para desarrollo local;
- `package.json#engines`, para rechazar versiones anteriores de la rama 22.x;
- documentación de requisitos y Docker.

También se actualizaron Vite, Vitest y React Router a versiones corregidas después de que
`npm audit` detectara vulnerabilidades independientes del runtime de Node.js. El lockfile
mantiene versiones reproducibles.

## Verificación

```bash
node --version
npm ci
npm audit
npm test
npm run build
```

Versión esperada de Node.js: `v22.23.4`. El audit debe reportar cero vulnerabilidades.

## Fuentes

- Aviso oficial: <https://nodejs.org/en/blog/vulnerability/october-2026-security-releases>
- Release corregido: <https://nodejs.org/en/blog/release/v22.23.4>
