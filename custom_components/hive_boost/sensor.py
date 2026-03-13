"""Sensor platform for Hive Boost — one sensor per Hive TRV."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from homeassistant.components.sensor import SensorEntity, SensorDeviceClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_state_change_event, async_track_time_interval
from homeassistant.util import dt as dt_util
from datetime import timedelta

from .const import (
    ATTR_BOOST_ACTIVE,
    ATTR_BOOST_DURATION,
    ATTR_BOOST_ENDS_AT,
    ATTR_BOOST_TEMP,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)

# Friendly names for known Hive climate entity IDs
ENTITY_FRIENDLY_NAMES: dict[str, str] = {}


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Hive Boost sensors."""
    from . import HiveBoostCoordinator

    coordinator: HiveBoostCoordinator = hass.data[DOMAIN][entry.entry_id]

    # Discover all Hive climate entities
    climate_entities = coordinator.get_hive_climate_entities()

    if not climate_entities:
        _LOGGER.warning(
            "Hive Boost: No Hive climate entities found. "
            "Make sure the Hive integration is set up and has climate entities."
        )

    sensors = [
        HiveBoostSensor(hass, coordinator, entity_id)
        for entity_id in climate_entities
    ]

    async_add_entities(sensors, update_before_add=True)

    # Also listen for new climate entities being added (e.g. new TRV paired)
    @callback
    def _check_for_new_entities(_now):
        current_ids = {s._climate_entity_id for s in sensors}
        discovered = set(coordinator.get_hive_climate_entities())
        new_ids = discovered - current_ids
        if new_ids:
            _LOGGER.info("Hive Boost: discovered new TRVs: %s", new_ids)
            new_sensors = [
                HiveBoostSensor(hass, coordinator, eid) for eid in new_ids
            ]
            async_add_entities(new_sensors, update_before_add=True)
            sensors.extend(new_sensors)

    async_track_time_interval(hass, _check_for_new_entities, timedelta(minutes=5))


class HiveBoostSensor(SensorEntity):
    """Sensor representing the boost state of a single Hive TRV."""

    _attr_has_entity_name = True
    _attr_icon = "mdi:radiator"

    def __init__(
        self,
        hass: HomeAssistant,
        coordinator: Any,
        climate_entity_id: str,
    ) -> None:
        self.hass = hass
        self._coordinator = coordinator
        self._climate_entity_id = climate_entity_id

        # Derive a slug from the entity id, e.g. climate.lounge -> lounge
        slug = climate_entity_id.split(".")[-1]
        self._attr_unique_id = f"{DOMAIN}_{slug}_boost"
        self._attr_name = f"{slug.replace('_', ' ').title()} Boost"

        self._boost_state: dict[str, Any] = {}
        self._climate_state: Any = None

    # ── Lifecycle ──────────────────────────────────────────────────────────

    async def async_added_to_hass(self) -> None:
        """Subscribe to state changes and periodic refresh."""
        # Refresh when the underlying climate entity changes
        self.async_on_remove(
            async_track_state_change_event(
                self.hass,
                [self._climate_entity_id],
                self._handle_climate_state_change,
            )
        )

        # Refresh every 30s so time-remaining counts down
        self.async_on_remove(
            async_track_time_interval(
                self.hass,
                self._handle_tick,
                timedelta(seconds=30),
            )
        )

        # Also listen for boost start/end/cancel events
        for event_name in (
            f"{DOMAIN}_boost_started",
            f"{DOMAIN}_boost_ended",
            f"{DOMAIN}_boost_cancelled",
        ):
            self.async_on_remove(
                self.hass.bus.async_listen(event_name, self._handle_boost_event)
            )

    @callback
    def _handle_climate_state_change(self, event) -> None:
        self._refresh()

    @callback
    def _handle_tick(self, _now) -> None:
        self._refresh()

    @callback
    def _handle_boost_event(self, event) -> None:
        if event.data.get("entity_id") == self._climate_entity_id:
            self._refresh()

    @callback
    def _refresh(self) -> None:
        self._boost_state = self._coordinator.get_boost_state(self._climate_entity_id)
        self._climate_state = self.hass.states.get(self._climate_entity_id)
        self.async_write_ha_state()

    # ── Properties ────────────────────────────────────────────────────────

    @property
    def native_value(self) -> str:
        """Return 'boosting' or 'idle'."""
        return "boosting" if self._boost_state.get(ATTR_BOOST_ACTIVE) else "idle"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Expose all boost details as attributes."""
        attrs: dict[str, Any] = {
            "climate_entity": self._climate_entity_id,
            "boost_active": self._boost_state.get(ATTR_BOOST_ACTIVE, False),
            "boost_temperature": self._boost_state.get(ATTR_BOOST_TEMP),
            "boost_duration": self._boost_state.get(ATTR_BOOST_DURATION),
            "boost_ends_at": self._boost_state.get(ATTR_BOOST_ENDS_AT),
            "minutes_remaining": self._minutes_remaining(),
        }

        # Mirror useful climate attributes
        if self._climate_state:
            climate_attrs = self._climate_state.attributes
            attrs["current_temperature"] = climate_attrs.get("current_temperature")
            attrs["target_temperature"] = climate_attrs.get("temperature")
            attrs["hvac_mode"] = self._climate_state.state

        return attrs

    @property
    def device_info(self) -> DeviceInfo:
        """Group all boost sensors under one device."""
        return DeviceInfo(
            identifiers={(DOMAIN, "hive_boost_controller")},
            name="Hive Boost",
            manufacturer="Hive",
            model="Boost Controller",
            entry_type="service",
        )

    def _minutes_remaining(self) -> int | None:
        """Calculate minutes remaining in the current boost."""
        ends_at_str = self._boost_state.get(ATTR_BOOST_ENDS_AT)
        if not ends_at_str:
            return None
        ends_at = dt_util.parse_datetime(ends_at_str)
        if not ends_at:
            return None
        remaining = ends_at - dt_util.utcnow()
        return max(0, int(remaining.total_seconds() / 60))

    def update(self) -> None:
        """Sync state from coordinator on initial load."""
        self._boost_state = self._coordinator.get_boost_state(self._climate_entity_id)
        self._climate_state = self.hass.states.get(self._climate_entity_id)
