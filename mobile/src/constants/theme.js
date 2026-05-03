import { Platform } from 'react-native';

export const theme = {
  colors: {
    primary: '#25394F',
    secondary: '#20545B',
    accent: '#155A7C',
    accentLight: '#5CADBA',
    background: '#F0F8FB',
    surface: '#FFFFFF',
    border: '#49879A',
    mutedBorder: 'rgba(73, 135, 154, 0.22)',
    text: '#25394F',
    textSecondary: '#4F4F51',
    muted: '#7A8A9A',
    success: '#2E7D32',
    warning: '#ED6C02',
    danger: '#D32F2F',
    info: '#155A7C'
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32
  },
  radius: {
    sm: 4,
    md: 8,
    lg: 12
  },
  shadow: Platform.select({
    web: {
      boxShadow: '0 6px 12px rgba(37, 57, 79, 0.12)'
    },
    default: {
      shadowColor: '#25394F',
      shadowOpacity: 0.12,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 4
    }
  })
};
