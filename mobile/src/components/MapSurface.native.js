import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import MapView, { Callout, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { theme } from '../constants/theme';
import { getDepthColor } from '../utils/depth';

const defaultRegion = {
  latitude: 22.5,
  longitude: 82.5,
  latitudeDelta: 24,
  longitudeDelta: 24
};

function hasValidGps(report) {
  return Number.isFinite(Number(report?.gps?.lat)) && Number.isFinite(Number(report?.gps?.lon));
}

export default function MapSurface({ reports, mapRef, latestId }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const markerRefs = useRef({});

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1400,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true
        })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    if (!latestId) return undefined;

    const timer = setTimeout(() => {
      markerRefs.current[latestId]?.showCallout?.();
    }, 360);

    return () => clearTimeout(timer);
  }, [latestId, reports.length]);

  const pulseStyle = {
    opacity: pulse.interpolate({
      inputRange: [0, 0.75, 1],
      outputRange: [0.38, 0.12, 0]
    }),
    transform: [
      {
        scale: pulse.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 2.35]
        })
      }
    ]
  };

  return (
    <MapView
      ref={mapRef}
      style={styles.map}
      provider={PROVIDER_GOOGLE}
      initialRegion={defaultRegion}
      mapType="standard"
      loadingEnabled
      showsCompass
      showsScale
      showsTraffic
    >
      {reports
        .filter(hasValidGps)
        .map((report) => {
          const color = getDepthColor(report.flood_depth_cm);
          const isLatest = report.id === latestId;
          return (
            <Marker
              key={report.id}
              ref={(ref) => {
                if (ref) markerRefs.current[report.id] = ref;
                else delete markerRefs.current[report.id];
              }}
              coordinate={{
                latitude: Number(report.gps.lat),
                longitude: Number(report.gps.lon)
              }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={isLatest}
            >
              <View style={styles.markerWrap}>
                {isLatest && (
                  <Animated.View
                    style={[
                      styles.markerPulse,
                      {
                        backgroundColor: `${color}24`,
                        borderColor: color
                      },
                      pulseStyle
                    ]}
                  />
                )}
                <View style={[styles.markerCore, { borderColor: color }]}>
                  <View style={[styles.markerDot, { backgroundColor: color }]} />
                  <Text style={styles.markerDepth}>
                    {Math.round(Number(report.flood_depth_cm || 0))}
                  </Text>
                </View>
              </View>
              <Callout>
                <View style={styles.callout}>
                  <Text style={[styles.calloutDepth, { color }]}>
                    {Number(report.flood_depth_cm || 0).toFixed(1)} cm
                  </Text>
                  <Text style={styles.calloutText}>{report.zone || report.street || 'Unknown location'}</Text>
                  <Text style={styles.calloutMuted}>{report.name || 'Anonymous'}</Text>
                </View>
              </Callout>
            </Marker>
          );
        })}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1
  },
  markerWrap: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center'
  },
  markerPulse: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2
  },
  markerCore: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    ...theme.shadow
  },
  markerDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4
  },
  markerDepth: {
    color: theme.colors.primary,
    fontSize: 11,
    fontWeight: '900'
  },
  callout: {
    minWidth: 160,
    gap: 4
  },
  calloutDepth: {
    fontSize: 20,
    fontWeight: '900'
  },
  calloutText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '700'
  },
  calloutMuted: {
    color: theme.colors.textSecondary,
    fontSize: 12
  }
});
