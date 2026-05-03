import Slider from '@react-native-community/slider';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SCALE_MAX_CM } from '../constants/depth';
import { theme } from '../constants/theme';
import {
  clampDepthCm,
  cmToDisplay,
  displayToCm,
  getDepthColor,
  getDepthStatus,
  getReferenceHeightCm,
  getUnitLabel
} from '../utils/depth';
import ReferenceIcon from './ReferenceIcon';

const units = [
  { id: 'meter', label: 'Meter' },
  { id: 'feet', label: 'Feet' },
  { id: 'cm', label: 'cm' }
];

const VISUAL_HEIGHT = 180;
const VISUAL_SIDE_PADDING = 18;

export default function DepthControl({ depthCm, onChange, selectedReference, personHeightCm }) {
  const [unit, setUnit] = useState('meter');
  const [visualWidth, setVisualWidth] = useState(0);
  const displayValue = cmToDisplay(depthCm, unit);
  const status = getDepthStatus(depthCm, selectedReference, personHeightCm);
  const color = getDepthColor(depthCm);
  const referenceHeight = getReferenceHeightCm(selectedReference, personHeightCm);

  const visual = useMemo(() => {
    const availableWidth = visualWidth > 0 ? visualWidth - (VISUAL_SIDE_PADDING * 2) : 280;

    return {
      waterHeightPct: `${(clampDepthCm(depthCm) / SCALE_MAX_CM) * 100}%`,
      referenceHeightPx: Math.min(VISUAL_HEIGHT, (referenceHeight / SCALE_MAX_CM) * VISUAL_HEIGHT),
      maxReferenceWidth: Math.max(120, availableWidth)
    };
  }, [depthCm, referenceHeight, visualWidth]);

  function updateFromInput(text) {
    onChange(displayToCm(text, unit));
  }

  function handleVisualLayout(event) {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    setVisualWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.depthValue}>
            {displayValue} <Text style={styles.unit}>{getUnitLabel(unit)}</Text>
          </Text>
          <Text style={[styles.status, { color }]}>{status}</Text>
        </View>
        <View style={styles.unitRow}>
          {units.map((item) => (
            <Pressable
              key={item.id}
              style={[styles.unitButton, unit === item.id && styles.unitActive]}
              onPress={() => setUnit(item.id)}
            >
              <Text style={[styles.unitText, unit === item.id && styles.unitTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.visual} onLayout={handleVisualLayout}>
        <View style={styles.referenceWrap}>
          <ReferenceIcon
            type={selectedReference}
            compact
            fitHeight={visual.referenceHeightPx}
            maxWidth={visual.maxReferenceWidth}
          />
        </View>
        <View style={[styles.water, { height: visual.waterHeightPct }]} />
        <View style={styles.baseLine} />
      </View>

      <View style={styles.sliderRow}>
        <Text style={styles.sliderLabel}>0</Text>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={SCALE_MAX_CM}
          step={0.1}
          value={depthCm}
          minimumTrackTintColor={theme.colors.accent}
          maximumTrackTintColor="#D8EEF2"
          thumbTintColor={theme.colors.accent}
          onValueChange={(value) => onChange(clampDepthCm(value))}
        />
        <Text style={styles.sliderLabel}>200</Text>
      </View>

      <View style={styles.inputRow}>
        <Text style={styles.inputLabel}>Depth</Text>
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          value={displayValue}
          onChangeText={updateFromInput}
        />
        <Text style={styles.inputUnit}>{getUnitLabel(unit)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#F8FCFD',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.mutedBorder,
    padding: 14,
    gap: 14
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12
  },
  depthValue: {
    color: theme.colors.text,
    fontSize: 26,
    fontWeight: '800'
  },
  unit: {
    fontSize: 15,
    color: theme.colors.textSecondary
  },
  status: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2
  },
  unitRow: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: '#E8F5F7',
    borderRadius: 8,
    padding: 3
  },
  unitButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6
  },
  unitActive: {
    backgroundColor: theme.colors.accent
  },
  unitText: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '700'
  },
  unitTextActive: {
    color: '#fff'
  },
  visual: {
    height: VISUAL_HEIGHT,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#ECF8FA',
    borderWidth: 1,
    borderColor: theme.colors.mutedBorder,
    justifyContent: 'flex-end',
    alignItems: 'center'
  },
  referenceWrap: {
    position: 'absolute',
    left: VISUAL_SIDE_PADDING,
    right: VISUAL_SIDE_PADDING,
    bottom: 0,
    justifyContent: 'flex-end',
    alignItems: 'center',
    zIndex: 2
  },
  water: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
    backgroundColor: 'rgba(21, 90, 124, 0.36)'
  },
  baseLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    zIndex: 3,
    backgroundColor: 'rgba(24, 69, 83, 0.28)'
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  slider: {
    flex: 1
  },
  sliderLabel: {
    color: theme.colors.muted,
    fontSize: 11
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  inputLabel: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '700'
  },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: theme.colors.mutedBorder,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: theme.colors.text
  },
  inputUnit: {
    color: theme.colors.textSecondary,
    fontWeight: '700'
  }
});
