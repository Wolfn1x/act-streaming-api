const API_BASE_URL = "/api/v1";
const MAX_RESULTS = 24;
const LOGO_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' x2='1' y1='0' y2='1'%3E%3Cstop offset='0' stop-color='%2314d8d2'/%3E%3Cstop offset='1' stop-color='%23ff8c28'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='120' height='120' fill='%2306121d'/%3E%3Ccircle cx='60' cy='60' r='34' fill='url(%23g)'/%3E%3Cpath d='M44 66a16 16 0 1 1 32 0' fill='none' stroke='%2306121d' stroke-width='6'/%3E%3Ccircle cx='60' cy='66' r='6' fill='%2306121d'/%3E%3C/svg%3E";

const state = {
  stations: [],
  activeStationId: null,
  activeRequestId: 0,
};

const elements = {
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  countrySelect: document.querySelector("#countrySelect"),
  orderSelect: document.querySelector("#orderSelect"),
  topBtn: document.querySelector("#topBtn"),
  resultsMeta: document.querySelector("#resultsMeta"),
  statusBox: document.querySelector("#statusBox"),
  resultsGrid: document.querySelector("#resultsGrid"),
  stationTemplate: document.querySelector("#stationTemplate"),
  audioPlayer: document.querySelector("#audioPlayer"),
  nowPlaying: document.querySelector("#nowPlaying"),
  playerMeta: document.querySelector("#playerMeta"),
};

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  void fetchStations({ topMode: true });
});

function bindEvents() {
  elements.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void fetchStations({ topMode: false });
  });

  elements.topBtn.addEventListener("click", () => {
    elements.searchInput.value = "";
    elements.countrySelect.value = "";
    elements.orderSelect.value = "votes";
    void fetchStations({ topMode: true });
  });

  elements.resultsGrid.addEventListener("click", (event) => {
    const button = event.target.closest("button.play-btn[data-index]");
    if (!button) {
      return;
    }

    const index = Number(button.dataset.index);
    if (Number.isNaN(index)) {
      return;
    }

    const selectedStation = state.stations[index];
    if (!selectedStation) {
      return;
    }

    void playStation(selectedStation);
  });

  elements.audioPlayer.addEventListener("error", () => {
    if (state.activeStationId) {
      setStatus(
        "No se pudo reproducir esta senal. Prueba otra estacion.",
        "error"
      );
    }
  });
}

function setStatus(message, type = "info") {
  elements.statusBox.textContent = message;
  elements.statusBox.className = `status${type === "error" ? " error" : ""}`;
}

function setMeta(total, topMode) {
  const context = topMode
    ? "top global por votos"
    : `busqueda: "${elements.searchInput.value.trim() || "sin termino"}"`;
  elements.resultsMeta.textContent = `${total} estaciones (${context})`;
}

function buildSearchUrl({ topMode }) {
  const params = new URLSearchParams();
  const orderBy = elements.orderSelect.value || "votes";

  params.set("limit", String(MAX_RESULTS));
  params.set("order", orderBy);
  if (topMode) {
    params.set("top", "true");
  }

  const searchTerm = elements.searchInput.value.trim();
  const countryCode = elements.countrySelect.value;

  if (!topMode && searchTerm) {
    params.set("q", searchTerm);
  }

  if (countryCode) {
    params.set("country", countryCode);
  }

  return `${API_BASE_URL}/stations?${params.toString()}`;
}

async function fetchStations({ topMode }) {
  const requestId = ++state.activeRequestId;
  const requestUrl = buildSearchUrl({ topMode });

  setStatus("Consultando API publica...");
  setLoading(true);

  try {
    const response = await fetch(requestUrl);
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      throw new Error(payload?.error?.message || `Error HTTP ${response.status}`);
    }

    if (requestId !== state.activeRequestId) {
      return;
    }

    state.stations = (payload.data || [])
      .map((station) => normalizeStation(station))
      .filter((station) => station.streamUrl);

    renderStations();

    if (state.stations.length === 0) {
      setMeta(0, topMode);
      setStatus(
        "No se encontraron estaciones con esos filtros. Intenta otra busqueda."
      );
      return;
    }

    setMeta(state.stations.length, topMode);
    setStatus("Selecciona una estacion para iniciar la reproduccion.");
  } catch (error) {
    if (requestId !== state.activeRequestId) {
      return;
    }

    setMeta(0, topMode);
    setStatus(
      "No fue posible conectar con la API publica. Intenta de nuevo.",
      "error"
    );
    elements.resultsGrid.innerHTML = "";
  } finally {
    if (requestId === state.activeRequestId) {
      setLoading(false);
    }
  }
}

