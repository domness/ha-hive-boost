/**
 * Hive Boost Panel — simulates the Hive app UI inside Home Assistant.
 *
 * Auto-discovers Hive TRV entities via the hive_boost sensor platform,
 * renders a per-room card list, and calls hive_boost.start_boost /
 * hive_boost.cancel_boost services via the HA WebSocket API.
 */

const BOOST_DOMAIN = "hive_boost";
const SENSOR_SUFFIX = "_boost";

// Duration picker options
const HOUR_OPTIONS = [0, 1, 2, 3];
const MINUTE_OPTIONS = [0, 15, 30, 45];

class HivePanel extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._boostModal = null; // sensor object when modal is open
    this._modalTemp = 22;
    this._modalHours = 1;
    this._modalMins = 0;
    this._rendered = false;
    this.attachShadow({ mode: "open" });
  }

  // ── HA panel lifecycle ──────────────────────────────────────────────────

  set hass(hass) {
    const prev = this._hass;
    this._hass = hass;

    // Don't re-render while modal is open — only update the hass reference
    // so service calls still work, but preserve user input state.
    if (this._boostModal) return;

    if (!prev || this._hasRelevantChange(prev, hass)) {
      this._render();
    }
  }

  // Required for use as a Lovelace dashboard card
  setConfig(_config) {}

  getCardSize() { return 6; }

  // Called by HA when panel config changes (e.g. narrow mode)
  set narrow(v) {
    this._narrow = v;
  }

  connectedCallback() {
    if (this._hass && !this._rendered) this._render();
  }

  // ── Entity discovery ────────────────────────────────────────────────────

  /** Return sensor objects for all hive_boost sensors. */
  _getSensors() {
    if (!this._hass) return [];
    return Object.entries(this._hass.states)
      .filter(([id, s]) =>
        id.startsWith("sensor.") &&
        id.endsWith(SENSOR_SUFFIX) &&
        s.attributes.climate_entity !== undefined
      )
      .map(([id, s]) => this._mapSensor(id, s))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  _mapSensor(sensorId, state) {
    const climateState = this._hass.states[state.attributes.climate_entity];
    return {
      sensorId,
      climateId: state.attributes.climate_entity,
      name: this._friendlyName(state, sensorId),
      boostActive: state.attributes.boost_active === true,
      currentTemp: state.attributes.current_temperature,
      boostTemp: state.attributes.boost_temperature,
      minutesRemaining: state.attributes.minutes_remaining,
      hvacMode: climateState ? climateState.state : state.attributes.hvac_mode,
    };
  }

  _friendlyName(state, entityId) {
    const fn = state.attributes.friendly_name || "";
    if (fn) return fn.replace(/\s*boost$/i, "").trim();
    return entityId
      .replace(/^sensor\./, "")
      .replace(/_boost$/, "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /** Build quick-action groups from HA areas when available. */
  _getAreaGroups(sensors) {
    const areas = this._hass.areas;
    const entities = this._hass.entities;
    const devices = this._hass.devices;
    if (!areas || !entities) return null;

    const groups = {};
    for (const sensor of sensors) {
      const reg = entities[sensor.climateId];
      if (!reg) continue;
      const areaId =
        reg.area_id ||
        (devices && devices[reg.device_id]?.area_id);
      if (!areaId || !areas[areaId]) continue;
      if (!groups[areaId]) {
        groups[areaId] = { name: areas[areaId].name, sensors: [] };
      }
      groups[areaId].sensors.push(sensor);
    }
    const result = Object.values(groups).filter((g) => g.sensors.length > 0);
    return result.length > 0 ? result : null;
  }

  // ── Change detection ────────────────────────────────────────────────────

  _hasRelevantChange(prev, next) {
    if (!prev) return true;
    for (const [id] of Object.entries(next.states)) {
      if (
        (id.endsWith(SENSOR_SUFFIX) && id.startsWith("sensor.")) ||
        id.startsWith("climate.")
      ) {
        if (prev.states[id] !== next.states[id]) return true;
      }
    }
    return false;
  }

  // ── Modal helpers ───────────────────────────────────────────────────────

  _openModal(sensor) {
    this._boostModal = sensor;
    this._modalTemp = sensor.boostActive && sensor.boostTemp
      ? Math.round(sensor.boostTemp)
      : 22;
    this._modalHours = 1;
    this._modalMins = 0;
    this._render();
  }

  _closeModal() {
    this._boostModal = null;
    this._render();
  }

  async _startBoost() {
    const totalMins = Math.max(15, this._modalHours * 60 + this._modalMins);
    try {
      await this._hass.callService(BOOST_DOMAIN, "start_boost", {
        entity_id: this._boostModal.climateId,
        temperature: this._modalTemp,
        duration_minutes: totalMins,
      });
    } catch (e) {
      console.error("[HivePanel] start_boost failed:", e);
    }
    this._closeModal();
  }

  async _cancelBoost(climateId) {
    try {
      await this._hass.callService(BOOST_DOMAIN, "cancel_boost", {
        entity_id: climateId,
      });
    } catch (e) {
      console.error("[HivePanel] cancel_boost failed:", e);
    }
  }

  async _boostGroup(sensors) {
    for (const s of sensors) {
      await this._hass.callService(BOOST_DOMAIN, "start_boost", {
        entity_id: s.climateId,
        temperature: 22,
        duration_minutes: 60,
      }).catch((e) => console.error("[HivePanel] group boost failed:", e));
    }
  }

  async _cancelAll(sensors) {
    for (const s of sensors.filter((s) => s.boostActive)) {
      await this._cancelBoost(s.climateId);
    }
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  _render() {
    const sensors = this._getSensors();
    this._rendered = true;
    this.shadowRoot.innerHTML = `
      <style>${CSS}</style>
      <div class="app">
        ${this._tplHeader()}
        <div class="content">
          ${this._tplQuickActions(sensors)}
          ${this._tplRoomList(sensors)}
        </div>
        ${this._tplBottomNav()}
        ${this._boostModal ? this._tplModal() : ""}
      </div>
    `;
    this._bindEvents(sensors);
  }

  // ── Templates ───────────────────────────────────────────────────────────

  _tplHeader() {
    const h = new Date().getHours();
    const greeting =
      h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
    return `
      <div class="header">
        <span class="greeting">${greeting}</span>
        <div class="header-right">
          <label class="toggle" title="Home / Away">
            <input type="checkbox" id="home-toggle" checked>
            <span class="slider"></span>
          </label>
        </div>
      </div>`;
  }

  _tplQuickActions(sensors) {
    const areaGroups = this._getAreaGroups(sensors);
    const anyBoosting = sensors.some((s) => s.boostActive);

    let buttons;
    if (areaGroups) {
      buttons = areaGroups
        .map(
          (g) => `
          <button class="quick-btn" data-action="boost-area" data-area='${JSON.stringify(g.sensors.map((s) => s.climateId))}'>
            <span class="quick-flame">🔥</span>
            <span>Heat ${g.name}</span>
          </button>`
        )
        .join("");
    } else {
      buttons = `
        <button class="quick-btn" data-action="boost-all">
          <span class="quick-flame">🔥</span>
          <span>Heat all rooms</span>
        </button>`;
    }

    if (anyBoosting) {
      buttons += `
        <button class="quick-btn quick-btn--cancel" data-action="cancel-all">
          <span class="quick-flame">❄️</span>
          <span>Cancel all</span>
        </button>`;
    }

    return `
      <div class="section">
        <div class="section-label">Quick Actions</div>
        <div class="quick-row">${buttons}</div>
      </div>`;
  }

  _tplRoomList(sensors) {
    if (sensors.length === 0) {
      return `
        <div class="empty">
          <div class="empty-icon">🌡️</div>
          <div class="empty-title">No Hive TRVs found</div>
          <div class="empty-sub">Make sure the Hive integration is configured and has climate entities.</div>
        </div>`;
    }
    return `<div class="room-list">${sensors.map((s) => this._tplCard(s)).join("")}</div>`;
  }

  _tplCard(s) {
    const temp =
      s.currentTemp != null
        ? `${parseFloat(s.currentTemp).toFixed(1)}°`
        : "—";
    let status, statusClass;
    if (s.boostActive) {
      status =
        s.minutesRemaining != null && s.minutesRemaining > 0
          ? `${s.minutesRemaining}m left`
          : "Boosting";
      statusClass = "status--on";
    } else {
      status = s.hvacMode === "off" || !s.hvacMode ? "Off" : s.hvacMode;
      statusClass = "";
    }

    return `
      <div class="card">
        <div class="card-top">
          <div class="room-icon">🌡️</div>
          <span class="room-name">${s.name}</span>
          <span class="room-status ${statusClass}">${status}</span>
        </div>
        <div class="card-bottom">
          <div class="temp-block">
            <span class="temp-val">${temp}</span>
            <span class="temp-lbl">Actual</span>
          </div>
          <button
            class="boost-btn ${s.boostActive ? "boost-btn--active" : ""}"
            data-sensor="${s.sensorId}"
          >
            <svg class="boost-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="9"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            ${s.boostActive ? "Boosting" : "Boost"}
          </button>
        </div>
      </div>`;
  }

  _tplBottomNav() {
    const items = [
      { icon: NAV_HOME, label: "Home", active: true },
      { icon: NAV_INSIGHTS, label: "Insights", active: false },
      { icon: NAV_DISCOVER, label: "Discover", active: false },
      { icon: NAV_MANAGE, label: "Manage", active: false },
    ];
    return `
      <nav class="bottom-nav">
        ${items.map((i) => `
          <button class="nav-btn ${i.active ? "nav-btn--active" : ""}">
            ${i.icon}
            <span>${i.label}</span>
          </button>`).join("")}
      </nav>`;
  }

  _tplModal() {
    const s = this._boostModal;
    const totalMins = this._modalHours * 60 + this._modalMins;
    const tooShort = totalMins < 15;

    return `
      <div class="overlay" id="modal-overlay">
        <div class="modal">
          <div class="modal-handle"></div>
          <div class="modal-title">Boost</div>
          <div class="modal-subtitle">${s.name}</div>

          <div class="temp-picker">
            <button class="temp-adj" data-adj="-1" ${this._modalTemp <= 5 ? "disabled" : ""}>−</button>
            <span class="modal-temp">${this._modalTemp}°</span>
            <button class="temp-adj" data-adj="1" ${this._modalTemp >= 32 ? "disabled" : ""}>+</button>
          </div>

          <div class="dur-label">Duration</div>
          <div class="dur-picker">
            <div class="dur-col">
              ${HOUR_OPTIONS.map((h) => `
                <div class="dur-item ${this._modalHours === h ? "dur-item--sel" : ""}"
                     data-dtype="hours" data-dval="${h}">${h}h</div>`).join("")}
            </div>
            <div class="dur-col">
              ${MINUTE_OPTIONS.map((m) => `
                <div class="dur-item ${this._modalMins === m ? "dur-item--sel" : ""}"
                     data-dtype="mins" data-dval="${m}">${m}m</div>`).join("")}
            </div>
          </div>
          ${tooShort ? '<div class="dur-warn">Minimum duration is 15 minutes</div>' : ""}

          <button class="btn-start" ${tooShort ? "disabled" : ""}>Start</button>
          ${s.boostActive
            ? `<button class="btn-stop">Stop Boost</button>`
            : `<button class="btn-cancel">Cancel</button>`}
        </div>
      </div>`;
  }

  // ── Event binding ───────────────────────────────────────────────────────

  _bindEvents(sensors) {
    const root = this.shadowRoot;
    const sensorMap = Object.fromEntries(sensors.map((s) => [s.sensorId, s]));

    // Room boost buttons
    root.querySelectorAll(".boost-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sensor = sensorMap[btn.dataset.sensor];
        if (!sensor) return;
        this._openModal(sensor);
      });
    });

    // Quick actions
    root.querySelectorAll(".quick-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.dataset.action;
        if (action === "boost-all") {
          await this._boostGroup(sensors);
        } else if (action === "cancel-all") {
          await this._cancelAll(sensors);
        } else if (action === "boost-area") {
          const ids = JSON.parse(btn.dataset.area);
          const targets = sensors.filter((s) => ids.includes(s.climateId));
          await this._boostGroup(targets);
        }
      });
    });

    // Modal events
    if (this._boostModal) {
      // Temp adjusters
      root.querySelectorAll(".temp-adj").forEach((btn) => {
        btn.addEventListener("click", () => {
          this._modalTemp = Math.max(5, Math.min(32, this._modalTemp + parseInt(btn.dataset.adj, 10)));
          this._render();
        });
      });

      // Duration items
      root.querySelectorAll(".dur-item").forEach((item) => {
        item.addEventListener("click", () => {
          const val = parseInt(item.dataset.dval, 10);
          if (item.dataset.dtype === "hours") {
            this._modalHours = val;
          } else {
            this._modalMins = val;
          }
          this._render();
        });
      });

      // Start
      const startBtn = root.querySelector(".btn-start");
      if (startBtn) startBtn.addEventListener("click", () => this._startBoost());

      // Stop boost
      const stopBtn = root.querySelector(".btn-stop");
      if (stopBtn) {
        stopBtn.addEventListener("click", async () => {
          await this._cancelBoost(this._boostModal.climateId);
          this._closeModal();
        });
      }

      // Cancel / close
      const cancelBtn = root.querySelector(".btn-cancel");
      if (cancelBtn) cancelBtn.addEventListener("click", () => this._closeModal());

      // Overlay tap to close
      const overlay = root.getElementById("modal-overlay");
      if (overlay) {
        overlay.addEventListener("click", (e) => {
          if (e.target === overlay) this._closeModal();
        });
      }
    }
  }
}

