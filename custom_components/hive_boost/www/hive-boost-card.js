/**
 * Hive Boost Card — individual per-room boost card for HA dashboards.
 *
 * Configuration:
 *   type: custom:hive-boost-card
 *   entity: climate.lounge    # climate.* or sensor.*_boost
 *   name: Lounge              # optional display name override
 */

const BOOST_DOMAIN = "hive_boost";
const HOUR_OPTIONS = [0, 1, 2, 3];
const MINUTE_OPTIONS = [0, 15, 30, 45];

class HiveBoostCard extends HTMLElement {
  static getStubConfig() {
    return { entity: "climate.example" };
  }

  constructor() {
    super();
    this._hass = null;
    this._config = null;
    this._climateId = null;
    this._sensorId = null;
    this._expanded = false;
    this._modalTemp = 22;
    this._modalHours = 1;
    this._modalMins = 0;
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
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return this._expanded ? 5 : 3;
  }

  // ── Data helpers ─────────────────────────────────────────────────────────

  get _sensor() { return this._hass?.states[this._sensorId]; }
  get _climate() { return this._hass?.states[this._climateId]; }
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
      return { label: m > 0 ? `${m}m left` : "Boosting", active: true };
    }
    const mode = this._climate?.state;
    return { label: mode === "off" || !mode ? "Off" : mode, active: false };
  }

  // ── Render ────────────────────────────────────────────────────────────────

  _render() {
    if (!this._hass || !this._config) return;

    const { label: statusLabel, active: statusActive } = this._statusText;
    const totalMins = this._modalHours * 60 + this._modalMins;
    const tooShort = totalMins < 15;

    this.shadowRoot.innerHTML = `
      <style>${CSS}</style>
      <ha-card>
        <div class="body">

          <div class="row-top">
            <span class="icon">🌡️</span>
            <span class="name">${this._name}</span>
            <span class="status ${statusActive ? "status--on" : ""}">${statusLabel}</span>
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
                <button class="btn-boost ${this._expanded ? "btn-boost--open" : ""}" id="toggle-btn">
                  ${this._expanded ? "✕ Close" : "Boost"}
                </button>
              `}
            </div>
          </div>

          ${this._expanded && !this._boostActive ? `
          <div class="expander">
            <div class="exp-row">
              <span class="exp-label">Temperature</span>
              <div class="temp-picker">
                <button class="temp-adj" data-adj="-1" ${this._modalTemp <= 5 ? "disabled" : ""}>−</button>
                <span class="temp-display">${this._modalTemp}°</span>
                <button class="temp-adj" data-adj="1" ${this._modalTemp >= 32 ? "disabled" : ""}>+</button>
              </div>
            </div>

            <span class="exp-label">Duration</span>
            <div class="dur-picker">
              <div class="dur-col">
                ${HOUR_OPTIONS.map(h => `
                  <span class="dur-item ${this._modalHours === h ? "dur-item--sel" : ""}"
                        data-dtype="hours" data-dval="${h}">${h}h</span>
                `).join("")}
              </div>
              <div class="dur-sep">:</div>
              <div class="dur-col">
                ${MINUTE_OPTIONS.map(m => `
                  <span class="dur-item ${this._modalMins === m ? "dur-item--sel" : ""}"
                        data-dtype="mins" data-dval="${m}">${m}m</span>
                `).join("")}
              </div>
            </div>

            ${tooShort ? '<p class="dur-warn">Minimum 15 minutes</p>' : ""}
            <button class="btn-start" id="start-btn" ${tooShort ? "disabled" : ""}>
              Start Boost
            </button>
          </div>
          ` : ""}

        </div>
      </ha-card>
    `;

    this._bindEvents();
  }

  _bindEvents() {
    const root = this.shadowRoot;

    root.getElementById("toggle-btn")?.addEventListener("click", () => {
      this._expanded = !this._expanded;
      if (!this._expanded) this._resetModal();
      this._render();
    });

    root.getElementById("stop-btn")?.addEventListener("click", async () => {
      try {
        await this._hass.callService(BOOST_DOMAIN, "cancel_boost", {
          entity_id: this._climateId,
        });
      } catch (e) {
        console.error("[HiveBoostCard] cancel_boost:", e);
      }
    });

    root.querySelectorAll(".temp-adj").forEach(btn => {
      btn.addEventListener("click", () => {
        this._modalTemp = Math.max(5, Math.min(32, this._modalTemp + +btn.dataset.adj));
        this._render();
      });
    });

    root.querySelectorAll(".dur-item").forEach(item => {
      item.addEventListener("click", () => {
        if (item.dataset.dtype === "hours") this._modalHours = +item.dataset.dval;
        else this._modalMins = +item.dataset.dval;
        this._render();
      });
    });

    root.getElementById("start-btn")?.addEventListener("click", async () => {
      const mins = Math.max(15, this._modalHours * 60 + this._modalMins);
      try {
        await this._hass.callService(BOOST_DOMAIN, "start_boost", {
          entity_id: this._climateId,
          temperature: this._modalTemp,
          duration_minutes: mins,
        });
        this._expanded = false;
        this._resetModal();
      } catch (e) {
        console.error("[HiveBoostCard] start_boost:", e);
      }
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

  .body {
    padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: var(--primary-text-color, #1A1A2E);
  }

  /* Top row */
  .row-top {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
  }
  .icon { font-size: 18px; flex-shrink: 0; }
  .name { flex: 1; font-size: 15px; font-weight: 600; }
  .status { font-size: 13px; color: var(--secondary-text-color, #aaa); }
  .status--on { color: #FF6600; font-weight: 600; }

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
    background: #ECEEFF;
    border: none;
    border-radius: 50px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    color: #3D5AFE;
    transition: background 0.2s;
  }
  .btn-boost--open {
    background: var(--secondary-background-color, #f0f0f0);
    color: var(--secondary-text-color, #888);
  }
  .btn-boost:active { opacity: 0.8; }

  /* Active boosting pill */
  .pill-active {
    padding: 10px 22px;
    background: #FF6600;
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
  .btn-stop:hover { color: #FF3B30; }

  /* Expander */
  .expander {
    margin-top: 18px;
    padding-top: 16px;
    border-top: 1px solid var(--divider-color, #eee);
  }
  .exp-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  .exp-label {
    display: block;
    font-size: 11px;
    font-weight: 700;
    color: var(--secondary-text-color, #aaa);
    text-transform: uppercase;
    letter-spacing: 0.6px;
    margin-bottom: 10px;
  }
  .exp-row .exp-label { margin-bottom: 0; }

  /* Temperature picker */
  .temp-picker { display: flex; align-items: center; gap: 16px; }
  .temp-adj {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: none;
    background: var(--secondary-background-color, #F0F1F6);
    font-size: 22px;
    cursor: pointer;
    color: #3D5AFE;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
  }
  .temp-adj:disabled { color: #ccc; cursor: default; }
  .temp-adj:not(:disabled):active { background: #DDDFF8; }
  .temp-display {
    font-size: 28px;
    font-weight: 300;
    color: #3D5AFE;
    min-width: 64px;
    text-align: center;
  }

  /* Duration picker */
  .dur-picker {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 8px;
  }
  .dur-col { display: flex; gap: 4px; }
  .dur-sep { font-size: 18px; color: var(--secondary-text-color, #aaa); padding: 0 4px; }
  .dur-item {
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 14px;
    cursor: pointer;
    color: var(--secondary-text-color, #bbb);
    transition: background 0.15s, color 0.15s;
    user-select: none;
  }
  .dur-item:hover { color: var(--primary-text-color, #444); }
  .dur-item--sel { background: #ECEEFF; color: #3D5AFE; font-weight: 700; }
  .dur-warn { font-size: 12px; color: #F44336; margin: 0 0 8px; }

  /* Start button */
  .btn-start {
    display: block;
    width: 100%;
    padding: 14px;
    margin-top: 12px;
    background: #3D5AFE;
    color: white;
    border: none;
    border-radius: 50px;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.2s, transform 0.1s;
  }
  .btn-start:disabled { background: #B0B7FF; cursor: default; }
  .btn-start:not(:disabled):active { transform: scale(0.98); }
`;

customElements.define("hive-boost-card", HiveBoostCard);
