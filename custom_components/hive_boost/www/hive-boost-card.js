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

class HiveBoostCard extends HTMLElement {
  static getStubConfig() {
    return { entity: "climate.example" };
  }

  // Default grid placement: half-width (6 of 12 columns), 3 rows tall.
  // Users can override per-card via grid_options in their dashboard YAML.
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
    // Reset graph when config changes
    this._graphData = null;
    this._lastHistoryFetch = 0;
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config?.show_graph) {
      const now = Date.now();
      if (now - this._lastHistoryFetch > HISTORY_REFRESH_MS) {
        this._lastHistoryFetch = now; // set early to prevent concurrent fetches
        this._fetchHistory();         // async, intentionally not awaited
      }
    }
    // If boost became active externally while the modal was open, close it
    if (this._boostActive && this._modalOpen) {
      this._modalOpen = false;
      const dialog = this.shadowRoot.getElementById("boost-modal");
      if (dialog) dialog.open = false;
    }

    // Skip re-rendering while the modal is open.
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

    // Smooth cubic bezier through all points
    let linePath = `M ${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const cx = (x0 + x1) / 2;
      linePath += ` C ${cx},${y0} ${cx},${y1} ${x1},${y1}`;
    }
    const fillPath = `${linePath} L ${W},${H} L 0,${H} Z`;

    // Unique gradient ID per entity so multiple cards don't clash
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

  // ── Render ────────────────────────────────────────────────────────────────

  _render() {
    if (!this._hass || !this._config) return;

    const root = this.shadowRoot;

    // One-time setup: create the persistent DOM skeleton.
    // ha-dialog lives here permanently — tearing it down on every hass update
    // causes it to fire 'closed' asynchronously, which races with the next
    // open call and produces the open→close flicker.
    if (!this._initialized) {
      this._initialized = true;

      const style = document.createElement("style");
      style.textContent = CSS;
      root.appendChild(style);

      const card = document.createElement("ha-card");
      card.id = "hbc-card";
      root.appendChild(card);

      const dialog = document.createElement("ha-dialog");
      dialog.id = "boost-modal";
      dialog.setAttribute("hideActions", "");
      root.appendChild(dialog);

      // Wire the closed listener exactly once.
      dialog.addEventListener("closed", () => {
        // mwc-dialog fires 'closed' but does NOT reset its own `open`
        // property — that's left to the caller. Explicitly reset it so
        // the next open attempt sees the correct state.
        dialog.open = false;
        this._modalOpen = false;
        this._resetModal();
      });
    }

    // Keep heading in sync (entity name may change on config reload)
    root.getElementById("boost-modal").heading = this._name;

    // Redraw only the card body on every hass update
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
      if (this._modalOpen) return; // guard: ignore duplicate/rapid taps
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

  // ── Modal ─────────────────────────────────────────────────────────────────

  _openModal() {
    const dialog = this.shadowRoot.getElementById("boost-modal");
    if (!dialog) return;

    const tooShort = this._modalHours * 60 + this._modalMins < 15;

    // Populate picker content fresh each open
    dialog.innerHTML = `
      <div class="modal-content">

        <div class="temp-card">
          <button class="temp-adj" data-adj="-1" ${this._modalTemp <= 5 ? "disabled" : ""}>−</button>
          <span class="temp-display">${this._modalTemp}°</span>
          <button class="temp-adj" data-adj="1" ${this._modalTemp >= 32 ? "disabled" : ""}>+</button>
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

        <button class="btn-start-full" id="start-btn" ${tooShort ? "disabled" : ""}>Start</button>
        <button class="btn-cancel-full" id="cancel-btn">Cancel</button>

      </div>
    `;

    this._bindModalEvents();
    this._modalOpen = true;

    // Defer open so the triggering click event finishes propagating before
    // mwc-dialog attaches its document-level outside-click listener —
    // otherwise that same click is treated as a scrim dismiss.
    setTimeout(() => {
      const d = this.shadowRoot.getElementById("boost-modal");
      if (d && !d.open) d.open = true;
      // Set scroll positions after the dialog is open and the browser has
      // performed layout — setting scrollTop on hidden elements is a no-op.
      const ITEM_H = 52;
      requestAnimationFrame(() => {
        const hoursScroll = d?.querySelector("#hours-scroll");
        const minsScroll  = d?.querySelector("#mins-scroll");
        if (hoursScroll) hoursScroll.scrollTop = HOUR_OPTIONS.indexOf(this._modalHours) * ITEM_H;
        if (minsScroll)  minsScroll.scrollTop  = MINUTE_OPTIONS.indexOf(this._modalMins) * ITEM_H;
      });
    }, 0);
  }

  _bindModalEvents() {
    const dialog = this.shadowRoot.getElementById("boost-modal");
    const ITEM_H = 52;

    // Temperature adjustment
    dialog.querySelectorAll(".temp-adj").forEach(btn => {
      btn.addEventListener("click", () => {
        this._modalTemp = Math.max(5, Math.min(32, this._modalTemp + +btn.dataset.adj));
        dialog.querySelector(".temp-display").textContent = `${this._modalTemp}°`;
        dialog.querySelector('[data-adj="-1"]').disabled = this._modalTemp <= 5;
        dialog.querySelector('[data-adj="1"]').disabled = this._modalTemp >= 32;
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
          const startBtn = dialog.querySelector("#start-btn");
          if (startBtn) startBtn.disabled = this._modalHours * 60 + this._modalMins < 15;
        }, 150);
      });
    };

    setupScrollPicker(
      dialog.querySelector("#hours-scroll"),
      HOUR_OPTIONS,
      v => { this._modalHours = v; }
    );
    setupScrollPicker(
      dialog.querySelector("#mins-scroll"),
      MINUTE_OPTIONS,
      v => { this._modalMins = v; }
    );

    // Start boost
    dialog.querySelector("#start-btn")?.addEventListener("click", async () => {
      const mins = Math.max(15, this._modalHours * 60 + this._modalMins);
      try {
        await this._hass.callService(BOOST_DOMAIN, "start_boost", {
          entity_id: this._climateId,
          temperature: this._modalTemp,
          duration_minutes: mins,
        });
        const d = this.shadowRoot.getElementById("boost-modal");
        if (d) d.open = false;
      } catch (e) {
        console.error("[HiveBoostCard] start_boost:", e);
      }
    });

    // Cancel
    dialog.querySelector("#cancel-btn")?.addEventListener("click", () => {
      const d = this.shadowRoot.getElementById("boost-modal");
      if (d) d.open = false;
    });
  }

  _resetModal() {
    this._modalTemp = 22;
    this._modalHours = 1;
    this._modalMins = 0;
  }
}

// ── Styles ────────────────────────────────────────────────────────────────

const CSS = `
  ha-card { overflow: hidden; }

  /* Top section — graph is clipped to this region */
  .card-top {
    position: relative;
    overflow: hidden;
  }

  /* Background graph */
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

  /* Top row */
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

  /* Main row */
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

  /* Boost button */
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

  /* Active boosting pill */
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

  /* ── ha-dialog content ────────────────────────────────────────────────── */

  /* ha-dialog handles its own width, backdrop, and animation.
     We tune the dialog width via MDC custom properties. */
  ha-dialog {
    --mdc-dialog-min-width: min(92vw, 380px);
    --mdc-dialog-max-width: min(92vw, 380px);
  }

  .modal-content {
    padding: 4px 0 8px;
  }

  /* Temperature card — full-width pill */
  .temp-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: color-mix(in srgb, var(--primary-color, #3D5AFE) 10%, var(--card-background-color, white));
    border-radius: 16px;
    padding: 20px 20px;
    margin-bottom: 24px;
  }
  .temp-adj {
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
  .temp-adj:disabled { color: var(--disabled-color, #ccc); cursor: default; }
  .temp-adj:not(:disabled):active { background: color-mix(in srgb, var(--primary-color, #3D5AFE) 20%, transparent); }
  .temp-display {
    font-size: 38px;
    font-weight: 500;
    color: var(--primary-color, #3D5AFE);
    min-width: 80px;
    text-align: center;
  }

  /* Duration section */
  .dur-section { margin-bottom: 20px; }
  .dur-label {
    text-align: center;
    font-size: 15px;
    color: var(--secondary-text-color, #888);
    margin-bottom: 8px;
  }

  /* Drum-roll picker */
  .dur-picker-wrap {
    position: relative;
    height: 156px;
    overflow: hidden;
    border-radius: 12px;
  }
  /* Gradient fade for items above/below the selected row */
  .dur-picker-wrap::before,
  .dur-picker-wrap::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 60px;
    z-index: 2;
    pointer-events: none;
  }
  .dur-picker-wrap::before {
    top: 0;
    background: linear-gradient(to bottom, var(--card-background-color, white) 20%, transparent 100%);
  }
  .dur-picker-wrap::after {
    bottom: 0;
    background: linear-gradient(to top, var(--card-background-color, white) 20%, transparent 100%);
  }
  /* Highlight bar for the selected row */
  .dur-highlight {
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 52px;
    transform: translateY(-50%);
    background: color-mix(in srgb, var(--primary-color, #3D5AFE) 10%, var(--card-background-color, white));
    border-radius: 12px;
    pointer-events: none;
    z-index: 1;
  }
  .dur-pickers {
    display: flex;
    height: 100%;
    position: relative;
    z-index: 0;
  }
  .dur-scroll {
    flex: 1;
    overflow-y: scroll;
    scroll-snap-type: y mandatory;
    height: 100%;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .dur-scroll::-webkit-scrollbar { display: none; }
  .dur-spacer { height: 52px; flex-shrink: 0; }
  .dur-scroll-item {
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    scroll-snap-align: center;
    font-size: 22px;
    font-weight: 500;
    color: var(--secondary-text-color, #bbb);
    user-select: none;
  }

  /* Action buttons */
  .btn-start-full {
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
  }
  .btn-start-full:disabled { opacity: 0.4; cursor: default; }
  .btn-start-full:not(:disabled):active { opacity: 0.85; }
  .btn-cancel-full {
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
  }
  .btn-cancel-full:active { opacity: 0.85; }
`;

if (!customElements.get("hive-boost-card")) {
  customElements.define("hive-boost-card", HiveBoostCard);
}
