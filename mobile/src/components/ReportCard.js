import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../constants/theme';
import { getDepthColor } from '../utils/depth';
import StatusBadge from './StatusBadge';

export default function ReportCard({ report, onOpen, onDelete, onVerify }) {
  const color = getDepthColor(report.flood_depth_cm);
  const imageUri = report.photo_url || report.thumbnail_url;

  return (
    <View style={styles.card}>
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={styles.image} />
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>No Photo</Text>
        </View>
      )}
      <View style={styles.content}>
        <View style={styles.topLine}>
          <Text style={styles.name}>{report.name || 'Anonymous'}</Text>
          <StatusBadge status={report.verification_status || 'pending'} />
        </View>
        <Text style={styles.detail}>{[report.street, report.zone].filter(Boolean).join(', ') || 'Location not specified'}</Text>
        <Text style={styles.detail}>Reference: {report.vehicle_type || 'N/A'}</Text>
        <Text style={[styles.depth, { color }]}>{Number(report.flood_depth_cm || 0).toFixed(1)} cm</Text>
        <View style={styles.actions}>
          <Pressable style={styles.outlineButton} onPress={() => onOpen?.(report)}>
            <Text style={styles.outlineText}>View</Text>
          </Pressable>
          <Pressable style={styles.validButton} onPress={() => onVerify?.(report, 'valid')}>
            <Text style={styles.actionText}>Valid</Text>
          </Pressable>
          <Pressable style={styles.invalidButton} onPress={() => onVerify?.(report, 'invalid')}>
            <Text style={styles.actionText}>Invalid</Text>
          </Pressable>
          <Pressable style={styles.deleteButton} onPress={() => onDelete?.(report)}>
            <Text style={styles.actionText}>Delete</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.mutedBorder,
    overflow: 'hidden',
    ...theme.shadow
  },
  image: {
    width: '100%',
    height: 170
  },
  placeholder: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF6F8'
  },
  placeholderText: {
    color: theme.colors.textSecondary,
    fontWeight: '700'
  },
  content: {
    padding: 14,
    gap: 6
  },
  topLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10
  },
  name: {
    flex: 1,
    color: theme.colors.accent,
    fontSize: 16,
    fontWeight: '800'
  },
  detail: {
    color: theme.colors.textSecondary,
    fontSize: 13
  },
  depth: {
    fontSize: 20,
    fontWeight: '900',
    marginTop: 4
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8
  },
  outlineButton: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  outlineText: {
    color: theme.colors.text,
    fontWeight: '800'
  },
  validButton: {
    backgroundColor: theme.colors.success,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  invalidButton: {
    backgroundColor: theme.colors.warning,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  deleteButton: {
    backgroundColor: theme.colors.danger,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  actionText: {
    color: '#fff',
    fontWeight: '800'
  }
});
