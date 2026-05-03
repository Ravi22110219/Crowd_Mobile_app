import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { airesqApi } from '../api/airesqApi';
import { createLiveSocket } from '../api/liveSocket';
import { adminSignIn, adminSignOut, getSignedInAdmin } from '../auth/cognitoAuth';
import AppShell from '../components/AppShell';
import ReportCard from '../components/ReportCard';
import StatusBadge from '../components/StatusBadge';
import { theme } from '../constants/theme';
import LiveMapScreen from './LiveMapScreen';

export default function AdminScreen() {
  const socketRef = useRef(null);
  const [admin, setAdmin] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [viewMode, setViewMode] = useState('reports');

  const stats = useMemo(() => ({
    total: reports.length,
    pending: reports.filter((item) => (item.verification_status || 'pending') === 'pending').length,
    critical: reports.filter((item) => Number(item.flood_depth_cm || 0) > 100).length,
    verified: reports.filter((item) => item.verification_status === 'valid').length
  }), [reports]);

  const loadReports = useCallback(async (nextFilter = filter) => {
    if (!admin) return;
    try {
      const data = await airesqApi.getAdminReports(nextFilter);
      setReports(data.items || []);
    } catch (error) {
      Alert.alert('Load failed', error.message);
    }
  }, [admin, filter]);

  useEffect(() => {
    let mounted = true;
    getSignedInAdmin()
      .then((user) => {
        if (mounted) setAdmin(user);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (admin) loadReports(filter);
  }, [admin, filter, loadReports]);

  useEffect(() => {
    if (!admin) return undefined;

    try {
      socketRef.current = createLiveSocket({
        onMessage: (message) => {
          if (message.type !== 'new_submission' || !message.report) return;
          setReports((current) => {
            if (current.some((item) => item.id === message.report.id)) return current;
            return [message.report, ...current];
          });
        }
      });
    } catch (error) {
      // Admin can still refresh manually.
    }

    return () => socketRef.current?.close();
  }, [admin]);

  async function signInAdmin() {
    if (!username.trim() || !password) {
      Alert.alert('Missing details', 'Enter admin username and password.');
      return;
    }
    setBusy(true);
    try {
      await adminSignIn(username.trim(), password);
      const user = await getSignedInAdmin();
      setAdmin(user);
      setUsername('');
      setPassword('');
    } catch (error) {
      Alert.alert('Sign in failed', error.message);
    } finally {
      setBusy(false);
    }
  }

  async function signOutAdmin() {
    await adminSignOut();
    setAdmin(null);
    setReports([]);
    setViewMode('reports');
  }

  async function verify(report, status) {
    try {
      await airesqApi.updateReportStatus(report.id, status);
      setReports((current) => current.map((item) => item.id === report.id ? { ...item, verification_status: status } : item));
      setSelectedReport(null);
    } catch (error) {
      Alert.alert('Verification failed', error.message);
    }
  }

  async function remove(report) {
    Alert.alert('Delete report', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await airesqApi.deleteReport(report.id);
            setReports((current) => current.filter((item) => item.id !== report.id));
          } catch (error) {
            Alert.alert('Delete failed', error.message);
          }
        }
      }
    ]);
  }

  if (loading) {
    return (
      <AppShell title="Admin Dashboard" subtitle="Secure flood report administration">
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      </AppShell>
    );
  }

  if (!admin) {
    return (
      <AppShell title="Admin Login" subtitle="Cognito protected access">
        <View style={styles.loginWrap}>
          <View style={styles.loginCard}>
            <Image source={require('../assets/airesq_dark.png')} style={styles.loginLogo} resizeMode="contain" />
            <Text style={styles.loginTitle}>Admin Login</Text>
            <TextInput style={styles.input} value={username} onChangeText={setUsername} placeholder="Username" autoCapitalize="none" />
            <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry />
            <Pressable style={styles.primaryButton} onPress={signInAdmin} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Login</Text>}
            </Pressable>
          </View>
        </View>
      </AppShell>
    );
  }

  return (
    <AppShell title="Admin Dashboard" subtitle="Instant review and verification">
      <View style={styles.adminHeader}>
        <View style={styles.headerActions}>
          {viewMode === 'reports' && (
            <Pressable style={styles.secondaryButton} onPress={() => loadReports(filter)}>
              <Text style={styles.secondaryText}>Refresh</Text>
            </Pressable>
          )}
        </View>
        <Pressable style={styles.secondaryButton} onPress={signOutAdmin}>
          <Text style={styles.secondaryText}>Sign Out</Text>
        </Pressable>
      </View>

      <View style={styles.viewToggle}>
        <Pressable
          style={[styles.viewToggleButton, viewMode === 'reports' && styles.viewToggleActive]}
          onPress={() => setViewMode('reports')}
        >
          <Text style={[styles.viewToggleText, viewMode === 'reports' && styles.viewToggleTextActive]}>Reports</Text>
        </Pressable>
        <Pressable
          style={[styles.viewToggleButton, viewMode === 'map' && styles.viewToggleActive]}
          onPress={() => setViewMode('map')}
        >
          <Text style={[styles.viewToggleText, viewMode === 'map' && styles.viewToggleTextActive]}>Live Map</Text>
        </Pressable>
      </View>

      {viewMode === 'reports' ? (
        <>
          <View style={styles.stats}>
            <Stat label="Total" value={stats.total} />
            <Stat label="Pending" value={stats.pending} tone="warning" />
            <Stat label="Critical" value={stats.critical} tone="danger" />
            <Stat label="Verified" value={stats.verified} tone="success" />
          </View>

          <View style={styles.filters}>
            {['all', 'pending', 'valid', 'invalid'].map((item) => (
              <Pressable key={item} style={[styles.filter, filter === item && styles.filterActive]} onPress={() => setFilter(item)}>
                <Text style={[styles.filterText, filter === item && styles.filterTextActive]}>{item}</Text>
              </Pressable>
            ))}
          </View>

          <FlatList
            contentContainerStyle={styles.list}
            data={reports}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ReportCard
                report={item}
                onOpen={setSelectedReport}
                onDelete={remove}
                onVerify={verify}
              />
            )}
            ListEmptyComponent={<Text style={styles.empty}>No reports found.</Text>}
          />
        </>
      ) : (
        <View style={styles.mapWrap}>
          <LiveMapScreen adminOnly />
        </View>
      )}

      <ReportModal
        report={selectedReport}
        onClose={() => setSelectedReport(null)}
        onVerify={verify}
      />
    </AppShell>
  );
}

