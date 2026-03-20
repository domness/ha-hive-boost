/**
 * Shared label formatting for boost/heating states.
 */

function normalizeTemperature(targetTemperature) {
  if (targetTemperature == null) return null;
  const n = Number.parseFloat(targetTemperature);
  if (!Number.isFinite(n)) return null;
  return Number.isInteger(n) ? `${n}` : `${n}`.replace(/\.0+$/, "");
}

export function formatBoostStatusLabel({ minutesRemaining, targetTemperature }) {
  const target = normalizeTemperature(targetTemperature);
  const hasMinutes =
    Number.isFinite(minutesRemaining) && Number(minutesRemaining) > 0;

  if (hasMinutes) {
    return target
      ? `${minutesRemaining}m left · ${target}°`
      : `${minutesRemaining}m left`;
  }

  return target ? `Boosting to ${target}°` : "Boosting";
}

export function formatBoostActionLabel(targetTemperature) {
  const target = normalizeTemperature(targetTemperature);
  return target ? `Boosting to ${target}°` : "Boosting";
}

export function formatHeatingStatusLabel(targetTemperature) {
  const target = normalizeTemperature(targetTemperature);
  return target ? `Heating to ${target}°` : "Heating";
}

