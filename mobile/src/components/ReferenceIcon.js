import React from 'react';
import { StyleSheet, View } from 'react-native';
import { theme } from '../constants/theme';
import AutoIcon from '../assets/autorickshaw.svg';
import BikeIcon from '../assets/bikesvg.svg';
import CarIcon from '../assets/carsvg.svg';
import CycleIcon from '../assets/bicycle.svg';
import PersonIcon from '../assets/person.svg';

const icons = {
  car: CarIcon,
  autorickshaw: AutoIcon,
  bike: BikeIcon,
  cycle: CycleIcon,
  person: PersonIcon
};

const selectorSizes = {
  car: { width: 76, height: 30, frameWidth: 84, frameHeight: 60 },
  autorickshaw: { width: 52, height: 52, frameWidth: 84, frameHeight: 60 },
  bike: { width: 72, height: 48, frameWidth: 84, frameHeight: 60 },
  cycle: { width: 76, height: 44, frameWidth: 84, frameHeight: 60 },
  person: { width: 26, height: 56, frameWidth: 84, frameHeight: 60 }
};

const compactAspectRatios = {
  car: 4058.82 / 1590.12,
  autorickshaw: 1,
  bike: 122.88 / 82.71,
  cycle: 1280 / 733,
  person: 86.79 / 206.32
};

const compactFallbackHeights = {
  car: 92,
  autorickshaw: 108,
  bike: 92,
  cycle: 86,
  person: 132
};

function getCompactSize(type, fitHeight, maxWidth) {
  const ratio = compactAspectRatios[type] || compactAspectRatios.car;
  const requestedHeight = Number(fitHeight) || compactFallbackHeights[type] || compactFallbackHeights.car;
  const safeHeight = Math.max(32, requestedHeight);
  const safeMaxWidth = Number(maxWidth) > 0 ? Number(maxWidth) : safeHeight * ratio;
  const widthAtHeight = safeHeight * ratio;

  if (widthAtHeight <= safeMaxWidth) {
    return {
      width: widthAtHeight,
      height: safeHeight,
      frameWidth: widthAtHeight,
      frameHeight: safeHeight
    };
  }

  return {
    width: safeMaxWidth,
    height: safeMaxWidth / ratio,
    frameWidth: safeMaxWidth,
    frameHeight: safeMaxWidth / ratio
  };
}

export default function ReferenceIcon({ type, selected, compact = false, fitHeight, maxWidth }) {
  const Icon = icons[type] || CarIcon;
  const size = compact ? getCompactSize(type, fitHeight, maxWidth) : selectorSizes[type] || selectorSizes.car;

  return (
    <View
      style={[
        styles.icon,
        { width: size.frameWidth, height: size.frameHeight },
        compact && styles.compact,
        selected && styles.selected
      ]}
    >
      <Icon width={size.width} height={size.height} preserveAspectRatio="xMidYMid meet" />
    </View>
  );
}

const styles = StyleSheet.create({
  icon: {
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.mutedBorder,
    backgroundColor: '#fff',
    overflow: 'hidden'
  },
  compact: {
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
    overflow: 'visible'
  },
  selected: {
    backgroundColor: '#FFFFFF',
    borderColor: theme.colors.accent
  }
});
