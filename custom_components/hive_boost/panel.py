"""Register the Hive Boost frontend panel and static file path."""
from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

_WWW_DIR = Path(__file__).parent / "www"
_STATIC_URL = "/hive_boost_files"
_PANEL_URL = "hive"


async def async_setup_panel(hass: HomeAssistant) -> None:
    """Serve static files and register the sidebar panel."""
    # Serve the www/ directory under /hive_boost_files/
    await hass.http.async_register_static_paths(
        [StaticPathConfig(_STATIC_URL, str(_WWW_DIR), False)]
    )

    # Register as a Lovelace resource so custom:hive-panel works in dashboards
    add_extra_js_url(hass, f"{_STATIC_URL}/hive-panel.js")

    from homeassistant.components.panel_custom import async_register_panel

    await async_register_panel(
        hass,
        webcomponent_name="hive-panel",
        frontend_url_path=_PANEL_URL,
        sidebar_title="Hive",
        sidebar_icon="mdi:home-thermometer",
        module_url=f"{_STATIC_URL}/hive-panel.js",
        embed_iframe=False,
        require_admin=False,
    )

    _LOGGER.info("Hive panel registered at /%s", _PANEL_URL)
