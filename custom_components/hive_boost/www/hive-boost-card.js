/**
 * Hive Boost Card — individual per-room boost card for HA dashboards.
 *
 * Configuration:
 *   type: custom:hive-boost-card
 *   entity: climate.lounge    # climate.* or sensor.*_boost
 *   name: Lounge              # optional display name override
 *   icon: mdi:thermometer     # optional icon (omit for default flame SVG)
 *   show_graph: true          # optional background temperature history graph
 */

const BOOST_DOMAIN = "hive_boost";
const HOUR_OPTIONS = [0, 1, 2, 3];
const MINUTE_OPTIONS = [0, 15, 30, 45];
const HISTORY_REFRESH_MS = 5 * 60 * 1000; // re-fetch graph data every 5 min
const HISTORY_HOURS = 24;
const TEMP_STEP = 0.5;
const TEMP_MIN = 5;
const TEMP_MAX = 32;

class HiveBoostCard extends HTMLElement {
  static getStubConfig() {
    return { entity: "climate.example" };
  }

  // Default grid placement: half-width (6 of 12 columns), 3 rows tall.
  static getGridOptions() {
    return { columns: 6, rows: 3 };
  }

  constructor() {
    super();
    this._hass = null;
    this._config = null;
    this._climateId = null;
    this._sensorId = null;
    this._modalOpen = false;
    this._modalTemp = 22;
    this._modalHours = 1;
    this._modalMins = 0;
    this._graphData = null;
    this._lastHistoryFetch = 0;
    this._initialized = false;
    this._sheetBackdrop = null;
    this._sheetEl = null;
    this.attachShadow({ mode: "open" });
  }

  setConfig(config) {
    if (!config.entity) throw new Error("hive-boost-card: 'entity' is required");
    this._config = config;
    const id = config.entity;
    if (id.startsWith("climate.")) {
      this._climateId = id;
      this._sensorId = "sensor." + id.slice("climate.".length) + "_boost";
    } else if (id.startsWith("sensor.") && id.endsWith("_boost")) {
      this._sensorId = id;
      this._climateId = "climate." + id.slice("sensor.".length, -"_boost".length);
    } else {
      throw new Error("hive-boost-card: entity must be climate.* or sensor.*_boost");
    }
    this._graphData = null;
    this._lastHistoryFetch = 0;
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config?.show_graph) {
      const now = Date.now();
      if (now - this._lastHistoryFetch > HISTORY_REFRESH_MS) {
        this._lastHistoryFetch = now;
        this._fetchHistory();
      }
    }

    // If boost became active externally while the sheet was open, close it
    if (this._boostActive && this._modalOpen) {
      this._closeSheet();
      return;
    }

    if (this._modalOpen) return;

