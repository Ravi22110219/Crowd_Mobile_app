import { baseDepthLabels, baseReferenceHeights, SCALE_MAX_CM } from '../constants/depth';

export function clampDepthCm(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Number(Math.max(0, Math.min(SCALE_MAX_CM, numeric)).toFixed(1));
}

export function cmToDisplay(cm, unit) {
  const clamped = clampDepthCm(cm);
  if (unit === 'meter') return (clamped / 100).toFixed(2);
  if (unit === 'feet') return (clamped / 30.48).toFixed(2);
  return clamped.toFixed(1);
}

export function displayToCm(value, unit) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (unit === 'meter') return clampDepthCm(numeric * 100);
  if (unit === 'feet') return clampDepthCm(numeric * 30.48);
  return clampDepthCm(numeric);
}

export function getUnitLabel(unit) {
  if (unit === 'meter') return 'm';
  if (unit === 'feet') return 'ft';
  return 'cm';
}

export function feetInchesToCm(feet, inches) {
  return Math.round((Number(feet || 0) * 30.48) + (Number(inches || 0) * 2.54));
}

export function makePersonLabels(personHeightCm) {
  const safeHeight = Math.max(100, Math.min(230, Number(personHeightCm) || 183));
  const ratio = safeHeight / 183;
  return [
    { depth: 0, label: 'No Flood' },
    { depth: Math.round(25 * ratio), label: 'Ankle level' },
    { depth: Math.round(45 * ratio), label: 'Knee level' },
    { depth: Math.round(75 * ratio), label: 'Mid-thigh level' },
    { depth: Math.round(100 * ratio), label: 'Waist level' },
    { depth: Math.round(135 * ratio), label: 'Chest level' },
    { depth: Math.round(155 * ratio), label: 'Neck level' },
    { depth: safeHeight, label: 'Fully submerged' }
  ];
}

export function getDepthLabels(selectedReference, personHeightCm) {
  if (selectedReference === 'person') {
    return makePersonLabels(personHeightCm);
  }
  return baseDepthLabels[selectedReference] || baseDepthLabels.car;
}

export function getReferenceHeightCm(selectedReference, personHeightCm) {
  if (selectedReference === 'person') {
    return Math.max(100, Math.min(230, Number(personHeightCm) || 183));
  }
  return baseReferenceHeights[selectedReference] || baseReferenceHeights.car;
}

export function getDepthStatus(cm, selectedReference, personHeightCm) {
  const labels = getDepthLabels(selectedReference, personHeightCm);
  const depth = clampDepthCm(cm);
  for (let index = labels.length - 1; index >= 0; index -= 1) {
    if (depth >= labels[index].depth) return labels[index].label;
  }
  return 'No Flood';
}

export function getDepthColor(cm) {
  const depth = clampDepthCm(cm);
  if (depth <= 30) return '#4CAF50';
  if (depth <= 60) return '#FFC107';
  if (depth <= 100) return '#FF9800';
  return '#F44336';
}

export function getDepthRiskLabel(cm) {
  const depth = clampDepthCm(cm);
  if (depth === 0) return 'No Flood';
  if (depth <= 30) return 'Safe';
  if (depth <= 60) return 'Caution';
  if (depth <= 100) return 'Warning';
  return 'Danger';
}
