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
const HISTORY_REFRESH_MS = 5 * 60 * 1000;
const HISTORY_HOURS = 24;
const TEMP_STEP = 0.5;
const TEMP_MIN = 5;
const TEMP_MAX = 32;

// ── HiveBoostCard ─────────────────────────────────────────────────────────
// Main dashboard card. Opens a self-contained bottom-sheet overlay
// containing HiveBoostPicker to configure and fire the boost.

class HiveBoostCard extends HTMLElement {
  static getStubConfig() {
    return { entity: "climate.example" };
  }

  static getGridOptions() {
    return { columns: 6, rows: 3 };
  }

  constructor() {
    super();
    this._hass = null;
    this._config = null;
    this._climateId = null;
    this._sensorId = null;
    this._opening = false; // debounce rapid taps
    this._graphData = null;
    this._lastHistoryFetch = 0;
    this._initialized = false;
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
    if (this._overlayPicker) this._overlayPicker.hass = hass;
    if (this._config?.show_graph) {
      const now = Date.now();
      if (now - this._lastHistoryFetch > HISTORY_REFRESH_MS) {
        this._lastHistoryFetch = now;
        this._fetchHistory();
      }
    }
    try {
      this._render();
    } catch (e) {
      console.error("[HiveBoostCard] render error:", e);
    }
  }

  getCardSize() { return 3; }

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
        this._render();
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
    const toX = i => (i / (data.length - 1)) * W;
    const toY = t => H - PAD - ((t - min) / range) * (H - PAD * 2);
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
      <svg class="graph-bg" viewBox="0 0 ${W} ${H}"
           preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="var(--accent-color)" stop-opacity="0.25"/>
            <stop offset="100%" stop-color="var(--accent-color)" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="${fillPath}" fill="url(#${gradId})"/>
        <path d="${linePath}" fill="none"
              stroke="var(--accent-color)" stroke-width="2.5" stroke-opacity="0.8"
              stroke-linecap="round" stroke-linejoin="round"/>
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
            || this._climate?.attributes.friendly_name || "";
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

  // ── Render ────────────────────────────────────────────────────────────────

  _render() {
    if (!this._hass || !this._config) return;
    const root = this.shadowRoot;

    if (!this._initialized) {
      this._initialized = true;
      const style = document.createElement("style");
      style.textContent = CARD_CSS;
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
              : `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                   <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>
                 </svg>`
            }
            <span class="name">${this._name}</span>
            <div class="status-wrap">
              ${statusHeating ? `<ha-icon class="status-flame" icon="mdi:fire"></ha-icon>` : ""}
              <span class="status ${statusActive || statusHeating ? "status--on" : ""}">
                ${statusLabel}
              </span>
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
      if (this._opening) return;
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

  // ── Bottom-sheet overlay (self-contained, no external dependencies) ────────

  _openModal() {
    if (this._opening) return;
    this._opening = true;

    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed", inset: "0", zIndex: "9999",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    });

    const backdrop = document.createElement("div");
    Object.assign(backdrop.style, {
      position: "absolute", inset: "0", background: "rgba(0,0,0,0.45)",
    });

    const sheet = document.createElement("div");
    Object.assign(sheet.style, {
      position: "relative", width: "100%", maxWidth: "480px",
      background: "var(--ha-card-background, var(--card-background-color, white))",
      borderRadius: "24px 24px 0 0",
      padding: "20px 20px max(env(safe-area-inset-bottom, 16px), 16px)",
      boxSizing: "border-box",
      transform: "translateY(100%)",
      transition: "transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)",
    });

    const sheetTitle = document.createElement("div");
    Object.assign(sheetTitle.style, {
      fontSize: "17px", fontWeight: "600", textAlign: "center",
      marginBottom: "16px", color: "var(--primary-text-color)",
    });
    sheetTitle.textContent = this._name;
    sheet.appendChild(sheetTitle);

    const picker = document.createElement("hive-boost-picker");
    picker.setConfig({ entity: this._climateId });
    picker.hass = this._hass;
    sheet.appendChild(picker);
    this._overlayPicker = picker;

    overlay.appendChild(backdrop);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    // Slide in
    requestAnimationFrame(() => requestAnimationFrame(() => {
      sheet.style.transform = "translateY(0)";
    }));

    const close = () => {
      sheet.style.transform = "translateY(100%)";
      overlay.removeEventListener("hive-boost-close", close);
      setTimeout(() => {
        overlay.remove();
        this._overlayPicker = null;
        this._opening = false;
      }, 300);
    };

    backdrop.addEventListener("click", close);
    overlay.addEventListener("hive-boost-close", close);
  }
}

// ── HiveBoostPicker ───────────────────────────────────────────────────────
// Rendered inside the bottom-sheet overlay. Manages its own picker state
// and dispatches "hive-boost-close" when the user confirms or cancels.

class HiveBoostPicker extends HTMLElement {
  static getStubConfig() { return { entity: "climate.example" }; }

