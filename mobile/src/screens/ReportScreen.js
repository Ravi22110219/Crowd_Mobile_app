import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import AppShell from '../components/AppShell';
import CaptchaBox from '../components/CaptchaBox';
import DepthControl from '../components/DepthControl';
import PhotoPicker from '../components/PhotoPicker';
import ReferenceSelector from '../components/ReferenceSelector';
import { airesqApi } from '../api/airesqApi';
import { shouldUseTurnstile } from '../config/captchaConfig';
import { theme } from '../constants/theme';
import { feetInchesToCm } from '../utils/depth';
import { getCurrentGps } from '../utils/location';
import { preprocessReport } from '../utils/preprocessReport';

const initialForm = {
  name: '',
  phone: '',
  street: '',
  zone: '',
  vehicle_type: 'car',
  flood_depth_cm: 0,
  remarks: '',
  person_height_cm: 183,
  gps: { lat: null, lon: null, accuracy: null }
};

export default function ReportScreen() {
  const [form, setForm] = useState(initialForm);
  const [feet, setFeet] = useState('6');
  const [inches, setInches] = useState('0');
  const [gpsLabel, setGpsLabel] = useState('Acquiring GPS location...');
  const [gpsStatus, setGpsStatus] = useState('warning');
  const [photo, setPhoto] = useState(null);
  const [captcha, setCaptcha] = useState(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selectedReference = form.vehicle_type;
  const personHeightCm = useMemo(() => feetInchesToCm(Number(feet || 0), Number(inches || 0)), [feet, inches]);

  const updateForm = useCallback((key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const loadCaptcha = useCallback(async () => {
    if (shouldUseTurnstile()) {
      setCaptcha({ provider: 'turnstile', refreshId: Date.now() });
      setCaptchaAnswer('');
      return;
    }

    try {
      const challenge = await airesqApi.getCaptcha();
      setCaptcha(challenge);
      setCaptchaAnswer('');
    } catch (error) {
      setCaptcha(null);
      Alert.alert('Captcha unavailable', error.message);
    }
  }, []);

  const refreshGps = useCallback(async () => {
    try {
      const result = await getCurrentGps();
      setForm((current) => ({ ...current, gps: result.gps }));
      setGpsLabel(result.label);
      setGpsStatus(result.status);
    } catch (error) {
      setGpsLabel(error.message || 'GPS unavailable');
      setGpsStatus('error');
    }
  }, []);

  useEffect(() => {
    loadCaptcha();
    refreshGps();
  }, [loadCaptcha, refreshGps]);

  useEffect(() => {
    if (selectedReference === 'person') {
      updateForm('person_height_cm', personHeightCm);
    }
  }, [personHeightCm, selectedReference, updateForm]);

  async function submitReport() {
    const captchaToken = captchaAnswer.trim();
    const turnstileEnabled = shouldUseTurnstile();

    if (!photo?.uri) {
      Alert.alert('Photo required', 'Please capture a flood photo before submitting.');
      return;
    }

    if (!captcha || !captchaToken) {
      Alert.alert('Captcha required', turnstileEnabled ? 'Please complete the verification before submitting.' : 'Please solve the captcha before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = await preprocessReport(
        {
          ...form,
          captcha: turnstileEnabled
            ? {
              provider: 'turnstile',
              token: captchaToken
            }
            : {
              ...captcha,
              answer: captchaToken
            }
        },
        photo
      );

      await airesqApi.createReport(payload);
      Alert.alert('Report submitted', 'Your flood report was sent to the admin dashboard instantly.');
      setForm(initialForm);
      setFeet('6');
      setInches('0');
      setPhoto(null);
      await loadCaptcha();
      await refreshGps();
    } catch (error) {
      Alert.alert('Submission failed', error.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell title="Report Flood Depth" subtitle="Powered by AIResQ Climsols Pvt Ltd">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <View style={styles.grid}>
              <Field label="Name" value={form.name} onChangeText={(value) => updateForm('name', value)} />
              <Field label="Phone" value={form.phone} keyboardType="phone-pad" onChangeText={(value) => updateForm('phone', value)} />
              <Field label="Street/Locality" value={form.street} onChangeText={(value) => updateForm('street', value)} />
              <Field label="Zone/Area" value={form.zone} onChangeText={(value) => updateForm('zone', value)} />
            </View>

            <ReferenceSelector value={selectedReference} onChange={(value) => updateForm('vehicle_type', value)} />

            {selectedReference === 'person' && (
              <View style={styles.heightRow}>
                <Text style={styles.sectionLabel}>Person Height</Text>
                <TextInput style={styles.heightInput} value={feet} onChangeText={setFeet} keyboardType="number-pad" />
                <Text style={styles.heightText}>ft</Text>
                <TextInput style={styles.heightInput} value={inches} onChangeText={setInches} keyboardType="number-pad" />
                <Text style={styles.heightText}>in</Text>
                <Text style={styles.heightCm}>({personHeightCm} cm)</Text>
              </View>
            )}

            <DepthControl
              depthCm={form.flood_depth_cm}
              selectedReference={selectedReference}
              personHeightCm={personHeightCm}
              onChange={(value) => updateForm('flood_depth_cm', value)}
            />

            <PhotoPicker value={photo} onChange={setPhoto} />

            <Field
              label="Remarks"
              value={form.remarks}
              multiline
              numberOfLines={3}
              onChangeText={(value) => updateForm('remarks', value)}
              placeholder="Road condition, rescue needs, affected areas..."
            />

            <Pressable style={[styles.gpsBox, styles[gpsStatus]]} onPress={refreshGps}>
              <Text style={styles.gpsText}>{gpsLabel}</Text>
            </Pressable>

            <CaptchaBox
              challenge={captcha}
              answer={captchaAnswer}
              onAnswerChange={setCaptchaAnswer}
              onRefresh={loadCaptcha}
            />

            <Pressable style={styles.submit} onPress={submitReport} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Submit Flood Report</Text>}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </AppShell>
  );
}

function Field({ label, style, ...props }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, props.multiline && styles.textarea, style]}
        placeholderTextColor={theme.colors.muted}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    padding: 16,
    gap: 18,
    borderWidth: 1,
    borderColor: theme.colors.mutedBorder,
    ...theme.shadow
  },
  grid: {
    gap: 12
  },
  field: {
    gap: 6
  },
  label: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '700'
  },
  input: {
    backgroundColor: '#F8FCFD',
    borderWidth: 1,
    borderColor: theme.colors.mutedBorder,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: theme.colors.text
  },
  textarea: {
    minHeight: 86,
    textAlignVertical: 'top'
  },
  sectionLabel: {
    color: theme.colors.text,
    fontWeight: '800',
    marginRight: 6
  },
  heightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8
  },
  heightInput: {
    width: 56,
    backgroundColor: '#F8FCFD',
    borderWidth: 1,
    borderColor: theme.colors.mutedBorder,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    textAlign: 'center',
    color: theme.colors.text,
    fontWeight: '800'
  },
  heightText: {
    color: theme.colors.textSecondary,
    fontWeight: '700'
  },
  heightCm: {
    color: theme.colors.accent,
    fontWeight: '800'
  },
  gpsBox: {
    borderRadius: 8,
    padding: 12,
    borderWidth: 1
  },
  success: {
    backgroundColor: '#EAF8EF',
    borderColor: '#BEE7CA'
  },
  warning: {
    backgroundColor: '#FFF8E8',
    borderColor: '#F5DBA6'
  },
  error: {
    backgroundColor: '#FDECEC',
    borderColor: '#F8C3C3'
  },
  gpsText: {
    color: theme.colors.text,
    fontWeight: '700'
  },
  submit: {
    backgroundColor: theme.colors.accent,
    borderRadius: 8,
    paddingVertical: 15,
    alignItems: 'center'
  },
  submitText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 15
  }
});
