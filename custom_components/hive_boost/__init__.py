"""Hive Boost — custom integration for boosting individual Hive TRVs."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

import voluptuous as vol

from homeassistant.components.climate import DOMAIN as CLIMATE_DOMAIN
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_track_point_in_time
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
import homeassistant.helpers.config_validation as cv

from .const import (
    ATTR_BOOST_ACTIVE,
    ATTR_BOOST_DURATION,
    ATTR_BOOST_ENDS_AT,
    ATTR_BOOST_TEMP,
    DEFAULT_BOOST_TEMP,
    DEFAULT_DURATION_MINUTES,
    MIN_DURATION_MINUTES,
    MAX_DURATION_MINUTES,
    DOMAIN,
    SERVICE_CANCEL_BOOST,
    SERVICE_START_BOOST,
    STORAGE_KEY,
    STORAGE_VERSION,
)

_LOGGER = logging.getLogger(__name__)

PLATFORMS = ["sensor"]

SERVICE_START_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Optional("temperature", default=DEFAULT_BOOST_TEMP): vol.All(
            vol.Coerce(float), vol.Range(min=5, max=32)
        ),
        vol.Optional("duration_minutes", default=DEFAULT_DURATION_MINUTES): vol.All(
            vol.Coerce(int), vol.Range(min=MIN_DURATION_MINUTES, max=MAX_DURATION_MINUTES)
        ),
    }
)

SERVICE_CANCEL_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
    }
)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Hive Boost from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    coordinator = HiveBoostCoordinator(hass, entry)
    hass.data[DOMAIN][entry.entry_id] = coordinator

    await coordinator.async_setup()

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Register the Hive panel (only on first load)
    if f"{DOMAIN}_panel" not in hass.data:
        from .panel import async_setup_panel
        await async_setup_panel(hass)
        hass.data[f"{DOMAIN}_panel"] = True

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    coordinator: HiveBoostCoordinator = hass.data[DOMAIN][entry.entry_id]
    coordinator.async_unload()

    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)

    return unload_ok


class HiveBoostCoordinator:
    """Manages boost state for all discovered Hive climate entities."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self._store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        # entity_id -> boost state dict
        self._boosts: dict[str, dict[str, Any]] = {}
        # entity_id -> cancel callback for the scheduled revert
        self._timers: dict[str, Any] = {}

    async def async_setup(self) -> None:
        """Discover entities, restore state, and register services."""
        # Restore persisted boost state
        stored = await self._store.async_load() or {}
        now = dt_util.utcnow()

        for entity_id, state in stored.items():
            ends_at_str = state.get(ATTR_BOOST_ENDS_AT)
            if ends_at_str:
                ends_at = dt_util.parse_datetime(ends_at_str)
                if ends_at and ends_at > now:
                    self._boosts[entity_id] = state
                    self._schedule_revert(entity_id, ends_at)
                    _LOGGER.info(
                        "Restored boost for %s, ends at %s", entity_id, ends_at
                    )

        self.hass.services.async_register(
            DOMAIN,
            SERVICE_START_BOOST,
            self._handle_start_boost,
            schema=SERVICE_START_SCHEMA,
        )
        self.hass.services.async_register(
            DOMAIN,
            SERVICE_CANCEL_BOOST,
            self._handle_cancel_boost,
            schema=SERVICE_CANCEL_SCHEMA,
        )

        _LOGGER.info("Hive Boost integration ready")

    @callback
    def async_unload(self) -> None:
        """Cancel all timers and remove services."""
        for cancel in self._timers.values():
            cancel()
        self._timers.clear()

        self.hass.services.async_remove(DOMAIN, SERVICE_START_BOOST)
        self.hass.services.async_remove(DOMAIN, SERVICE_CANCEL_BOOST)

    # ── Service handlers ──────────────────────────────────────────────────────

    async def _handle_start_boost(self, call: ServiceCall) -> None:
        """Handle hive_boost.start_boost service call."""
        entity_id: str = call.data["entity_id"]
        temperature: float = call.data["temperature"]
        duration_minutes: int = call.data["duration_minutes"]

        ends_at = dt_util.utcnow() + timedelta(minutes=duration_minutes)

        await self._cancel_boost_for(entity_id, revert=False)

        hours, mins = divmod(duration_minutes, 60)
        time_period = f"{hours:02d}:{mins:02d}:00"

        await self.hass.services.async_call(
            "hive",
            "boost_heating_on",
            {"entity_id": entity_id, "time_period": time_period, "temperature": str(temperature)},
            blocking=True,
        )

        self._boosts[entity_id] = {
            ATTR_BOOST_ACTIVE: True,
            ATTR_BOOST_TEMP: temperature,
            ATTR_BOOST_DURATION: duration_minutes,
            ATTR_BOOST_ENDS_AT: ends_at.isoformat(),
        }
        await self._persist()

        self._schedule_revert(entity_id, ends_at)

        _LOGGER.info(
            "Boost started for %s: %.1f°C for %d min (ends %s)",
            entity_id, temperature, duration_minutes, ends_at,
        )

        self.hass.bus.async_fire(
            f"{DOMAIN}_boost_started",
            {"entity_id": entity_id, "temperature": temperature, "duration_minutes": duration_minutes},
        )

    async def _handle_cancel_boost(self, call: ServiceCall) -> None:
        """Handle hive_boost.cancel_boost service call."""
        entity_id: str = call.data["entity_id"]
        await self._cancel_boost_for(entity_id, revert=True)

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _schedule_revert(self, entity_id: str, ends_at: datetime) -> None:
        """Schedule climate revert at ends_at."""
        @callback
        def _revert(_now):
            self.hass.async_create_task(self._revert_climate(entity_id))

        cancel = async_track_point_in_time(self.hass, _revert, ends_at)
        self._timers[entity_id] = cancel

    async def _revert_climate(self, entity_id: str) -> None:
        """Turn off Hive boost after the scheduled duration expires."""
        _LOGGER.info("Boost ended for %s — turning off Hive boost", entity_id)

        await self.hass.services.async_call(
            "hive",
            "boost_heating_off",
            {"entity_id": entity_id},
            blocking=True,
        )

        self._boosts.pop(entity_id, None)
        self._timers.pop(entity_id, None)
        await self._persist()

        self.hass.bus.async_fire(
            f"{DOMAIN}_boost_ended",
            {"entity_id": entity_id},
        )

    async def _cancel_boost_for(self, entity_id: str, revert: bool) -> None:
        """Cancel a boost, optionally reverting the climate."""
        if entity_id in self._timers:
            self._timers.pop(entity_id)()

        if revert and entity_id in self._boosts:
            await self.hass.services.async_call(
                "hive",
                "boost_heating_off",
                {"entity_id": entity_id},
                blocking=True,
            )

        self._boosts.pop(entity_id, None)
        await self._persist()

        self.hass.bus.async_fire(
            f"{DOMAIN}_boost_cancelled",
            {"entity_id": entity_id},
        )

    async def _persist(self) -> None:
        """Persist current boost state to storage."""
        await self._store.async_save(self._boosts)

    # ── Public API for sensor platform ───────────────────────────────────────

    def get_boost_state(self, entity_id: str) -> dict[str, Any]:
        """Return boost state for a given climate entity."""
        return self._boosts.get(entity_id, {})

    def get_all_boosts(self) -> dict[str, dict[str, Any]]:
        """Return all active boosts."""
        return dict(self._boosts)

    def get_hive_climate_entities(self) -> list[str]:
        """Discover all Hive climate entity IDs in the registry."""
        ent_reg = er.async_get(self.hass)
        hive_entities = []
        for entry in ent_reg.entities.values():
            if (
                entry.domain == CLIMATE_DOMAIN
                and entry.platform == "hive"
                and not entry.disabled
            ):
                hive_entities.append(entry.entity_id)
        return hive_entities