  constructor() {
    super();
    this._hass = null;
    this._config = null;
    this._temp = 22;
    this._hours = 1;
    this._mins = 0;
    this._rendered = false;
    this.attachShadow({ mode: "open" });
  }

  setConfig(config) {
    if (!config.entity) throw new Error("hive-boost-picker: 'entity' is required");
    this._config = config;
    if (this._hass && !this._rendered) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config && !this._rendered) this._render();
  }

  getCardSize() { return 4; }

  _formatTemp(t) {
    return (t % 1 === 0) ? `${t}°` : `${t.toFixed(1)}°`;
  }

  _render() {
    this._rendered = true;
    const root = this.shadowRoot;
    const tooShort = this._hours * 60 + this._mins < 15;

    root.innerHTML = `
      <style>${PICKER_CSS}</style>
      <div class="picker-wrap">

        <div class="temp-card">
          <button class="temp-adj" data-adj="-${TEMP_STEP}"
                  ${this._temp <= TEMP_MIN ? "disabled" : ""}>−</button>
          <span class="temp-display">${this._formatTemp(this._temp)}</span>
          <button class="temp-adj" data-adj="${TEMP_STEP}"
                  ${this._temp >= TEMP_MAX ? "disabled" : ""}>+</button>
        </div>

        <div class="dur-section">
          <div class="dur-label">Duration</div>
          <div class="dur-picker-wrap">
            <div class="dur-highlight"></div>
            <div class="dur-pickers">
              <div class="dur-scroll" id="hours-scroll">
                <div class="dur-spacer"></div>
                ${HOUR_OPTIONS.map(h => `<div class="dur-scroll-item">${h}h</div>`).join("")}
                <div class="dur-spacer"></div>
              </div>
              <div class="dur-scroll" id="mins-scroll">
                <div class="dur-spacer"></div>
                ${MINUTE_OPTIONS.map(m => `<div class="dur-scroll-item">${m}m</div>`).join("")}
                <div class="dur-spacer"></div>
              </div>
            </div>
          </div>
        </div>

        <button class="btn-start" id="start-btn" ${tooShort ? "disabled" : ""}>Start</button>
        <button class="btn-cancel" id="cancel-btn">Cancel</button>

      </div>
    `;

    this._bindEvents();
    this._initScroll();
  }

