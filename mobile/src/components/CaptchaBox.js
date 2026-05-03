import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { captchaConfig, shouldUseTurnstile } from '../config/captchaConfig';
import { theme } from '../constants/theme';

const scriptId = 'airesq-turnstile-js';
let turnstilePromise;

function loadTurnstile() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Turnstile can only load in a browser.'));
  }

  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }

  if (!turnstilePromise) {
    turnstilePromise = new Promise((resolve, reject) => {
      const existingScript = document.getElementById(scriptId);

      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(window.turnstile), { once: true });
        existingScript.addEventListener('error', () => reject(new Error('Turnstile failed to load.')), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.id = scriptId;
      script.async = true;
      script.defer = true;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.onload = () => resolve(window.turnstile);
      script.onerror = () => reject(new Error('Turnstile failed to load.'));
      document.head.appendChild(script);
    });
  }

  return turnstilePromise;
}

export default function CaptchaBox({ challenge, answer, onAnswerChange, onRefresh }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [status, setStatus] = useState(shouldUseTurnstile() ? 'loading' : 'math');

  useEffect(() => {
    if (!shouldUseTurnstile()) return undefined;

    let mounted = true;
    setStatus('loading');
    onAnswerChange('');

    loadTurnstile()
      .then((turnstile) => {
        if (!mounted || !containerRef.current) return;

        if (widgetIdRef.current) {
          turnstile.reset(widgetIdRef.current);
        } else {
          widgetIdRef.current = turnstile.render(containerRef.current, {
            sitekey: captchaConfig.turnstilePublicKey,
            theme: 'light',
            callback: (token) => onAnswerChange(token),
            'expired-callback': () => onAnswerChange(''),
            'error-callback': () => onAnswerChange('')
          });
        }

        setStatus('ready');
      })
      .catch(() => {
        if (mounted) setStatus('error');
      });

    return () => {
      mounted = false;
    };
  }, [challenge?.refreshId, onAnswerChange]);

  if (shouldUseTurnstile()) {
    return (
      <View style={styles.turnstileBox}>
        <View style={styles.textWrap}>
          <Text style={styles.label}>Captcha</Text>
          <Text style={styles.question}>
            {status === 'error' ? 'Verification could not load.' : 'Complete the verification.'}
          </Text>
        </View>
        <View style={styles.turnstileWrap}>
          {status === 'loading' && <ActivityIndicator color={theme.colors.warning} />}
          <View ref={containerRef} style={styles.turnstileWidget} />
        </View>
        <Pressable
          style={styles.refresh}
          onPress={() => {
            if (widgetIdRef.current && typeof window !== 'undefined') {
              window.turnstile?.reset(widgetIdRef.current);
            }
            onAnswerChange('');
            onRefresh?.();
          }}
        >
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <View style={styles.textWrap}>
        <Text style={styles.label}>Captcha</Text>
        <Text style={styles.question}>{challenge?.question || 'Loading challenge...'}</Text>
      </View>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        value={answer}
        onChangeText={onAnswerChange}
        placeholder="Answer"
      />
      <Pressable style={styles.refresh} onPress={onRefresh}>
        <Text style={styles.refreshText}>Refresh</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFF8E8',
    borderWidth: 1,
    borderColor: 'rgba(237, 108, 2, 0.22)',
    borderRadius: 8,
    padding: 12
  },
  textWrap: {
    flex: 1
  },
  label: {
    color: theme.colors.warning,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase'
  },
  question: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2
  },
  input: {
    width: 82,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(237, 108, 2, 0.26)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlign: 'center',
    color: theme.colors.text,
    fontWeight: '700'
  },
  refresh: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: theme.colors.warning
  },
  refreshText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800'
  },
  turnstileBox: {
    alignItems: 'stretch',
    gap: 10,
    backgroundColor: '#FFF8E8',
    borderWidth: 1,
    borderColor: 'rgba(237, 108, 2, 0.22)',
    borderRadius: 8,
    padding: 12
  },
  turnstileWrap: {
    minHeight: 66,
    justifyContent: 'center'
  },
  turnstileWidget: {
    minHeight: 66
  }
});
