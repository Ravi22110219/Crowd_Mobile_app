import React, { useEffect, useMemo, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { theme } from '../constants/theme';
import { getDepthColor } from '../utils/depth';

const defaultCenter = { lat: 22.5, lng: 82.5 };
const env = typeof process !== 'undefined' ? process.env || {} : {};
const expoExtra = Constants.expoConfig?.extra || Constants.manifest?.extra || {};
const googleMapsApiKey = env.EXPO_PUBLIC_GOOGLE_MAP_API || expoExtra.GOOGLE_MAP_API || env.GOOGLE_MAP_API || '';
const scriptId = 'airesq-google-maps-js';
let googleMapsPromise;

function hasValidGps(report) {
  return Number.isFinite(Number(report?.gps?.lat)) && Number.isFinite(Number(report?.gps?.lon));
}

function toPosition(report) {
  return {
    lat: Number(report.gps.lat),
    lng: Number(report.gps.lon)
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loadGoogleMaps(apiKey) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Google Maps can only load in a browser.'));
  }

  if (window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }

  if (!apiKey) {
    return Promise.reject(new Error('Google Maps API key is missing. Set GOOGLE_MAP_API in mobile/.env.'));
  }

  if (!googleMapsPromise) {
    googleMapsPromise = new Promise((resolve, reject) => {
      const existingScript = document.getElementById(scriptId);
      window.__airesqGoogleMapsReady = () => resolve(window.google.maps);

      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(window.google.maps), { once: true });
        existingScript.addEventListener('error', () => reject(new Error('Google Maps failed to load.')), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.id = scriptId;
      script.async = true;
      script.defer = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=__airesqGoogleMapsReady`;
      script.onerror = () => reject(new Error('Google Maps failed to load.'));
      document.head.appendChild(script);
    });
  }

  return googleMapsPromise;
}

function markerIcon(maps, color, active) {
  return {
    path: maps.SymbolPath.CIRCLE,
    fillColor: color,
    fillOpacity: 0.94,
    strokeColor: '#FFFFFF',
    strokeOpacity: 1,
    strokeWeight: active ? 4 : 3,
    scale: active ? 14 : 11
  };
}

function markerLabel(report) {
  return {
    text: String(Math.round(Number(report.flood_depth_cm || 0))),
    color: '#12343B',
    fontSize: '11px',
    fontWeight: '900'
  };
}

function popupContent(report, color) {
  const location = [report.street, report.zone].filter(Boolean).join(', ') || 'Unknown location';
  const gps = `${Number(report.gps.lat).toFixed(5)}, ${Number(report.gps.lon).toFixed(5)}`;
  const status = report.verification_status || 'pending';

  return `
    <div style="min-width:220px;max-width:280px;font-family:Inter,Arial,sans-serif;color:#132D35;">
      <div style="display:inline-flex;align-items:center;border-radius:999px;background:${color};color:#fff;font-size:11px;font-weight:800;padding:4px 8px;margin-bottom:8px;">
        ${escapeHtml(status.toUpperCase())}
      </div>
      <div style="font-size:26px;font-weight:900;color:${color};line-height:1;">
        ${Number(report.flood_depth_cm || 0).toFixed(1)} cm
      </div>
      <div style="font-size:14px;font-weight:800;margin-top:8px;">${escapeHtml(location)}</div>
      <div style="font-size:12px;color:#5D7077;margin-top:4px;">Reporter: ${escapeHtml(report.name || 'Anonymous')}</div>
      <div style="font-size:12px;color:#5D7077;margin-top:2px;">GPS: ${escapeHtml(gps)}</div>
      ${report.remarks ? `<div style="font-size:12px;color:#334B54;margin-top:8px;">${escapeHtml(report.remarks)}</div>` : ''}
    </div>
  `;
}

function fitReports(map, maps, reports) {
  if (!reports.length) return;

  if (reports.length === 1) {
    map.panTo(toPosition(reports[0]));
    map.setZoom(13);
    return;
  }

  const bounds = new maps.LatLngBounds();
  reports.forEach((report) => bounds.extend(toPosition(report)));
  map.fitBounds(bounds, 68);
}

function zoomFromDelta(delta) {
  if (delta <= 0.02) return 15;
  if (delta <= 0.05) return 13;
  if (delta <= 0.2) return 11;
  if (delta <= 1) return 9;
  if (delta <= 5) return 7;
  return 5;
}

export default function MapSurface({ reports, mapRef, latestId }) {
  const mapNodeRef = useRef(null);
  const googleMapsRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef(new Map());
  const infoWindowRef = useRef(null);
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');

  const visibleReports = useMemo(() => reports.filter(hasValidGps), [reports]);
  const latestReport = useMemo(
    () => visibleReports.find((report) => report.id === latestId),
    [latestId, visibleReports]
  );

  useEffect(() => {
    let mounted = true;

    loadGoogleMaps(googleMapsApiKey)
      .then((maps) => {
        if (!mounted || !mapNodeRef.current) return;
        googleMapsRef.current = maps;

        if (!mapInstanceRef.current) {
          mapInstanceRef.current = new maps.Map(mapNodeRef.current, {
            center: defaultCenter,
            zoom: 5,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            clickableIcons: false,
            gestureHandling: 'greedy',
            styles: [
              {
                featureType: 'poi',
                stylers: [{ visibility: 'off' }]
              }
            ]
          });
          infoWindowRef.current = new maps.InfoWindow();
        }

        setLoadState('ready');
      })
      .catch((error) => {
        if (!mounted) return;
        setLoadError(error.message);
        setLoadState('error');
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const maps = googleMapsRef.current;
    if (!map || !maps || !mapRef) return undefined;

    mapRef.current = {
      __airesqWebMap: true,
      animateToRegion(region) {
        map.panTo({ lat: Number(region.latitude), lng: Number(region.longitude) });
        map.setZoom(zoomFromDelta(Number(region.latitudeDelta || region.longitudeDelta || 0.05)));
      },
      fitToCoordinates(coordinates) {
        const validCoordinates = coordinates
          .map((coordinate) => ({
            lat: Number(coordinate.latitude),
            lng: Number(coordinate.longitude)
          }))
          .filter((coordinate) => Number.isFinite(coordinate.lat) && Number.isFinite(coordinate.lng));

        if (!validCoordinates.length) return;

        if (validCoordinates.length === 1) {
          map.panTo(validCoordinates[0]);
          map.setZoom(13);
          return;
        }

        const bounds = new maps.LatLngBounds();
        validCoordinates.forEach((coordinate) => bounds.extend(coordinate));
        map.fitBounds(bounds, 68);
      }
    };

    return () => {
      if (mapRef.current?.__airesqWebMap) {
        mapRef.current = null;
      }
    };
  }, [loadState, mapRef]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const maps = googleMapsRef.current;
    if (!map || !maps || loadState !== 'ready') return;

    const activeIds = new Set();

    visibleReports.forEach((report) => {
      const color = getDepthColor(report.flood_depth_cm);
      const active = report.id === latestId;
      const position = toPosition(report);
      activeIds.add(report.id);

      let marker = markersRef.current.get(report.id);
      if (!marker) {
        marker = new maps.Marker({
          map,
          position,
          title: report.zone || report.street || 'Flood report',
          animation: maps.Animation.DROP,
          icon: markerIcon(maps, color, active),
          label: markerLabel(report),
          optimized: false
        });
        marker.addListener('click', () => {
          const currentReport = marker.__airesqReport || report;
          const currentColor = getDepthColor(currentReport.flood_depth_cm);
          infoWindowRef.current?.setContent(popupContent(currentReport, currentColor));
          infoWindowRef.current?.open(map, marker);
        });
        markersRef.current.set(report.id, marker);
      } else {
        marker.setPosition(position);
        marker.setIcon(markerIcon(maps, color, active));
        marker.setLabel(markerLabel(report));
        marker.setTitle(report.zone || report.street || 'Flood report');
      }
      marker.__airesqReport = report;
    });

    markersRef.current.forEach((marker, id) => {
      if (!activeIds.has(id)) {
        marker.setMap(null);
        markersRef.current.delete(id);
      }
    });

    if (!latestReport) {
      fitReports(map, maps, visibleReports);
    }
  }, [latestId, latestReport, loadState, visibleReports]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const maps = googleMapsRef.current;
    if (!map || !maps || !latestReport) return undefined;

    const marker = markersRef.current.get(latestReport.id);
    if (!marker) return undefined;

    const color = getDepthColor(latestReport.flood_depth_cm);
    marker.setAnimation(maps.Animation.BOUNCE);
    infoWindowRef.current?.setContent(popupContent(latestReport, color));
    infoWindowRef.current?.open(map, marker);
    map.panTo(toPosition(latestReport));
    if ((map.getZoom() || 0) < 13) map.setZoom(13);

    const timer = setTimeout(() => {
      marker.setAnimation(null);
    }, 1400);

    return () => clearTimeout(timer);
  }, [latestReport]);

  return (
    <View style={styles.webMap}>
      <View ref={mapNodeRef} style={styles.mapCanvas} />
      {loadState !== 'ready' && (
        <View style={styles.messagePanel}>
          {loadState === 'loading' ? (
            <>
              <ActivityIndicator color={theme.colors.accent} />
              <Text style={styles.messageText}>Loading Google Map...</Text>
            </>
          ) : (
            <Text style={styles.messageText}>{loadError}</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  webMap: {
    flex: 1,
    backgroundColor: '#DCECEF',
    minHeight: 360,
    overflow: 'hidden'
  },
  mapCanvas: {
    ...StyleSheet.absoluteFillObject
  },
  messagePanel: {
    position: 'absolute',
    top: 80,
    left: 16,
    right: 16,
    alignSelf: 'center',
    maxWidth: 360,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(15, 20, 30, 0.82)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  messageText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center'
  }
});
