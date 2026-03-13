"""Serve static files and register Hive Boost Lovelace card resource."""
from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

_WWW_DIR = Path(__file__).parent / "www"
_STATIC_URL = "/hive_boost_files"


async def async_setup_panel(hass: HomeAssistant) -> None:
    """Serve the www/ directory and register the Lovelace card resource."""
    await hass.http.async_register_static_paths(
        [StaticPathConfig(_STATIC_URL, str(_WWW_DIR), False)]
    )

    add_extra_js_url(hass, f"{_STATIC_URL}/hive-boost-card.js")

    _LOGGER.info("Hive Boost card resource registered")