function normalizeStation(station) {
  const tags = Array.isArray(station.tags)
    ? station.tags.filter(Boolean).slice(0, 3).join(" | ")
    : station.tags
        ?.split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(" | ");

  const rawName = (station.name || "").replace(/\s+/g, " ").trim();

  return {
    id:
      station.id ||
      station.stationuuid ||
      `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    name: rawName || "Estacion sin nombre",
    country: station.country || station.countrycode || "Pais no disponible",
    codec: station.codec || "N/A",
    bitrate: Number(station.bitrate) || 0,
    votes: Number(station.votes) || 0,
    clicks: Number(station.clickCount ?? station.clickcount) || 0,
    tags: tags || "Sin etiquetas",
    streamUrl: station.streamUrl || station.url_resolved || station.url || "",
    homepage: station.homepage || "",
    logo: station.logo || station.favicon || "",
  };
}

function renderStations() {
  elements.resultsGrid.innerHTML = "";

  const fragment = document.createDocumentFragment();
  state.stations.forEach((station, index) => {
    fragment.append(createStationCard(station, index));
  });

  elements.resultsGrid.append(fragment);
}

function createStationCard(station, index) {
  const node = elements.stationTemplate.content.cloneNode(true);
  const logo = node.querySelector(".station-logo");
  const name = node.querySelector(".station-name");
  const tags = node.querySelector(".station-tags");
  const country = node.querySelector(".station-country");
  const codec = node.querySelector(".station-codec");
  const bitrate = node.querySelector(".station-bitrate");
  const stats = node.querySelector(".station-stats");
  const playButton = node.querySelector(".play-btn");
  const siteLink = node.querySelector(".site-link");

  logo.src = station.logo && isValidUrl(station.logo) ? station.logo : LOGO_PLACEHOLDER;
  logo.alt = `Logo de ${station.name}`;
  logo.loading = "lazy";
  logo.addEventListener("error", () => {
    logo.src = LOGO_PLACEHOLDER;
  });

  name.textContent = station.name;
  tags.textContent = station.tags;
  country.textContent = station.country;
  codec.textContent = `Codec: ${station.codec}`;
  bitrate.textContent = `Bitrate: ${station.bitrate || "?"} kbps`;
  stats.textContent = `Votos: ${formatNumber(station.votes)} | Clicks: ${formatNumber(station.clicks)}`;

  playButton.dataset.index = String(index);

  if (station.homepage && isValidUrl(station.homepage)) {
    siteLink.href = station.homepage;
  } else {
    siteLink.classList.add("hidden");
  }

  return node;
}

async function playStation(station) {
  if (!station.streamUrl || !isValidUrl(station.streamUrl)) {
    setStatus("La URL de streaming de esta estacion no es valida.", "error");
    return;
  }

  state.activeStationId = station.id;

  elements.nowPlaying.textContent = `Reproduciendo: ${station.name}`;
  elements.playerMeta.textContent = `${station.country} | ${station.codec} | ${station.bitrate || "?"} kbps`;
  elements.audioPlayer.src = station.streamUrl;

  try {
    await elements.audioPlayer.play();
    setStatus(`Streaming activo: ${station.name}`);
  } catch (error) {
    setStatus(
      "El navegador bloqueo la reproduccion automatica. Presiona play manualmente.",
      "error"
    );
  }
}

function setLoading(loading) {
  const controls = [
    elements.searchInput,
    elements.countrySelect,
    elements.orderSelect,
    elements.topBtn,
  ];

  controls.forEach((control) => {
    control.disabled = loading;
  });
}

function formatNumber(value) {
  return new Intl.NumberFormat("es-MX").format(value);
}

function isValidUrl(value) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
