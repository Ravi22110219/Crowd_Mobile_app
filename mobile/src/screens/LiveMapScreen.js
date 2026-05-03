import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { airesqApi } from '../api/airesqApi';
import { createLiveSocket } from '../api/liveSocket';
import MapSurface from '../components/MapSurface';
import MapOverlay from '../components/MapOverlay';
import { theme } from '../constants/theme';

const mapEdgePadding = {
  top: 90,
  right: 56,
  bottom: 170,
  left: 56
};

function getReportCoordinate(report) {
  const latitude = Number(report?.gps?.lat);
  const longitude = Number(report?.gps?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

export default function LiveMapScreen({ adminOnly = false }) {
  const mapRef = useRef(null);
  const socketRef = useRef(null);
  const [reports, setReports] = useState([]);
  const [latest, setLatest] = useState(null);
  const [connectionState, setConnectionState] = useState('offline');

  const focusReport = useCallback((report, duration = 900) => {
    const coordinate = getReportCoordinate(report);
    if (!coordinate) return;

    setTimeout(() => {
      mapRef.current?.animateToRegion?.({
        ...coordinate,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05
      }, duration);
    }, 120);
  }, []);

  const fitReportsOnMap = useCallback((items) => {
    const coordinates = items.map(getReportCoordinate).filter(Boolean);
    if (!coordinates.length) return;

    setTimeout(() => {
      if (coordinates.length === 1) {
        mapRef.current?.animateToRegion?.({
          ...coordinates[0],
          latitudeDelta: 0.05,
          longitudeDelta: 0.05
        }, 700);
        return;
      }

      mapRef.current?.fitToCoordinates?.(coordinates, {
        edgePadding: mapEdgePadding,
        animated: true
      });
    }, 220);
  }, []);

  const loadReports = useCallback(async () => {
    try {
      const data = adminOnly
        ? await airesqApi.getAdminReports('all')
        : await airesqApi.getPublicReports();
      const items = (data.items || []).filter((item) => getReportCoordinate(item));
      setReports(items);
      if (items.length) {
        const newest = [...items].sort((a, b) => new Date(b.received_at) - new Date(a.received_at))[0];
        setLatest(newest);
        fitReportsOnMap(items);
      } else {
        setLatest(null);
      }
    } catch (error) {
      Alert.alert('Map load failed', error.message);
    }
  }, [adminOnly, fitReportsOnMap]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    try {
      socketRef.current = createLiveSocket({
        onOpen: () => setConnectionState('live'),
        onClose: () => setConnectionState('offline'),
        onError: () => setConnectionState('offline'),
        onMessage: (message) => {
          if (message.type !== 'new_submission' || !message.report) return;
          if (!getReportCoordinate(message.report)) return;
          setReports((current) => {
            if (current.some((item) => item.id === message.report.id)) return current;
            return [message.report, ...current];
          });
          setLatest(message.report);
          focusReport(message.report, 1000);
        }
      });
    } catch (error) {
      setConnectionState('offline');
    }

    return () => {
      socketRef.current?.close();
    };
  }, [focusReport]);

  return (
    <View style={styles.container}>
      <MapSurface reports={reports} mapRef={mapRef} latestId={latest?.id} />
      <MapOverlay
        connectionState={connectionState}
        reportCount={reports.length}
        latest={latest}
        onRefresh={loadReports}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.primary
  }
});