// ── SVG icons for bottom nav ──────────────────────────────────────────────

const NAV_HOME = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>`;
const NAV_INSIGHTS = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/></svg>`;
const NAV_DISCOVER = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;
const NAV_MANAGE = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>`;

// ── Styles ────────────────────────────────────────────────────────────────

const CSS = `
  :host { display: block; height: 100%; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .app {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--primary-background-color, #F0F1F6);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    max-width: 480px;
    margin: 0 auto;
    position: relative;
    overflow: hidden;
    color: var(--primary-text-color, #1A1A2E);
  }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 20px 14px;
    background: var(--primary-background-color, #F0F1F6);
    flex-shrink: 0;
  }
  .greeting { font-size: 22px; font-weight: 700; }
  .header-right { display: flex; align-items: center; gap: 10px; }

  .toggle { position: relative; display: inline-block; width: 46px; height: 26px; }
  .toggle input { opacity: 0; width: 0; height: 0; }
  .slider {
    position: absolute; inset: 0; background: var(--disabled-color, #ccc);
    border-radius: 26px; cursor: pointer; transition: .25s;
  }
  .slider::before {
    content: ""; position: absolute;
    width: 20px; height: 20px; left: 3px; bottom: 3px;
    background: var(--card-background-color, white); border-radius: 50%; transition: .25s;
  }
  input:checked + .slider { background: var(--primary-color); }
  input:checked + .slider::before { transform: translateX(20px); }

  /* ── Content ── */
  .content { flex: 1; overflow-y: auto; padding: 0 14px 90px; }

  /* ── Section / Quick Actions ── */
  .section { margin-bottom: 18px; }
  .section-label {
    font-size: 11px; font-weight: 700; color: var(--secondary-text-color, #888);
    text-transform: uppercase; letter-spacing: .8px; margin-bottom: 10px;
  }
  .quick-row { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 2px; }
  .quick-btn {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 12px 18px; background: var(--card-background-color, white); border: none;
    border-radius: 14px; cursor: pointer; font-size: 14px;
    font-weight: 600; white-space: nowrap; color: var(--primary-text-color, #1A1A2E);
    box-shadow: 0 1px 4px rgba(0,0,0,.07); flex-shrink: 0;
    transition: transform .1s, box-shadow .1s;
  }
  .quick-btn:active { transform: scale(.97); }
  .quick-btn--cancel { background: var(--secondary-background-color, #F0F1F6); color: var(--secondary-text-color, #888); }
  .quick-flame { font-size: 18px; }

  /* ── Room list ── */
  .room-list { display: flex; flex-direction: column; gap: 10px; }

  .card {
    background: var(--card-background-color, white); border-radius: 18px;
    padding: 16px 16px 14px; box-shadow: 0 1px 6px rgba(0,0,0,.06);
  }
  .card-top {
    display: flex; align-items: center; gap: 10px; margin-bottom: 14px;
  }
  .room-icon { font-size: 18px; flex-shrink: 0; }
  .room-name { flex: 1; font-size: 15px; font-weight: 600; }
  .room-status { font-size: 13px; color: var(--secondary-text-color, #AAA); }
  .room-status.status--on { color: var(--state-active-color, #FF6600); font-weight: 600; }

  .card-bottom {
    display: flex; align-items: flex-end; justify-content: space-between;
  }
  .temp-block { display: flex; flex-direction: column; }
  .temp-val { font-size: 34px; font-weight: 300; line-height: 1; color: var(--primary-text-color, #1A1A2E); }
  .temp-lbl { font-size: 11px; color: var(--secondary-text-color, #AAA); margin-top: 3px; }

  .boost-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 10px 18px; background: color-mix(in srgb, var(--primary-color) 15%, var(--card-background-color, white)); border: none;
    border-radius: 50px; cursor: pointer; font-size: 14px;
    font-weight: 600; color: var(--primary-color);
    transition: background .2s, color .2s, transform .1s;
  }
  .boost-btn:active { transform: scale(.96); }
  .boost-btn--active { background: var(--state-active-color, #FF6600); color: white; }
  .boost-icon { width: 16px; height: 16px; flex-shrink: 0; }

  /* ── Empty state ── */
  .empty {
    text-align: center; padding: 60px 20px; color: var(--secondary-text-color, #888);
  }
  .empty-icon { font-size: 48px; margin-bottom: 12px; }
  .empty-title { font-size: 16px; font-weight: 600; margin-bottom: 6px; color: var(--primary-text-color, #444); }
  .empty-sub { font-size: 13px; line-height: 1.5; }

  /* ── Bottom nav ── */
  .bottom-nav {
    position: absolute; bottom: 0; left: 0; right: 0;
    background: var(--card-background-color, white); display: flex;
    border-top: 1px solid var(--divider-color, #EBEBEB);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    z-index: 10;
  }
  .nav-btn {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; gap: 2px; padding: 8px 4px 6px;
    background: none; border: none; cursor: pointer;
    font-size: 10px; font-weight: 500; color: var(--secondary-text-color, #BBB);
    transition: color .15s;
  }
  .nav-btn svg { width: 22px; height: 22px; }
  .nav-btn--active { color: var(--primary-color); }

  /* ── Modal overlay ── */
  .overlay {
    position: absolute; inset: 0; background: rgba(0,0,0,.45);
    display: flex; align-items: flex-end; z-index: 50;
  }
  .modal {
    width: 100%; background: var(--card-background-color, white);
    border-radius: 24px 24px 0 0;
    padding: 10px 24px 40px;
    animation: slideUp .28s cubic-bezier(.32,.72,0,1);
  }
  @keyframes slideUp {
    from { transform: translateY(100%); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }
  .modal-handle {
    width: 36px; height: 4px; background: var(--divider-color, #DDD);
    border-radius: 2px; margin: 4px auto 16px;
  }
  .modal-title {
    text-align: center; font-size: 18px; font-weight: 700;
    color: var(--primary-text-color, #1A1A2E); margin-bottom: 4px;
  }
  .modal-subtitle {
    text-align: center; font-size: 13px; color: var(--secondary-text-color, #888); margin-bottom: 24px;
  }

  /* Temp picker */
  .temp-picker {
    display: flex; align-items: center; justify-content: center;
    gap: 28px; margin-bottom: 28px;
  }
  .temp-adj {
    width: 44px; height: 44px; border-radius: 50%; border: none;
    background: var(--secondary-background-color, #F0F1F6); font-size: 26px; line-height: 1;
    cursor: pointer; color: var(--primary-color); font-weight: 300;
    display: flex; align-items: center; justify-content: center;
    transition: background .15s;
  }
  .temp-adj:disabled { color: var(--disabled-color, #CCC); cursor: default; }
  .temp-adj:not(:disabled):active { background: color-mix(in srgb, var(--primary-color) 25%, var(--card-background-color, white)); }
  .modal-temp {
    font-size: 40px; font-weight: 300; color: var(--primary-color);
    min-width: 100px; text-align: center;
  }

  /* Duration picker */
  .dur-label {
    text-align: center; font-size: 12px; color: var(--secondary-text-color, #AAA);
    text-transform: uppercase; letter-spacing: .6px; margin-bottom: 12px;
  }
  .dur-picker { display: flex; justify-content: center; gap: 8px; margin-bottom: 8px; }
  .dur-col { display: flex; flex-direction: column; gap: 2px; }
  .dur-item {
    padding: 11px 32px; border-radius: 12px; font-size: 17px;
    text-align: center; cursor: pointer; color: var(--secondary-text-color, #BBB);
    transition: background .15s, color .15s;
  }
  .dur-item:hover { color: var(--primary-text-color, #888); }
  .dur-item--sel { background: color-mix(in srgb, var(--primary-color) 15%, var(--card-background-color, white)); color: var(--primary-color); font-weight: 700; }
  .dur-warn {
    text-align: center; font-size: 12px; color: var(--error-color, #F44336);
    margin-bottom: 8px;
  }

  /* Buttons */
  .btn-start {
    display: block; width: 100%; padding: 16px; margin-top: 16px;
    background: var(--primary-color); color: var(--text-primary-color, white); border: none; border-radius: 50px;
    font-size: 16px; font-weight: 700; cursor: pointer;
    transition: background .2s, transform .1s;
  }
  .btn-start:disabled { background: color-mix(in srgb, var(--primary-color) 50%, var(--card-background-color, white)); cursor: default; }
  .btn-start:not(:disabled):active { transform: scale(.98); }

  .btn-stop {
    display: block; width: 100%; padding: 14px; margin-top: 10px;
    background: transparent; color: var(--error-color, #FF3B30); border: none;
    font-size: 15px; font-weight: 600; cursor: pointer;
  }
  .btn-cancel {
    display: block; width: 100%; padding: 14px; margin-top: 10px;
    background: transparent; color: var(--primary-color); border: none;
    font-size: 15px; cursor: pointer;
  }
`;

customElements.define("hive-panel", HivePanel);