  _bindEvents() {
    const root = this.shadowRoot;
    const ITEM_H = 52;

    // Temperature — 0.5° steps, float-safe rounding
    root.querySelectorAll(".temp-adj").forEach(btn => {
      btn.addEventListener("click", () => {
        const adj = parseFloat(btn.dataset.adj);
        this._temp = Math.max(TEMP_MIN, Math.min(TEMP_MAX,
          Math.round((this._temp + adj) * 10) / 10
        ));
        root.querySelector(".temp-display").textContent = this._formatTemp(this._temp);
        root.querySelector(`[data-adj="-${TEMP_STEP}"]`).disabled = this._temp <= TEMP_MIN;
        root.querySelector(`[data-adj="${TEMP_STEP}"]`).disabled  = this._temp >= TEMP_MAX;
      });
    });

    // Drum-roll scroll pickers
    const setupScroll = (scrollEl, options, setVal) => {
      let timer;
      scrollEl.addEventListener("scroll", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const idx = Math.max(0, Math.min(options.length - 1,
            Math.round(scrollEl.scrollTop / ITEM_H)));
          setVal(options[idx]);
          scrollEl.scrollTo({ top: idx * ITEM_H, behavior: "smooth" });
          this._updateHighlights();
          const startBtn = root.querySelector("#start-btn");
          if (startBtn) startBtn.disabled = this._hours * 60 + this._mins < 15;
        }, 150);
      });
    };

    setupScroll(root.querySelector("#hours-scroll"), HOUR_OPTIONS, v => { this._hours = v; });
    setupScroll(root.querySelector("#mins-scroll"),  MINUTE_OPTIONS, v => { this._mins = v; });

    // Start boost
    root.querySelector("#start-btn")?.addEventListener("click", async () => {
      const mins = Math.max(15, this._hours * 60 + this._mins);
      try {
        await this._hass.callService(BOOST_DOMAIN, "start_boost", {
          entity_id: this._config.entity,
          temperature: this._temp,
          duration_minutes: mins,
        });
        this._closeOverlay();
      } catch (e) {
        console.error("[HiveBoostPicker] start_boost:", e);
      }
    });

    // Cancel
    root.querySelector("#cancel-btn")?.addEventListener("click", () => {
      this._closeOverlay();
    });
  }

  _initScroll() {
    const ITEM_H = 52;
    // Delay until the sheet's open animation finishes so the elements are
    // visible and scrollTop assignments take effect.
    setTimeout(() => {
      const root = this.shadowRoot;
      const h = root.querySelector("#hours-scroll");
      const m = root.querySelector("#mins-scroll");
      if (h) h.scrollTop = HOUR_OPTIONS.indexOf(this._hours) * ITEM_H;
      if (m) m.scrollTop = MINUTE_OPTIONS.indexOf(this._mins)  * ITEM_H;
      this._updateHighlights();
    }, 80);
  }

  _closeOverlay() {
    this.dispatchEvent(new CustomEvent("hive-boost-close", { bubbles: true }));
  }

  _updateHighlights() {
    const ITEM_H = 52;
    this.shadowRoot.querySelectorAll(".dur-scroll").forEach(scrollEl => {
      const idx = Math.round(scrollEl.scrollTop / ITEM_H);
      scrollEl.querySelectorAll(".dur-scroll-item").forEach((item, i) => {
        item.classList.toggle("selected", i === idx);
      });
    });
  }
}

// ── Card styles (shadow DOM — HiveBoostCard) ──────────────────────────────

const CARD_CSS = `
  ha-card { overflow: hidden; }

  .card-top { position: relative; overflow: hidden; }

  .graph-bg {
    position: absolute; bottom: 0; left: 0;
    width: 100%; height: 55%;
    pointer-events: none; z-index: 0;
  }

  .body {
    padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: var(--primary-text-color, #1A1A2E);
    position: relative; z-index: 1;
  }

  .row-top { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
  .icon { width: 18px; height: 18px; flex-shrink: 0; color: var(--secondary-text-color, #aaa); --mdi-icon-size: 18px; }
  .name { flex: 1; font-size: 15px; font-weight: 600; }
  .status-wrap { display: flex; align-items: center; gap: 3px; }
  .status-flame { --mdi-icon-size: 14px; color: var(--state-active-color, #FF6600); }
  .status { font-size: 13px; color: var(--secondary-text-color, #aaa); }
  .status--on { color: var(--state-active-color, #FF6600); font-weight: 600; }

  .row-main { display: flex; align-items: flex-end; justify-content: space-between; }
  .temp-block { display: flex; flex-direction: column; }
  .temp-val { font-size: 36px; font-weight: 300; line-height: 1; }
  .temp-lbl { font-size: 11px; color: var(--secondary-text-color, #aaa); margin-top: 3px; }

  .actions { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }

  .btn-boost {
    padding: 10px 22px;
    background: color-mix(in srgb, var(--primary-color) 15%, var(--card-background-color, white));
    border: none; border-radius: 50px; cursor: pointer;
    font-size: 14px; font-weight: 600; color: var(--primary-color);
    transition: background 0.2s;
  }
  .btn-boost:active { opacity: 0.8; }

  .pill-active {
    padding: 10px 22px;
    background: var(--state-active-color, #FF6600);
    border-radius: 50px; font-size: 14px; font-weight: 600; color: white;
  }
  .btn-stop {
    background: none; border: none; cursor: pointer;
    font-size: 12px; color: var(--secondary-text-color, #aaa);
    padding: 2px 6px; transition: color 0.15s;
  }
  .btn-stop:hover { color: var(--error-color, #FF3B30); }
`;

// ── Picker styles (shadow DOM — HiveBoostPicker) ──────────────────────────