function Stat({ label, value, tone }) {
  const color = tone === 'success'
    ? theme.colors.success
    : tone === 'warning'
      ? theme.colors.warning
      : tone === 'danger'
        ? theme.colors.danger
        : theme.colors.primary;

  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

function ReportModal({ report, onClose, onVerify }) {
  if (!report) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <ScrollView contentContainerStyle={styles.modalBody}>
            {report.photo_url ? <Image source={{ uri: report.photo_url }} style={styles.modalImage} /> : null}
            <Text style={styles.modalTitle}>{report.name || 'Anonymous'}</Text>
            <StatusBadge status={report.verification_status || 'pending'} />
            <Text style={styles.modalDetail}>Phone: {report.phone || 'N/A'}</Text>
            <Text style={styles.modalDetail}>Location: {[report.street, report.zone].filter(Boolean).join(', ') || 'N/A'}</Text>
            <Text style={styles.modalDetail}>Depth: {Number(report.flood_depth_cm || 0).toFixed(1)} cm</Text>
            <Text style={styles.modalDetail}>GPS: {report.gps?.lat || 'N/A'}, {report.gps?.lon || 'N/A'}</Text>
            <Text style={styles.modalDetail}>Remarks: {report.remarks || 'None'}</Text>
          </ScrollView>
          <View style={styles.modalActions}>
            <Pressable style={styles.secondaryButton} onPress={onClose}>
              <Text style={styles.secondaryText}>Close</Text>
            </Pressable>
            <Pressable style={styles.validButton} onPress={() => onVerify(report, 'valid')}>
              <Text style={styles.actionText}>Valid</Text>
            </Pressable>
            <Pressable style={styles.invalidButton} onPress={() => onVerify(report, 'invalid')}>
              <Text style={styles.actionText}>Invalid</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  loginWrap: {
    flex: 1,
    justifyContent: 'center',
    padding: 20
  },
  loginCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    padding: 22,
    gap: 14,
    borderWidth: 1,
    borderColor: theme.colors.mutedBorder,
    ...theme.shadow
  },
  loginLogo: {
    width: 92,
    height: 46,
    alignSelf: 'center'
  },
  loginTitle: {
    color: theme.colors.primary,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '900'
  },
  input: {
    backgroundColor: '#F8FCFD',
    borderWidth: 1,
    borderColor: theme.colors.mutedBorder,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: theme.colors.text
  },
  primaryButton: {
    backgroundColor: theme.colors.accent,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center'
  },
  primaryText: {
    color: '#fff',
    fontWeight: '900'
  },
  adminHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    padding: 14
  },
  headerActions: {
    flex: 1,
    flexDirection: 'row',
    gap: 8
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: '#fff'
  },
  secondaryText: {
    color: theme.colors.text,
    fontWeight: '800'
  },
  viewToggle: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 14
  },
  viewToggleButton: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: theme.colors.mutedBorder,
    borderRadius: 8,
    paddingVertical: 10
  },
  viewToggleActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary
  },
  viewToggleText: {
    color: theme.colors.textSecondary,
    fontWeight: '900'
  },
  viewToggleTextActive: {
    color: '#fff'
  },
  mapWrap: {
    flex: 1,
    minHeight: 320
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 14
  },
  statCard: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.mutedBorder
  },
  statLabel: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase'
  },
  statValue: {
    fontSize: 25,
    fontWeight: '900',
    marginTop: 4
  },
  filters: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 14
  },
  filter: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: theme.colors.mutedBorder
  },
  filterActive: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent
  },
  filterText: {
    color: theme.colors.textSecondary,
    fontWeight: '800',
    textTransform: 'capitalize'
  },
  filterTextActive: {
    color: '#fff'
  },
  list: {
    padding: 14,
    gap: 14
  },
  empty: {
    textAlign: 'center',
    color: theme.colors.textSecondary,
    padding: 30,
    fontWeight: '700'
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end'
  },
  modalCard: {
    maxHeight: '86%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden'
  },
  modalBody: {
    padding: 16,
    gap: 8
  },
  modalImage: {
    width: '100%',
    height: 230,
    borderRadius: 8
  },
  modalTitle: {
    color: theme.colors.primary,
    fontSize: 20,
    fontWeight: '900'
  },
  modalDetail: {
    color: theme.colors.textSecondary,
    fontSize: 14
  },
  modalActions: {
    flexDirection: 'row',
    gap: 8,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: theme.colors.mutedBorder
  },
  validButton: {
    backgroundColor: theme.colors.success,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  invalidButton: {
    backgroundColor: theme.colors.warning,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  actionText: {
    color: '#fff',
    fontWeight: '900'
  }
});
