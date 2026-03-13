# Hive Boost — HA Custom Integration

## What this is
A Home Assistant custom integration that adds per-room boost control for Hive TRVs.
HACS-installable. Targets HA 2024.1.0+.

## Dev workflow
1. Edit files in `custom_components/hive_boost/`
2. Reload the integration in HA:
   Settings → Devices & Services → Hive Boost → ⋮ → Reload
   Or via CLI: `ha core restart` (nuclear) vs service call (preferred):
   `hass --script check_config` then reload via HA websocket
3. Check logs: Settings → System → Logs → filter "hive_boost"

## Reload without restart (fastest)
Call this HA service to reload just this integration:
  Service: `homeassistant.reload_config_entry`
  Or use the HA CLI add-on: `ha services call homeassistant reload_config_entry`

## File map
- `__init__.py` — coordinator, service handlers, boost state machine
- `sensor.py`   — one sensor entity per Hive TRV (boost state, temp, time remaining)
- `config_flow.py` — UI setup wizard
- `const.py`    — all constants, tweak defaults here
- `services.yaml` — service schema shown in Developer Tools

## Testing a boost manually
Developer Tools → Services → hive_boost.start_boost
  entity_id: climate.lounge
  temperature: 22
  duration: 1h

## Entities created
sensor.lounge_boost, sensor.front_room_boost, sensor.main_bedroom_boost,
sensor.nursery_boost, sensor.second_bedroom_boost, sensor.thermostat_boost
