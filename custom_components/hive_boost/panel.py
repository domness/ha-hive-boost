"""Register Hive Boost card as a persistent Lovelace resource.

Using the Lovelace resource storage collection (equivalent to adding the
resource via Settings → Dashboards → Resources) is reliable across
navigation and service-worker cache invalidation.  add_extra_js_url is
only used as a fallback when HA is running in YAML-mode Lovelace.
"""
from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

_WWW_DIR = Path(__file__).parent / "www"
_STATIC_URL = "/hive_boost_files"
CARD_JS_URL = f"{_STATIC_URL}/hive-boost-card.js"


async def async_setup_panel(hass: HomeAssistant) -> None:
    """Serve www/ and register the card as a Lovelace resource.

    The static path is registered immediately.  Resource registration is
    deferred until after HA has finished starting so that the Lovelace
    storage collection is guaranteed to be available.
    """
    await hass.http.async_register_static_paths(
        [StaticPathConfig(_STATIC_URL, str(_WWW_DIR), cache_headers=False)]
    )

    async def _register(_event=None) -> None:
        await _async_register_resource(hass, CARD_JS_URL)

    if hass.is_running:
        # HA is already up — register straight away.
        await _register()
    else:
        # HA is still starting; wait until everything is ready so the
        # Lovelace resource collection exists before we try to write to it.
        from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _register)


async def async_remove_panel(hass: HomeAssistant) -> None:
    """Remove the card from Lovelace resources on integration unload."""
    try:
        collection = hass.data.get("lovelace", {}).get("resources")
        if collection is None:
            return
        await collection.async_load()
        for item in collection.async_items():
            if item.get("url") == CARD_JS_URL:
                await collection.async_delete_item(item["id"])
                _LOGGER.debug("Removed Lovelace resource: %s", CARD_JS_URL)
                return
    except Exception as err:  # noqa: BLE001
        _LOGGER.debug("Could not remove Lovelace resource: %s", err)


async def _async_register_resource(hass: HomeAssistant, url: str) -> None:
    """Add *url* to Lovelace resource storage if not already present.

    Falls back to add_extra_js_url when HA is in YAML Lovelace mode
    (resource storage collection is unavailable).
    """
    try:
        collection = hass.data.get("lovelace", {}).get("resources")
        if collection is None:
            raise RuntimeError("Lovelace resource collection not available (YAML mode?)")

        await collection.async_load()

        for item in collection.async_items():
            if item.get("url") == url:
                _LOGGER.debug("Lovelace resource already registered: %s", url)
                return

        await collection.async_create_item({"url": url, "res_type": "module"})
        _LOGGER.info("Registered Lovelace resource: %s", url)

    except Exception as err:  # noqa: BLE001
        _LOGGER.warning(
            "Could not register Lovelace resource (%s) — falling back to add_extra_js_url",
            err,
        )
        add_extra_js_url(hass, url)
