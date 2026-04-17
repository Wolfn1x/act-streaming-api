import express from "express";
import cors from "cors";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT) || 3000;

const UPSTREAM_SEARCH_URL = "https://all.api.radio-browser.info/json/stations/search";
const ALLOWED_ORDERS = ["votes", "clickcount", "bitrate", "name"];
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;
const MIN_LIMIT = 1;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const requestCounters = new Map();
const ACTION_LOG_MAX_ITEMS = 300;
const actionLog = [];
let actionSequence = 0;
const favorites = [];
let favoriteSequence = 0;

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

app.use(express.json());

app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    registerAction({
      id: ++actionSequence,
      at: new Date().toISOString(),
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: getClientIp(req),
    });
  });

  next();
});

app.use("/api/v1", publicRateLimit);

app.get("/api/v1/health", (req, res) => {
  res.json({
    success: true,
    service: "act-streaming-api",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/v1/rules", (req, res) => {
  res.json({
    success: true,
    service: "Act Streaming API",
    version: "v1",
    description:
      "API publica para consultar estaciones de streaming con reglas de validacion y parametros controlados.",
    endpoints: [
      {
        method: "GET",
        path: "/api/v1/health",
        description: "Estado de la API.",
      },
      {
        method: "GET",
        path: "/api/v1/rules",
        description: "Reglas y parametros soportados.",
      },
      {
        method: "GET",
        path: "/api/v1/stations",
        description: "Busca estaciones por parametros.",
      },
      {
        method: "GET",
        path: "/api/v1/report",
        description: "Reporte con package.json y acciones de uso recientes.",
      },
      {
        method: "GET",
        path: "/api/v1/favorites",
        description: "Lista estaciones guardadas localmente.",
      },
      {
        method: "POST",
        path: "/api/v1/favorites",
        description: "Crea estacion favorita.",
      },
      {
        method: "PUT",
        path: "/api/v1/favorites/:id",
        description: "Actualiza estacion favorita por id.",
      },
      {
        method: "DELETE",
        path: "/api/v1/favorites/:id",
        description: "Elimina estacion favorita por id.",
      },
    ],
    parameters: {
      q: {
        type: "string",
        required: false,
        minLength: 2,
        maxLength: 60,
        notes: "Texto de busqueda por nombre de estacion.",
      },
      country: {
        type: "string",
        required: false,
        pattern: "^[A-Z]{2}$",
        notes: "Codigo ISO de pais en 2 letras. Ej: MX, US, ES.",
      },
      order: {
        type: "string",
        required: false,
        default: "votes",
        allowed: ALLOWED_ORDERS,
      },
      limit: {
        type: "number",
        required: false,
        default: DEFAULT_LIMIT,
        min: MIN_LIMIT,
        max: MAX_LIMIT,
      },
      top: {
        type: "boolean",
        required: false,
        default: false,
        notes: "Si es true, prioriza ranking (top) y q pasa a ser opcional.",
      },
    },
    favoritesBody: {
      name: {
        type: "string",
        requiredOnPost: true,
        minLength: 2,
        maxLength: 80,
      },
      streamUrl: {
        type: "string",
        requiredOnPost: true,
        notes: "URL valida con protocolo http/https.",
      },
      country: {
        type: "string",
        requiredOnPost: false,
        maxLength: 60,
      },
      tags: {
        type: "array<string> | string",
        requiredOnPost: false,
        notes: "Se normaliza a array de maximo 8 tags.",
      },
    },
    globalRules: [
      `Rate limit: ${RATE_LIMIT_MAX_REQUESTS} solicitudes por minuto por IP.`,
      "Se permiten metodos GET, POST, PUT, DELETE y OPTIONS.",
      "Respuestas JSON con estructura { success, data/meta o error }.",
    ],
    examples: [
      "/api/v1/stations?top=true&order=votes&limit=12",
      "/api/v1/stations?q=jazz&country=MX&order=clickcount&limit=20",
      "/api/v1/stations?q=rock&country=US&order=bitrate&limit=10",
      "/api/v1/report",
      "/api/v1/report?limit=100",
      "POST /api/v1/favorites { name, streamUrl, country?, tags? }",
      "PUT /api/v1/favorites/1 { name?, streamUrl?, country?, tags? }",
      "DELETE /api/v1/favorites/1",
    ],
  });
});

app.get("/api/v1/report", async (req, res) => {
  const limitRaw = String(req.query.limit ?? "50").trim();
  const limit = Number.parseInt(limitRaw, 10);

  if (Number.isNaN(limit) || limit < 1 || limit > 200) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "limit para /api/v1/report debe ser numero entero entre 1 y 200.",
      },
      docs: "/api/v1/rules",
    });
  }

  try {
    const packagePath = path.join(__dirname, "package.json");
    const packageContent = await readFile(packagePath, "utf-8");
    const packageJson = JSON.parse(packageContent);
    const actions = actionLog.slice(0, limit);
    const actionsByPath = buildPathSummary(actionLog);

    return res.json({
      success: true,
      data: {
        packageJson,
        actions,
      },
      meta: {
        totalActions: actionLog.length,
        returnedActions: actions.length,
        maxStoredActions: ACTION_LOG_MAX_ITEMS,
        actionsByPath,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: "REPORT_ERROR",
        message: "No fue posible generar el reporte con package.json.",
      },
    });
  }
});

