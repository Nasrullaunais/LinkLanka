import { createNavigationContainerRef } from '@react-navigation/native';
import type { AppStackParamList } from './types';

/**
 * A root-level navigation ref that can be used to navigate from outside
 * the React component tree (e.g. from a background notification handler).
 *
 * Expo Router manages its own NavigationContainer, so we use this ref
 * only for imperative navigation from NotificationContext.
 */
export const navigationRef = createNavigationContainerRef<AppStackParamList>();
