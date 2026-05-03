import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { referenceOptions } from '../constants/depth';
import { theme } from '../constants/theme';
import ReferenceIcon from './ReferenceIcon';

export default function ReferenceSelector({ value, onChange }) {
  return (
    <View>
      <Text style={styles.label}>Reference Object</Text>
      <View style={styles.row}>
        {referenceOptions.map((option) => {
          const selected = option.type === value;
          return (
            <Pressable
              key={option.type}
              style={[styles.option, selected && styles.optionSelected]}
              onPress={() => onChange(option.type)}
            >
              <ReferenceIcon type={option.type} selected={selected} />
              <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
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
    flexWrap: 'wrap',
    gap: 10
  },
  option: {
    alignItems: 'center',
    flexBasis: '30%',
    flexGrow: 1,
    gap: 6,
    minWidth: 108,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.mutedBorder,
    borderRadius: 8
  },
  optionSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: '#EAF6F8'
  },
  optionText: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600'
  },
  optionTextSelected: {
    color: theme.colors.accent
  }
});
