# Developer Notes — Hive Boost

## Architecture

The integration has three main layers:

**Coordinator (`__init__.py`)**
Central state machine. Discovers Hive climate entities via the entity registry, manages boost state in memory, persists to `.storage/hive_boost` via HA's `Store`, and schedules auto-revert timers via `async_track_point_in_time`.

**Sensor platform (`sensor.py`)**
One `HiveBoostSensor` per Hive TRV. Reads from the coordinator and exposes boost state, temperature, and time remaining as entity attributes. Registered via `async_forward_entry_setups`.

**Frontend (`panel.py` + `www/`)**
Serves the `www/` directory as static files under `/hive_boost_files/` and registers `hive-boost-card.js` as a Lovelace module resource via `add_extra_js_url`. The card (`HiveBoostCard`) is a shadow DOM custom element that calls `hive_boost.start_boost` / `hive_boost.cancel_boost` via the HA WebSocket API.

## File map

```
custom_components/hive_boost/
├── __init__.py       — coordinator, service handlers, boost state machine
├── sensor.py         — one sensor entity per Hive TRV
├── config_flow.py    — UI setup wizard
├── panel.py          — static file serving + Lovelace resource registration
├── const.py          — all constants; tweak defaults here
├── services.yaml     — service schema for Developer Tools
├── strings.json      — UI strings
├── manifest.json     — integration metadata
└── www/
    ├── hive-boost-card.js  — configurable per-room Lovelace card
    └── hive-panel.js       — legacy full-page panel (kept for reference)
```

## Dev workflow

1. Edit files in `custom_components/hive_boost/`
2. Reload the integration — no full HA restart needed for Python changes:
   **Settings → Devices & Services → Hive Boost → ⋮ → Reload**
3. For JS changes: reload the integration, then hard-refresh the browser (Cmd+Shift+R)
4. Check logs: **Settings → System → Logs**, filter for `hive_boost`

## Panel / frontend registration

`panel.py` is called once on first load (guarded by `hass.data[f"{DOMAIN}_panel"]`) to avoid double-registration on config entry reloads. It:

1. Registers `www/` as a static path via `hass.http.async_register_static_paths`
2. Calls `add_extra_js_url` to inject the card script into the HA frontend HTML

`add_extra_js_url` takes effect on the next full page load — hence the hard-refresh requirement after first install.

## Testing a boost manually

**Developer Tools → Services → `hive_boost.start_boost`**

```yaml
entity_id: climate.<your_room>
temperature: 22
duration_minutes: 60
```

Or call `hive_boost.cancel_boost` with just `entity_id` to stop it.

## Boost state lifecycle

```
start_boost called
  → set climate temperature via homeassistant.set_temperature
  → store boost state in memory + persist to .storage
  → schedule revert timer at ends_at

Timer fires / cancel_boost called
  → set climate hvac_mode to "auto"
  → remove boost state from memory + persist
  → fire hive_boost_boost_ended / hive_boost_boost_cancelled event
```

State is restored on HA restart: unexpired boosts are re-loaded from storage and their revert timers are rescheduled.

## Entities created

One `sensor.<room>_boost` entity is created automatically for each `platform: hive` climate entity found in the HA entity registry. The list is dynamic — adding or removing TRVs from the Hive integration will be reflected without any manual changes here.

## Conventional commits

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add per-room boost card
fix: handle missing climate entity gracefully
chore: bump manifest version
```