    try {
      this._render();
    } catch (e) {
      console.error("[HiveBoostCard] render error:", e);
    }
  }

  getCardSize() {
    return 3;
  }

  // ── History / graph ───────────────────────────────────────────────────────

  async _fetchHistory() {
    try {
      const start = new Date(Date.now() - HISTORY_HOURS * 60 * 60 * 1000).toISOString();
      const result = await this._hass.connection.sendMessagePromise({
        type: "history/history_during_period",
        start_time: start,
        entity_ids: [this._climateId],
        minimal_response: true,
        no_attributes: false,
        significant_changes_only: false,
      });

      const entries = result[this._climateId] ?? [];
      const temps = entries
        .map(e => e.a?.current_temperature)
        .filter(t => t != null && !isNaN(t));

      if (temps.length >= 2) {
        this._graphData = temps;
        if (!this._modalOpen) this._render();
      }
    } catch (e) {
      console.debug("[HiveBoostCard] history fetch failed:", e);
    }
  }

  _buildGraphSvg() {
    const data = this._graphData;
    if (!data || data.length < 2) return "";

    const W = 500, H = 120, PAD = 12;

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const toX = i  => (i / (data.length - 1)) * W;
    const toY = t  => H - PAD - ((t - min) / range) * (H - PAD * 2);

    const pts = data.map((t, i) => [toX(i), toY(t)]);

    let linePath = `M ${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const cx = (x0 + x1) / 2;
      linePath += ` C ${cx},${y0} ${cx},${y1} ${x1},${y1}`;
    }
    const fillPath = `${linePath} L ${W},${H} L 0,${H} Z`;

    const gradId = `hbg-${this._climateId.replace(/\W/g, "_")}`;

    return `
      <svg class="graph-bg"
           viewBox="0 0 ${W} ${H}"
           preserveAspectRatio="none"
           xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="var(--accent-color)" stop-opacity="0.25"/>
            <stop offset="100%" stop-color="var(--accent-color)" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="${fillPath}"
              fill="url(#${gradId})"/>
        <path d="${linePath}"
              fill="none"
              stroke="var(--accent-color)"
              stroke-width="2.5"
              stroke-opacity="0.8"
              stroke-linecap="round"
              stroke-linejoin="round"/>
      </svg>`;
  }

  // ── Data helpers ──────────────────────────────────────────────────────────

  get _sensor()      { return this._hass?.states[this._sensorId]; }
  get _climate()     { return this._hass?.states[this._climateId]; }
  get _boostActive() { return this._sensor?.attributes.boost_active === true; }

  get _currentTemp() {
    const t = this._sensor?.attributes.current_temperature
           ?? this._climate?.attributes.current_temperature;
    return t != null ? `${parseFloat(t).toFixed(1)}°` : "—";
  }

  get _name() {
    if (this._config?.name) return this._config.name;
    const fn = this._sensor?.attributes.friendly_name
            || this._climate?.attributes.friendly_name
            || "";
    if (fn) return fn.replace(/\s*boost$/i, "").trim();
    return this._climateId
      .replace(/^climate\./, "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  get _statusText() {
    if (this._boostActive) {
      const m = this._sensor?.attributes.minutes_remaining;
      return { label: m > 0 ? `${m}m left` : "Boosting", active: true, heating: false };
    }
    const action = this._climate?.attributes.hvac_action;
    const target = this._climate?.attributes.temperature;
    if (action === "heating" && target != null) {
      return { label: `Heating to ${target}°`, active: false, heating: true };
    }
    const mode = this._climate?.state;
    return { label: mode === "off" || !mode ? "Off" : mode, active: false, heating: false };
  }

  _formatTemp(t) {
    return (t % 1 === 0) ? `${t}°` : `${t.toFixed(1)}°`;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  _render() {
    if (!this._hass || !this._config) return;

    const root = this.shadowRoot;

    if (!this._initialized) {
      this._initialized = true;

      const style = document.createElement("style");
      style.textContent = CSS;
      root.appendChild(style);

      const card = document.createElement("ha-card");
      card.id = "hbc-card";
      root.appendChild(card);
    }

    const { label: statusLabel, active: statusActive, heating: statusHeating } = this._statusText;

    root.getElementById("hbc-card").innerHTML = `
      <div class="card-top">
        ${this._config.show_graph ? this._buildGraphSvg() : ""}
        <div class="body">

          <div class="row-top">
            ${this._config.icon
              ? `<ha-icon class="icon" icon="${this._config.icon}"></ha-icon>`
              : `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                   <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>
                 </svg>`
            }
            <span class="name">${this._name}</span>
            <div class="status-wrap">
              ${statusHeating ? `<ha-icon class="status-flame" icon="mdi:fire"></ha-icon>` : ""}
              <span class="status ${statusActive || statusHeating ? "status--on" : ""}">${statusLabel}</span>
            </div>
          </div>

          <div class="row-main">
            <div class="temp-block">
              <span class="temp-val">${this._currentTemp}</span>
              <span class="temp-lbl">Current</span>
            </div>
            <div class="actions">
              ${this._boostActive ? `
                <div class="pill-active">Boosting</div>
                <button class="btn-stop" id="stop-btn">Stop boost</button>
              ` : `
                <button class="btn-boost" id="toggle-btn">Boost</button>
              `}
            </div>
          </div>

        </div>
      </div>
    `;

    this._bindCardEvents();
  }

  _bindCardEvents() {
    const card = this.shadowRoot.getElementById("hbc-card");

    card.querySelector("#toggle-btn")?.addEventListener("click", () => {
      if (this._modalOpen) return;
      this._openModal();
    });

    card.querySelector("#stop-btn")?.addEventListener("click", async () => {
      try {
        await this._hass.callService(BOOST_DOMAIN, "cancel_boost", {
          entity_id: this._climateId,
        });
      } catch (e) {
        console.error("[HiveBoostCard] cancel_boost:", e);
      }
    });
  }

  // ── Bottom Sheet Modal ────────────────────────────────────────────────────

  _openModal() {
    if (this._modalOpen) return;

    // Inject global sheet styles once into the main document
    if (!document.getElementById("hive-boost-sheet-styles")) {
      const style = document.createElement("style");
      style.id = "hive-boost-sheet-styles";
      style.textContent = SHEET_CSS;
      document.head.appendChild(style);
    }

    const backdrop = document.createElement("div");
    backdrop.className = "hive-boost-backdrop";

    const sheet = document.createElement("div");
    sheet.className = "hive-boost-sheet";

    const tooShort = this._modalHours * 60 + this._modalMins < 15;
    const tempDisplay = this._formatTemp(this._modalTemp);

    sheet.innerHTML = `
      <div class="hbs-handle"></div>
      <div class="hbs-title">${this._name}</div>

      <div class="hbs-temp-card">
        <button class="hbs-temp-adj" data-adj="-${TEMP_STEP}" ${this._modalTemp <= TEMP_MIN ? "disabled" : ""}>−</button>
        <span class="hbs-temp-display">${tempDisplay}</span>
        <button class="hbs-temp-adj" data-adj="${TEMP_STEP}" ${this._modalTemp >= TEMP_MAX ? "disabled" : ""}>+</button>
      </div>

      <div class="hbs-dur-section">
        <div class="hbs-dur-label">Duration</div>
        <div class="hbs-dur-picker-wrap">
          <div class="hbs-dur-highlight"></div>
          <div class="hbs-dur-pickers">
            <div class="hbs-dur-scroll" id="hours-scroll">
              <div class="hbs-dur-spacer"></div>
              ${HOUR_OPTIONS.map(h => `<div class="hbs-dur-scroll-item">${h}h</div>`).join("")}
              <div class="hbs-dur-spacer"></div>
            </div>
            <div class="hbs-dur-scroll" id="mins-scroll">
              <div class="hbs-dur-spacer"></div>
              ${MINUTE_OPTIONS.map(m => `<div class="hbs-dur-scroll-item">${m}m</div>`).join("")}
              <div class="hbs-dur-spacer"></div>
            </div>
          </div>
        </div>
      </div>

      <button class="hbs-btn-start" id="start-btn" ${tooShort ? "disabled" : ""}>Start</button>
      <button class="hbs-btn-cancel" id="cancel-btn">Cancel</button>
    `;

    this._sheetBackdrop = backdrop;
    this._sheetEl = sheet;
    this._modalOpen = true;

    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);

    this._bindModalEvents();

    // Double rAF ensures the element is in the DOM and painted before the
    // transition fires — otherwise the browser skips the opening animation.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      backdrop.classList.add("open");
      sheet.classList.add("open");
    }));

    // Set initial scroll positions and highlights after layout
    setTimeout(() => {
      const ITEM_H = 52;
      const hoursScroll = sheet.querySelector("#hours-scroll");
      const minsScroll  = sheet.querySelector("#mins-scroll");
      if (hoursScroll) hoursScroll.scrollTop = HOUR_OPTIONS.indexOf(this._modalHours) * ITEM_H;
      if (minsScroll)  minsScroll.scrollTop  = MINUTE_OPTIONS.indexOf(this._modalMins) * ITEM_H;
      this._updateScrollHighlights(sheet);
    }, 50);

    backdrop.addEventListener("click", () => this._closeSheet());
  }

  _closeSheet() {
    const backdrop = this._sheetBackdrop;
    const sheet = this._sheetEl;
    if (!backdrop && !sheet) return;

    if (backdrop) backdrop.classList.remove("open");
    if (sheet) sheet.classList.remove("open");

    this._sheetBackdrop = null;
    this._sheetEl = null;

    setTimeout(() => {
      backdrop?.remove();
      sheet?.remove();
      this._modalOpen = false;
      this._resetModal();
      this._render();
    }, 350);
  }

  _updateScrollHighlights(container) {
    const ITEM_H = 52;
    container.querySelectorAll(".hbs-dur-scroll").forEach(scrollEl => {
      const idx = Math.round(scrollEl.scrollTop / ITEM_H);
      scrollEl.querySelectorAll(".hbs-dur-scroll-item").forEach((item, i) => {
        item.classList.toggle("selected", i === idx);
      });
    });
  }

  _bindModalEvents() {
    const sheet = this._sheetEl;
    if (!sheet) return;

    const ITEM_H = 52;

    // Temperature adjustment — 0.5° steps with float-safe rounding
    sheet.querySelectorAll(".hbs-temp-adj").forEach(btn => {
      btn.addEventListener("click", () => {
        const adj = parseFloat(btn.dataset.adj);
        this._modalTemp = Math.max(TEMP_MIN, Math.min(TEMP_MAX,
          Math.round((this._modalTemp + adj) * 10) / 10
        ));
        sheet.querySelector(".hbs-temp-display").textContent = this._formatTemp(this._modalTemp);
        sheet.querySelector(`[data-adj="-${TEMP_STEP}"]`).disabled = this._modalTemp <= TEMP_MIN;
        sheet.querySelector(`[data-adj="${TEMP_STEP}"]`).disabled  = this._modalTemp >= TEMP_MAX;
      });
    });

    // Drum-roll scroll pickers
    const setupScrollPicker = (scrollEl, options, setVal) => {
      let scrollTimer;
      scrollEl.addEventListener("scroll", () => {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          const idx = Math.max(0, Math.min(options.length - 1, Math.round(scrollEl.scrollTop / ITEM_H)));
          setVal(options[idx]);
          scrollEl.scrollTo({ top: idx * ITEM_H, behavior: "smooth" });
          this._updateScrollHighlights(sheet);
          const startBtn = sheet.querySelector("#start-btn");
          if (startBtn) startBtn.disabled = this._modalHours * 60 + this._modalMins < 15;
        }, 150);
      });
    };

    setupScrollPicker(
      sheet.querySelector("#hours-scroll"),
      HOUR_OPTIONS,
      v => { this._modalHours = v; }
    );
    setupScrollPicker(
      sheet.querySelector("#mins-scroll"),
      MINUTE_OPTIONS,
      v => { this._modalMins = v; }
    );

    // Start boost
    sheet.querySelector("#start-btn")?.addEventListener("click", async () => {
      const mins = Math.max(15, this._modalHours * 60 + this._modalMins);
      try {
        await this._hass.callService(BOOST_DOMAIN, "start_boost", {
          entity_id: this._climateId,
          temperature: this._modalTemp,
          duration_minutes: mins,
        });
        this._closeSheet();
      } catch (e) {
        console.error("[HiveBoostCard] start_boost:", e);
      }
    });

    // Cancel
    sheet.querySelector("#cancel-btn")?.addEventListener("click", () => {
      this._closeSheet();
    });
  }

  _resetModal() {
    this._modalTemp = 22;
    this._modalHours = 1;
    this._modalMins = 0;
  }
}

// ── Card styles (shadow DOM) ───────────────────────────────────────────────

const CSS = `
  ha-card { overflow: hidden; }

  .card-top {
    position: relative;
    overflow: hidden;
  }

  .graph-bg {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 55%;
    pointer-events: none;
    z-index: 0;
  }

  .body {
    padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: var(--primary-text-color, #1A1A2E);
    position: relative;
    z-index: 1;
  }

  .row-top {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
  }
  .icon { width: 18px; height: 18px; flex-shrink: 0; color: var(--secondary-text-color, #aaa); --mdi-icon-size: 18px; }
  .name { flex: 1; font-size: 15px; font-weight: 600; }
  .status-wrap { display: flex; align-items: center; gap: 3px; }
  .status-flame { --mdi-icon-size: 14px; color: var(--state-active-color, #FF6600); }
  .status { font-size: 13px; color: var(--secondary-text-color, #aaa); }
  .status--on { color: var(--state-active-color, #FF6600); font-weight: 600; }

  .row-main {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
  }
  .temp-block { display: flex; flex-direction: column; }
  .temp-val { font-size: 36px; font-weight: 300; line-height: 1; }
  .temp-lbl { font-size: 11px; color: var(--secondary-text-color, #aaa); margin-top: 3px; }

  .actions {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }

  .btn-boost {
    padding: 10px 22px;
    background: color-mix(in srgb, var(--primary-color) 15%, var(--card-background-color, white));
    border: none;
    border-radius: 50px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    color: var(--primary-color);
    transition: background 0.2s;
  }
  .btn-boost:active { opacity: 0.8; }

  .pill-active {
    padding: 10px 22px;
    background: var(--state-active-color, #FF6600);
    border-radius: 50px;
    font-size: 14px;
    font-weight: 600;
    color: white;
  }
  .btn-stop {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 12px;
    color: var(--secondary-text-color, #aaa);
    padding: 2px 6px;
    transition: color 0.15s;
  }
  .btn-stop:hover { color: var(--error-color, #FF3B30); }
`;

// ── Bottom sheet styles (injected into document.head) ─────────────────────
// These live outside shadow DOM so position:fixed works correctly relative
// to the viewport, matching the HA entity-details slide-up pattern.

const SHEET_CSS = `
  .hive-boost-backdrop {
    position: fixed;
    inset: 0;
    background: transparent;
    z-index: 9998;
    transition: background 0.3s ease;
  }
  .hive-boost-backdrop.open {
    background: rgba(0, 0, 0, 0.32);
  }

  .hive-boost-sheet {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--ha-card-background, var(--card-background-color, #fff));
    border-radius: 28px 28px 0 0;
    z-index: 9999;
    transform: translateY(100%);
    transition: transform 0.35s cubic-bezier(0.05, 0.7, 0.1, 1.0);
    max-height: 85vh;
    overflow-y: auto;
    padding: 0 20px calc(24px + env(safe-area-inset-bottom, 0px));
    box-shadow: 0 -2px 20px rgba(0, 0, 0, 0.14);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: var(--primary-text-color, #1A1A2E);
  }
  .hive-boost-sheet.open {
    transform: translateY(0);
  }

  /* Drag handle */
  .hbs-handle {
    width: 36px;
    height: 4px;
    background: var(--divider-color, #e0e0e0);
    border-radius: 2px;
    margin: 12px auto 20px;
  }

  /* Sheet title */
  .hbs-title {
    font-size: 20px;
    font-weight: 600;
    color: var(--primary-text-color, #1A1A2E);
    text-align: center;
    margin-bottom: 24px;
  }

  /* Temperature card */
  .hbs-temp-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: color-mix(in srgb, var(--primary-color, #3D5AFE) 10%, var(--card-background-color, white));
    border-radius: 16px;
    padding: 20px;
    margin-bottom: 24px;
  }
  .hbs-temp-adj {
    width: 44px;
    height: 44px;
    border: none;
    background: transparent;
    font-size: 30px;
    font-weight: 300;
    cursor: pointer;
    color: var(--primary-text-color, #333);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    transition: background 0.15s;
    line-height: 1;
  }
  .hbs-temp-adj:disabled { color: var(--disabled-color, #ccc); cursor: default; }
  .hbs-temp-adj:not(:disabled):active {
    background: color-mix(in srgb, var(--primary-color, #3D5AFE) 20%, transparent);
  }
  .hbs-temp-display {
    font-size: 38px;
    font-weight: 500;
    color: var(--primary-color, #3D5AFE);
    min-width: 90px;
    text-align: center;
  }

  /* Duration section */
  .hbs-dur-section { margin-bottom: 20px; }
  .hbs-dur-label {
    text-align: center;
    font-size: 15px;
    color: var(--secondary-text-color, #888);
    margin-bottom: 8px;
  }

  /* Drum-roll picker */
  .hbs-dur-picker-wrap {
    position: relative;
    height: 156px;
    overflow: hidden;
    border-radius: 12px;
  }
  .hbs-dur-picker-wrap::before,
  .hbs-dur-picker-wrap::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 60px;
    z-index: 2;
    pointer-events: none;
  }
  .hbs-dur-picker-wrap::before {
    top: 0;
    background: linear-gradient(to bottom,
      var(--ha-card-background, var(--card-background-color, white)) 20%,
      transparent 100%);
  }
  .hbs-dur-picker-wrap::after {
    bottom: 0;
    background: linear-gradient(to top,
      var(--ha-card-background, var(--card-background-color, white)) 20%,
      transparent 100%);
  }

  /* Highlight bar — sits behind the centre row */
  .hbs-dur-highlight {
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 52px;
    transform: translateY(-50%);
    background: color-mix(in srgb, var(--primary-color, #3D5AFE) 12%, var(--card-background-color, white));
    border-radius: 12px;
    pointer-events: none;
    z-index: 1;
  }

  .hbs-dur-pickers {
    display: flex;
    height: 100%;
    position: relative;
    z-index: 0;
  }
  .hbs-dur-scroll {
    flex: 1;
    overflow-y: scroll;
    scroll-snap-type: y mandatory;
    height: 100%;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .hbs-dur-scroll::-webkit-scrollbar { display: none; }
  .hbs-dur-spacer { height: 52px; flex-shrink: 0; }
  .hbs-dur-scroll-item {
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    scroll-snap-align: center;
    font-size: 22px;
    font-weight: 400;
    color: var(--secondary-text-color, #bbb);
    user-select: none;
    transition: color 0.15s, font-weight 0.15s, font-size 0.15s;
  }
  /* Selected item inside the highlight bar */
  .hbs-dur-scroll-item.selected {
    color: var(--primary-color, #3D5AFE);
    font-weight: 700;
    font-size: 24px;
  }

  /* Action buttons */
  .hbs-btn-start {
    display: block;
    width: 100%;
    padding: 16px;
    background: var(--primary-color, #3D5AFE);
    color: white;
    border: none;
    border-radius: 12px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    margin-bottom: 10px;
    transition: opacity 0.15s;
    box-sizing: border-box;
  }
  .hbs-btn-start:disabled { opacity: 0.4; cursor: default; }
  .hbs-btn-start:not(:disabled):active { opacity: 0.85; }

  .hbs-btn-cancel {
    display: block;
    width: 100%;
    padding: 16px;
    background: color-mix(in srgb, var(--primary-color, #3D5AFE) 8%, var(--card-background-color, white));
    color: var(--primary-color, #3D5AFE);
    border: none;
    border-radius: 12px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
    box-sizing: border-box;
  }
  .hbs-btn-cancel:active { opacity: 0.85; }
`;

if (!customElements.get("hive-boost-card")) {
  customElements.define("hive-boost-card", HiveBoostCard);
}
