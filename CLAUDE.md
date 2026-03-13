# Hive Boost — HA Custom Integration

## What this is
A Home Assistant custom integration that adds per-room boost control for Hive TRVs.
HACS-installable. Targets HA 2026.3.1+.

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
  entity_id: climate.<your_room>
  temperature: 22
  duration_minutes: 60

## Entities created
One `sensor.<room>_boost` entity per Hive TRV discovered in the entity registry.
These are generated automatically — no hardcoded list.

## Commits should
- Be descriptive and concise
- Include a summary of changes
- Reference any relevant issues or pull requests
- Follow the conventional commit format
