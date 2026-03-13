"""Config flow for Hive Boost integration."""
from __future__ import annotations

import voluptuous as vol
from homeassistant import config_entries

from .const import (
    DOMAIN,
    DEFAULT_MIN_TEMP,
    DEFAULT_MAX_TEMP,
    DEFAULT_BOOST_TEMP,
    DEFAULT_DURATION_MINUTES,
    MIN_DURATION_MINUTES,
    MAX_DURATION_MINUTES,
)

STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Optional("min_temp", default=DEFAULT_MIN_TEMP): vol.Coerce(float),
        vol.Optional("max_temp", default=DEFAULT_MAX_TEMP): vol.Coerce(float),
        vol.Optional("default_temp", default=DEFAULT_BOOST_TEMP): vol.Coerce(float),
        vol.Optional("default_duration_minutes", default=DEFAULT_DURATION_MINUTES): vol.All(
            vol.Coerce(int), vol.Range(min=MIN_DURATION_MINUTES, max=MAX_DURATION_MINUTES)
        ),
    }
)


class HiveBoostConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle the config flow for Hive Boost."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Handle the initial step."""
        if self._async_current_entries():
            return self.async_abort(reason="already_configured")

        if user_input is not None:
            return self.async_create_entry(title="Hive Boost", data=user_input)

        return self.async_show_form(
            step_id="user",
            data_schema=STEP_USER_DATA_SCHEMA,
        )
