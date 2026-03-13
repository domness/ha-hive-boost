# Hive Boost — Home Assistant Custom Integration

Adds proper per-room boost control for Hive TRVs in Home Assistant, with a Hive-style
tap-to-boost UI. No manual YAML helpers needed — everything is registered automatically.

## Features

- Auto-discovers all Hive climate entities
- Registers `hive_boost.start_boost` and `hive_boost.cancel_boost` services
- Creates `sensor.<room>_boost` entities per TRV with boost state, temp, and time remaining
- Persists boost state across HA restarts
- Picks up newly paired TRVs every 5 minutes without a restart
- Lovelace dashboard: tap a room card → popup with temp slider + duration picker → Boost!

## Installation

### 1. Copy the integration

```
config/
└── custom_components/
    └── hive_boost/
        ├── __init__.py
        ├── config_flow.py
        ├── const.py
        ├── manifest.json
        ├── sensor.py
        ├── services.yaml
        └── strings.json
```

Copy the `hive_boost/` folder (minus `lovelace_dashboard.yaml`) into your
`config/custom_components/` directory.

### 2. Add the helpers

These `input_number` and `input_select` helpers are still needed (once only) because
they power the temperature slider and duration picker in the UI. Add them via
**Settings → Devices & Services → Helpers → + Create Helper**, or paste into
`configuration.yaml`:

```yaml
input_number:
  lounge_boost_temp:
    name: Lounge Boost Temperature
    min: 16
    max: 30
    step: 0.5
    unit_of_measurement: °C
  front_room_boost_temp:
    name: Front Room Boost Temperature
    min: 16
    max: 30
    step: 0.5
    unit_of_measurement: °C
  main_bedroom_boost_temp:
    name: Main Bedroom Boost Temperature
    min: 16
    max: 30
    step: 0.5
    unit_of_measurement: °C
  nursery_boost_temp:
    name: Nursery Boost Temperature
    min: 16
    max: 30
    step: 0.5
    unit_of_measurement: °C
  second_bedroom_boost_temp:
    name: Second Bedroom Boost Temperature
    min: 16
    max: 30
    step: 0.5
    unit_of_measurement: °C
  thermostat_boost_temp:
    name: Thermostat Boost Temperature
    min: 16
    max: 30
    step: 0.5
    unit_of_measurement: °C

input_select:
  lounge_boost_duration:
    name: Lounge Boost Duration
    options: ["30m", "1h", "2h", "3h"]
    initial: "1h"
  front_room_boost_duration:
    name: Front Room Boost Duration
    options: ["30m", "1h", "2h", "3h"]
    initial: "1h"
  main_bedroom_boost_duration:
    name: Main Bedroom Boost Duration
    options: ["30m", "1h", "2h", "3h"]
    initial: "1h"
  nursery_boost_duration:
    name: Nursery Boost Duration
    options: ["30m", "1h", "2h", "3h"]
    initial: "1h"
  second_bedroom_boost_duration:
    name: Second Bedroom Boost Duration
    options: ["30m", "1h", "2h", "3h"]
    initial: "1h"
  thermostat_boost_duration:
    name: Thermostat Boost Duration
    options: ["30m", "1h", "2h", "3h"]
    initial: "1h"
```

> **Note:** A future version will auto-create these helpers programmatically via the
> `input_number` and `input_select` platform APIs, eliminating this step entirely.

### 3. Restart Home Assistant

After copying the files and adding helpers, do a full restart.

### 4. Add the integration

Go to **Settings → Devices & Services → + Add Integration** and search for **Hive Boost**.
Configure your preferred temperature defaults and click Submit.

### 5. Add the dashboard

Go to **Settings → Dashboards → + Add Dashboard**, give it a name like "Heating",
and switch it to YAML mode. Paste the contents of `lovelace_dashboard.yaml`.

## Services

### `hive_boost.start_boost`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `entity_id` | entity | ✅ | — | The Hive climate entity (e.g. `climate.lounge`) |
| `temperature` | float | ✅ | 22.0 | Target temperature in °C (5–32) |
| `duration` | string | ✅ | `1h` | One of: `30m`, `1h`, `2h`, `3h` |

### `hive_boost.cancel_boost`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `entity_id` | entity | ✅ | The Hive climate entity to cancel boost on |

## Sensors

One `sensor.<room>_boost` entity is created per discovered Hive TRV.

**State:** `boosting` or `idle`

**Attributes:**
- `boost_active` — boolean
- `boost_temperature` — float °C
- `boost_duration` — string (e.g. `2h`)
- `boost_ends_at` — ISO timestamp
- `minutes_remaining` — integer
- `current_temperature` — mirrored from climate entity
- `target_temperature` — mirrored from climate entity
- `hvac_mode` — mirrored from climate entity

## Events fired

| Event | Payload |
|-------|---------|
| `hive_boost_boost_started` | `entity_id`, `temperature`, `duration` |
| `hive_boost_boost_ended` | `entity_id` |
| `hive_boost_boost_cancelled` | `entity_id` |

Use these in your own automations (e.g. notify when Nursery boost ends).