const PICKER_CSS = `
  :host { display: block; }

  .picker-wrap {
    padding: 4px 0 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: var(--primary-text-color, #1A1A2E);
  }

  /* Temperature */
  .temp-card {
    display: flex; align-items: center; justify-content: space-between;
    background: color-mix(in srgb, var(--primary-color, #3D5AFE) 10%, var(--card-background-color, white));
    border-radius: 16px; padding: 20px; margin-bottom: 24px;
  }
  .temp-adj {
    width: 44px; height: 44px; border: none; background: transparent;
    font-size: 30px; font-weight: 300; cursor: pointer;
    color: var(--primary-text-color, #333);
    display: flex; align-items: center; justify-content: center;
    border-radius: 8px; transition: background 0.15s; line-height: 1;
  }
  .temp-adj:disabled { color: var(--disabled-color, #ccc); cursor: default; }
  .temp-adj:not(:disabled):active {
    background: color-mix(in srgb, var(--primary-color, #3D5AFE) 20%, transparent);
  }
  .temp-display {
    font-size: 38px; font-weight: 500;
    color: var(--primary-color, #3D5AFE);
    min-width: 90px; text-align: center;
  }

  /* Duration */
  .dur-section { margin-bottom: 20px; }
  .dur-label {
    text-align: center; font-size: 15px;
    color: var(--secondary-text-color, #888); margin-bottom: 8px;
  }

  .dur-picker-wrap {
    position: relative; height: 156px;
    overflow: hidden; border-radius: 12px;
  }
  .dur-picker-wrap::before,
  .dur-picker-wrap::after {
    content: ""; position: absolute; left: 0; right: 0;
    height: 60px; z-index: 2; pointer-events: none;
  }
  .dur-picker-wrap::before {
    top: 0;
    background: linear-gradient(to bottom,
      var(--ha-card-background, var(--card-background-color, white)) 20%, transparent 100%);
  }
  .dur-picker-wrap::after {
    bottom: 0;
    background: linear-gradient(to top,
      var(--ha-card-background, var(--card-background-color, white)) 20%, transparent 100%);
  }

  .dur-highlight {
    position: absolute; top: 50%; left: 0; right: 0; height: 52px;
    transform: translateY(-50%);
    background: color-mix(in srgb, var(--primary-color, #3D5AFE) 12%, var(--card-background-color, white));
    border-radius: 12px; pointer-events: none; z-index: 1;
  }
  .dur-pickers { display: flex; height: 100%; position: relative; z-index: 0; }
  .dur-scroll {
    flex: 1; overflow-y: scroll;
    scroll-snap-type: y mandatory; height: 100%;
    scrollbar-width: none; -ms-overflow-style: none;
  }
  .dur-scroll::-webkit-scrollbar { display: none; }
  .dur-spacer { height: 52px; flex-shrink: 0; }
  .dur-scroll-item {
    height: 52px; display: flex; align-items: center; justify-content: center;
    scroll-snap-align: center;
    font-size: 22px; font-weight: 400;
    color: var(--secondary-text-color, #bbb);
    user-select: none;
    transition: color 0.15s, font-weight 0.15s, font-size 0.15s;
  }
  .dur-scroll-item.selected {
    color: var(--primary-color, #3D5AFE);
    font-weight: 700; font-size: 24px;
  }

  /* Buttons */
  .btn-start {
    display: block; width: 100%; padding: 16px; box-sizing: border-box;
    background: var(--primary-color, #3D5AFE); color: white;
    border: none; border-radius: 12px;
    font-size: 16px; font-weight: 600; cursor: pointer;
    margin-bottom: 10px; transition: opacity 0.15s;
  }
  .btn-start:disabled { opacity: 0.4; cursor: default; }
  .btn-start:not(:disabled):active { opacity: 0.85; }

  .btn-cancel {
    display: block; width: 100%; padding: 16px; box-sizing: border-box;
    background: color-mix(in srgb, var(--primary-color, #3D5AFE) 8%, var(--card-background-color, white));
    color: var(--primary-color, #3D5AFE);
    border: none; border-radius: 12px;
    font-size: 16px; font-weight: 600; cursor: pointer;
    transition: opacity 0.15s;
  }
  .btn-cancel:active { opacity: 0.85; }
`;

if (!customElements.get("hive-boost-card")) {
  customElements.define("hive-boost-card", HiveBoostCard);
}
if (!customElements.get("hive-boost-picker")) {
  customElements.define("hive-boost-picker", HiveBoostPicker);
}
