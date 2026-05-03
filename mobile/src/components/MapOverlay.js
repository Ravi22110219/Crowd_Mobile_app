import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../constants/theme';
import { getDepthColor } from '../utils/depth';

export default function MapOverlay({ connectionState, reportCount, latest, onRefresh }) {
  const depthColor = latest ? getDepthColor(latest.flood_depth_cm) : theme.colors.accent;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View style={styles.topBar}>
        <View style={styles.statusPill}>
          <View style={[styles.dot, connectionState === 'live' ? styles.live : styles.offline]} />
          <Text style={styles.statusText}>{connectionState === 'live' ? 'LIVE' : 'OFFLINE'}</Text>
          <View style={styles.divider} />
          <Text style={styles.count}>{reportCount} reports</Text>
        </View>
        <Pressable style={styles.refresh} onPress={onRefresh}>
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>

      <View style={styles.legend}>
        <Text style={styles.legendTitle}>Depth Legend</Text>
        <LegendItem color="#4CAF50" text="0-30 cm Safe" />
        <LegendItem color="#FFC107" text="30-60 cm Caution" />
        <LegendItem color="#FF9800" text="60-100 cm Warning" />
        <LegendItem color="#F44336" text=">100 cm Danger" />
      </View>

      {!!latest && (
        <View style={styles.latest}>
          <Text style={styles.latestBadge}>NEW</Text>
          <Text style={[styles.latestDepth, { color: depthColor }]}>{Number(latest.flood_depth_cm || 0).toFixed(1)} cm</Text>
          <Text style={styles.latestLocation} numberOfLines={1}>{latest.zone || latest.street || 'Unknown location'}</Text>
          <Text style={styles.latestReporter}>{latest.name || 'Anonymous'}</Text>
        </View>
      )}
    </View>
  );
}

function LegendItem({ color, text }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(15, 20, 30, 0.76)',
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 8
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  live: {
    backgroundColor: '#4CAF50'
  },
  offline: {
    backgroundColor: '#F44336'
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900'
  },
  divider: {
    width: 1,
    height: 14,
    backgroundColor: 'rgba(255,255,255,0.25)'
  },
  count: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    fontWeight: '700'
  },
  refresh: {
    backgroundColor: 'rgba(15, 20, 30, 0.76)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  refreshText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 12
  },
  legend: {
    position: 'absolute',
    bottom: 22,
    left: 14,
    backgroundColor: 'rgba(15, 20, 30, 0.78)',
    borderRadius: 12,
    padding: 12,
    gap: 5
  },
  legendTitle: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginBottom: 3
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7
  },
  swatch: {
    width: 16,
    height: 10,
    borderRadius: 3
  },
  legendText: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11,
    fontWeight: '600'
  },
  latest: {
    position: 'absolute',
    right: 14,
    bottom: 22,
    width: 180,
    backgroundColor: 'rgba(15, 20, 30, 0.84)',
    borderRadius: 12,
    padding: 12
  },
  latestBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#F44336',
    color: '#fff',
    fontSize: 9,
    fontWeight: '900',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginBottom: 6
  },
  latestDepth: {
    fontSize: 22,
    fontWeight: '900'
  },
  latestLocation: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    marginTop: 4
  },
  latestReporter: {
    color: 'rgba(255,255,255,0.48)',
    fontSize: 11,
    marginTop: 2
  }
});
