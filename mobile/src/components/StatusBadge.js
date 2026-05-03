import React from 'react';
import { StyleSheet, Text } from 'react-native';

const colorMap = {
  pending: { bg: '#FFF8E8', color: '#B45309' },
  valid: { bg: '#EAF8EF', color: '#166534' },
  invalid: { bg: '#FDECEC', color: '#991B1B' }
};

export default function StatusBadge({ status = 'pending' }) {
  const colors = colorMap[status] || colorMap.pending;
  return <Text style={[styles.badge, { backgroundColor: colors.bg, color: colors.color }]}>{status}</Text>;
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase'
  }
});
