import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';

import { activeAlerts, useStore } from '@/lib/store';
import { color, font } from '@/lib/theme';

export default function TabsLayout() {
  const { state } = useStore();
  const live = activeAlerts(state).length;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.red,
        tabBarInactiveTintColor: color.inkSoft,
        tabBarStyle: { backgroundColor: color.white, borderTopColor: color.line },
        tabBarLabelStyle: { fontFamily: font.semibold, fontSize: 11 },
        sceneStyle: { backgroundColor: color.paper },
      }}>
      <Tabs.Screen
        name="today"
        options={{
          title: 'Today',
          tabBarIcon: ({ color: c, focused }) => <Ionicons name={focused ? 'shield-checkmark' : 'shield-checkmark-outline'} size={24} color={c as string} />,
        }}
      />
      <Tabs.Screen
        name="home"
        options={{
          title: 'My Home',
          tabBarIcon: ({ color: c, focused }) => <Ionicons name={focused ? 'home' : 'home-outline'} size={24} color={c as string} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Alerts',
          tabBarBadge: live ? live : undefined,
          tabBarBadgeStyle: { backgroundColor: color.red, fontFamily: font.bold, fontSize: 11 },
          tabBarIcon: ({ color: c, focused }) => <Ionicons name={focused ? 'notifications' : 'notifications-outline'} size={24} color={c as string} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color: c, focused }) => <Ionicons name={focused ? 'person-circle' : 'person-circle-outline'} size={26} color={c as string} />,
        }}
      />
    </Tabs>
  );
}
