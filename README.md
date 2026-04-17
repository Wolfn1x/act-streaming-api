# Actividad: Act Streaming API (Publica y Consumible)

Proyecto de **Aplicaciones Web Orientadas a Servicios** con:

- API propia en Node.js + Express (`/api/v1/...`).
- Frontend web que consume esa API.
- Reglas de validacion de parametros y rate limiting.

## Objetivo

Crear una API publica de streaming con reglas claras, parametros controlados y endpoints listos para consumo desde cualquier cliente HTTP.

## Stack

- Backend: `Node.js`, `Express`, `CORS`
- Fuente de datos externa: `Radio Browser API`
- Frontend: HTML, CSS, JavaScript vanilla

## Endpoints Publicos

1. `GET /api/v1/health`
2. `GET /api/v1/rules`
3. `GET /api/v1/stations`

## Reglas y Parametros de `/api/v1/stations`

- `q`: texto de busqueda (opcional, 2-60 caracteres).
- `country`: codigo ISO de pais en 2 letras (opcional, ejemplo `MX`, `US`, `ES`).
- `order`: orden permitido (opcional): `votes`, `clickcount`, `bitrate`, `name`.
- `limit`: cantidad de resultados (opcional, entero entre `1` y `50`, default `24`).
- `top`: booleano (opcional): `true`/`false` o `1`/`0`.

Reglas globales:

- Rate limit: `60` solicitudes por minuto por IP.
- CORS habilitado para consumo publico.
- Respuestas en JSON:
  - Exito: `{ success: true, data, meta }`
  - Error: `{ success: false, error }`

## Ejemplos de Consumo

```bash
curl "http://localhost:3000/api/v1/health"
curl "http://localhost:3000/api/v1/rules"
curl "http://localhost:3000/api/v1/stations?top=true&order=votes&limit=10"
curl "http://localhost:3000/api/v1/stations?q=rock&country=US&order=bitrate&limit=12"
```

## Estructura

- `server.js`: API publica, reglas, validaciones y proxy a Radio Browser.
- `app.js`: frontend consumiendo `GET /api/v1/stations`.
- `index.html`: interfaz cliente.
- `styles.css`: estilos.

## Ejecutar Localmente

1. Instalar dependencias:

```bash
npm install
```

2. Levantar API + frontend:

```bash
npm run dev
```

3. Abrir en navegador:

- `http://localhost:3000`

## Publicar la API

Para que quede realmente publica en internet, despliega esta carpeta en un servicio como Render, Railway o Fly.io.
Al quedar desplegada, los endpoints seran consumibles con la URL base publica:

- `https://tu-dominio.com/api/v1/stations?...`

### Deploy rapido en Render

Este proyecto ya incluye `render.yaml`, asi que Render puede detectar la configuracion automaticamente.

1. Sube este proyecto a GitHub.
2. En Render: **New +** -> **Blueprint**.
3. Conecta el repositorio y selecciona la rama.
4. Deploy.

Render usara:

- Build: `npm install`
- Start: `npm start`
- Health check: `/api/v1/health`

Al terminar, prueba:

```bash
curl "https://tu-app.onrender.com/api/v1/health"
curl "https://tu-app.onrender.com/api/v1/stations?top=true&limit=5"
```
