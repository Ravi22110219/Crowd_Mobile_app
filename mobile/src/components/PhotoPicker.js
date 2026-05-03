import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../constants/theme';

export default function PhotoPicker({ value, onChange }) {
  async function captureImage() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();

    if (permission.status !== 'granted') return;

    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });

    if (!result.canceled && result.assets?.[0]) {
      onChange(result.assets[0]);
    }
  }

  return (
    <View>
      <Text style={styles.label}>Photo Evidence *</Text>
      <View style={styles.row}>
        <Pressable style={styles.button} onPress={captureImage}>
          <Text style={styles.buttonText}>{value?.uri ? 'Retake Photo' : 'Capture Photo'}</Text>
        </Pressable>
      </View>
      {!!value?.uri && (
        <View style={styles.preview}>
          <Image source={{ uri: value.uri }} style={styles.image} />
          <Text style={styles.previewText} numberOfLines={1}>{value.fileName || 'Selected photo'}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8
  },
  row: {
    flexDirection: 'row',
    gap: 10
  },
  button: {
    flex: 1,
    backgroundColor: theme.colors.accent,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center'
  },
  buttonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13
  },
  preview: {
    marginTop: 12,
    backgroundColor: '#F8FCFD',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.mutedBorder,
    overflow: 'hidden'
  },
  image: {
    width: '100%',
    height: 170
  },
  previewText: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    padding: 10
  }
});
