import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { theme } from '../constants/theme';
import AdminScreen from '../screens/AdminScreen';
import ReportScreen from '../screens/ReportScreen';

const Tab = createBottomTabNavigator();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.colors.accent,
          tabBarInactiveTintColor: theme.colors.muted,
          tabBarStyle: {
            borderTopColor: theme.colors.mutedBorder,
            height: 62,
            paddingBottom: 8,
            paddingTop: 8
          },
          tabBarLabelStyle: {
            fontWeight: '800'
          }
        }}
      >
        <Tab.Screen name="Report" component={ReportScreen} />
        <Tab.Screen name="Admin" component={AdminScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
