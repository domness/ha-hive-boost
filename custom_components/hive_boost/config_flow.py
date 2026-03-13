"""Config flow for Hive Boost integration."""
from __future__ import annotations

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import HomeAssistant

from .const import (
    DOMAIN,
    DEFAULT_MIN_TEMP,
    DEFAULT_MAX_TEMP,
    DEFAULT_BOOST_TEMP,
    DEFAULT_DURATION,
    DURATION_OPTIONS,
)

STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Optional("min_temp", default=DEFAULT_MIN_TEMP): vol.Coerce(float),
        vol.Optional("max_temp", default=DEFAULT_MAX_TEMP): vol.Coerce(float),
        vol.Optional("default_temp", default=DEFAULT_BOOST_TEMP): vol.Coerce(float),
        vol.Optional("default_duration", default=DEFAULT_DURATION): vol.In(DURATION_OPTIONS),
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
