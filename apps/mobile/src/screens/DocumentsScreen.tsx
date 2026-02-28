import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function DocumentsScreen() {
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Documents</Text>
      </View>

      <View style={styles.centered}>
        <Ionicons name="document-text-outline" size={56} color="#d1d5db" />
        <Text style={styles.title}>Document Processing</Text>
        <Text style={styles.subtitle}>
          Upload documents to summarize or ask questions.{'\n'}Coming soon.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: '#4f46e5',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#111827' },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
  },
});
