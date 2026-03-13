"""Constants for the Hive Boost integration."""

DOMAIN = "hive_boost"

# Temperature defaults
DEFAULT_MIN_TEMP = 16.0
DEFAULT_MAX_TEMP = 30.0
DEFAULT_BOOST_TEMP = 22.0

# Duration defaults (integer minutes)
DEFAULT_DURATION_MINUTES = 60
MIN_DURATION_MINUTES = 15
MAX_DURATION_MINUTES = 180

# Hive TRV model identifiers used to auto-discover entities
HIVE_MODELS = ["TRV003", "SLT3", "SLT3B", "SLT3C", "NANO2"]

# Attribute names stored per room
ATTR_BOOST_TEMP = "boost_temperature"
ATTR_BOOST_DURATION = "boost_duration"
ATTR_BOOST_ACTIVE = "boost_active"
ATTR_BOOST_ENDS_AT = "boost_ends_at"
ATTR_CURRENT_TEMP = "current_temperature"
ATTR_BATTERY = "battery_level"

# Service names
SERVICE_START_BOOST = "start_boost"
SERVICE_CANCEL_BOOST = "cancel_boost"

# Storage key for persisting boost state across restarts
STORAGE_KEY = f"{DOMAIN}.boost_state"
STORAGE_VERSION = 1