app.get("/api/v1/favorites", (req, res) => {
  return res.json({
    success: true,
    data: favorites,
    meta: {
      total: favorites.length,
    },
  });
});

app.post("/api/v1/favorites", (req, res) => {
  const validation = validateFavoritePayload(req.body, { partial: false });

  if (!validation.success) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Body invalido para crear favorito.",
        details: validation.errors,
      },
      docs: "/api/v1/rules",
    });
  }

  const now = new Date().toISOString();
  const favorite = {
    id: ++favoriteSequence,
    ...validation.value,
    createdAt: now,
    updatedAt: now,
  };

  favorites.unshift(favorite);

  return res.status(201).json({
    success: true,
    data: favorite,
  });
});

app.put("/api/v1/favorites/:id", (req, res) => {
  const id = parseFavoriteId(req.params.id);
  if (id === null) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "El parametro :id debe ser un entero positivo.",
      },
      docs: "/api/v1/rules",
    });
  }

  const target = favorites.find((item) => item.id === id);
  if (!target) {
    return res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: `No existe favorito con id ${id}.`,
      },
    });
  }

  const validation = validateFavoritePayload(req.body, { partial: true });
  if (!validation.success) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Body invalido para actualizar favorito.",
        details: validation.errors,
      },
      docs: "/api/v1/rules",
    });
  }

  if (Object.keys(validation.value).length === 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Debes enviar al menos un campo para actualizar.",
      },
      docs: "/api/v1/rules",
    });
  }

  Object.assign(target, validation.value, {
    updatedAt: new Date().toISOString(),
  });

  return res.json({
    success: true,
    data: target,
  });
});

app.delete("/api/v1/favorites/:id", (req, res) => {
  const id = parseFavoriteId(req.params.id);
  if (id === null) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "El parametro :id debe ser un entero positivo.",
      },
      docs: "/api/v1/rules",
    });
  }

  const index = favorites.findIndex((item) => item.id === id);
  if (index === -1) {
    return res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: `No existe favorito con id ${id}.`,
      },
    });
  }

  const deleted = favorites.splice(index, 1)[0];
  return res.json({
    success: true,
    data: deleted,
    meta: {
      remaining: favorites.length,
    },
  });
});

