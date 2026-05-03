import React from 'react';
import { Image, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { theme } from '../constants/theme';

export default function AppShell({ title, subtitle, children }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Image source={require('../assets/airesq_dark.png')} style={styles.logo} resizeMode="contain" />
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
      </View>
      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.colors.background
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  logo: {
    width: 42,
    height: 42
  },
  headerText: {
    flex: 1
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700'
  },
  subtitle: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    marginTop: 2
  },
  body: {
    flex: 1
  }
});