app.get("/api/v1/stations", async (req, res) => {
  const validation = validateStationQuery(req.query);

  if (!validation.success) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Parametros invalidos para /api/v1/stations.",
        details: validation.errors,
      },
      docs: "/api/v1/rules",
    });
  }

  const { q, country, order, limit, top } = validation.value;
  const upstreamParams = new URLSearchParams({
    hidebroken: "true",
    order,
    limit: String(limit),
    reverse: order === "name" ? "false" : "true",
  });

  if (country) {
    upstreamParams.set("countrycode", country);
  }

  if (q) {
    upstreamParams.set("name", q);
  } else if (!top) {
    // Si no viene query de busqueda y no es top, usar top por default.
    upstreamParams.set("order", "votes");
    upstreamParams.set("reverse", "true");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const upstreamResponse = await fetch(
      `${UPSTREAM_SEARCH_URL}?${upstreamParams.toString()}`,
      { signal: controller.signal }
    );

    if (!upstreamResponse.ok) {
      return res.status(502).json({
        success: false,
        error: {
          code: "UPSTREAM_ERROR",
          message: `La API externa respondio con HTTP ${upstreamResponse.status}.`,
        },
      });
    }

    const stations = await upstreamResponse.json();
    const data = stations
      .map(normalizeStation)
      .filter((station) => station.streamUrl);

    return res.json({
      success: true,
      data,
      meta: {
        total: data.length,
        query: { q, country, order, limit, top },
        source: "radio-browser",
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    const isAbortError = error?.name === "AbortError";
    const statusCode = isAbortError ? 504 : 500;
    return res.status(statusCode).json({
      success: false,
      error: {
        code: isAbortError ? "UPSTREAM_TIMEOUT" : "INTERNAL_ERROR",
        message: isAbortError
          ? "Tiempo de espera agotado al consultar la API externa."
          : "Ocurrio un error inesperado al procesar la solicitud.",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: "NOT_FOUND",
      message: "Ruta no encontrada.",
    },
    docs: "/api/v1/rules",
  });
});

app.listen(port, () => {
  console.log(`Act Streaming API disponible en http://localhost:${port}`);
});

function validateStationQuery(query) {
  const errors = [];

  const q = String(query.q ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const country = String(query.country ?? "")
    .trim()
    .toUpperCase();
  const order = String(query.order ?? "votes")
    .trim()
    .toLowerCase();
  const limitRaw = String(query.limit ?? DEFAULT_LIMIT).trim();
  const topRaw = String(query.top ?? "false")
    .trim()
    .toLowerCase();

  const limit = Number.parseInt(limitRaw, 10);
  const top = parseBoolean(topRaw);

  if (q && (q.length < 2 || q.length > 60)) {
    errors.push("q debe tener entre 2 y 60 caracteres.");
  }

  if (country && !/^[A-Z]{2}$/.test(country)) {
    errors.push("country debe ser codigo ISO de 2 letras (ejemplo: MX, US, ES).");
  }

  if (!ALLOWED_ORDERS.includes(order)) {
    errors.push(`order debe ser uno de: ${ALLOWED_ORDERS.join(", ")}.`);
  }

  if (Number.isNaN(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT) {
    errors.push(`limit debe ser numero entero entre ${MIN_LIMIT} y ${MAX_LIMIT}.`);
  }

  if (top === null) {
    errors.push("top debe ser booleano: true/false o 1/0.");
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    value: {
      q,
      country,
      order,
      limit,
      top,
    },
  };
}

function parseBoolean(value) {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return null;
}

function normalizeStation(station) {
  const tags =
    station.tags
      ?.split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 4) || [];

  const rawName = String(station.name ?? "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    id: station.stationuuid || "",
    name: rawName || "Estacion sin nombre",
    country: station.country || "Pais no disponible",
    countryCode: station.countrycode || "",
    tags,
    codec: station.codec || "N/A",
    bitrate: Number(station.bitrate) || 0,
    votes: Number(station.votes) || 0,
    clickCount: Number(station.clickcount) || 0,
    streamUrl: station.url_resolved || station.url || "",
    homepage: station.homepage || "",
    logo: station.favicon || "",
  };
}

function validateFavoritePayload(payload, { partial }) {
  const errors = [];
  const body = payload && typeof payload === "object" ? payload : {};
  const data = {};

  const hasName = Object.prototype.hasOwnProperty.call(body, "name");
  const hasStreamUrl = Object.prototype.hasOwnProperty.call(body, "streamUrl");
  const hasCountry = Object.prototype.hasOwnProperty.call(body, "country");
  const hasTags = Object.prototype.hasOwnProperty.call(body, "tags");

  if (!partial && !hasName) {
    errors.push("name es requerido.");
  }
  if (!partial && !hasStreamUrl) {
    errors.push("streamUrl es requerido.");
  }

  if (hasName) {
    const name = String(body.name ?? "")
      .trim()
      .replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 80) {
      errors.push("name debe tener entre 2 y 80 caracteres.");
    } else {
      data.name = name;
    }
  }

  if (hasStreamUrl) {
    const streamUrl = String(body.streamUrl ?? "").trim();
    if (!isHttpUrl(streamUrl)) {
      errors.push("streamUrl debe ser una URL valida con protocolo http/https.");
    } else {
      data.streamUrl = streamUrl;
    }
  }

  if (hasCountry) {
    const country = String(body.country ?? "")
      .trim()
      .replace(/\s+/g, " ");
    if (country.length > 60) {
      errors.push("country no puede superar 60 caracteres.");
    } else {
      data.country = country || "Pais no disponible";
    }
  }

  if (hasTags) {
    const tags = normalizeFavoriteTags(body.tags);
    if (tags === null) {
      errors.push("tags debe ser string o array de strings (maximo 8).");
    } else {
      data.tags = tags;
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  if (!partial) {
    if (!Object.prototype.hasOwnProperty.call(data, "country")) {
      data.country = "Pais no disponible";
    }
    if (!Object.prototype.hasOwnProperty.call(data, "tags")) {
      data.tags = [];
    }
  }

  return {
    success: true,
    value: data,
  };
}

function normalizeFavoriteTags(value) {
  const list = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);

  if (!Array.isArray(list)) {
    return null;
  }

  const normalized = list
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .slice(0, 8);

  return normalized;
}

function parseFavoriteId(rawId) {
  const id = Number.parseInt(String(rawId ?? "").trim(), 10);
  if (Number.isNaN(id) || id < 1) {
    return null;
  }
  return id;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function registerAction(action) {
  actionLog.unshift(action);
  if (actionLog.length > ACTION_LOG_MAX_ITEMS) {
    actionLog.pop();
  }
}

function buildPathSummary(actions) {
  return actions.reduce((acc, item) => {
    const key = item.path?.split("?")[0] || "/";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function publicRateLimit(req, res, next) {
  const now = Date.now();
  const ip = getClientIp(req);
  const current = requestCounters.get(ip) || {
    count: 0,
    windowStart: now,
  };

  if (now - current.windowStart >= RATE_LIMIT_WINDOW_MS) {
    current.count = 0;
    current.windowStart = now;
  }

  current.count += 1;
  requestCounters.set(ip, current);

  const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - current.count);
  const retryAfterSeconds = Math.max(
    0,
    Math.ceil((current.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000)
  );

  res.setHeader("X-RateLimit-Limit", String(RATE_LIMIT_MAX_REQUESTS));
  res.setHeader("X-RateLimit-Remaining", String(remaining));
  res.setHeader("X-RateLimit-Reset", String(retryAfterSeconds));

  if (current.count > RATE_LIMIT_MAX_REQUESTS) {
    res.setHeader("Retry-After", String(retryAfterSeconds));
    return res.status(429).json({
      success: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: `Excediste el limite de ${RATE_LIMIT_MAX_REQUESTS} solicitudes por minuto.`,
      },
      retryAfterSeconds,
    });
  }

  pruneRateLimitMap(now);
  return next();
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

function pruneRateLimitMap(now) {
  if (requestCounters.size < 2000) {
    return;
  }

  for (const [ip, entry] of requestCounters.entries()) {
    if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS * 2) {
      requestCounters.delete(ip);
    }
  }
}
