import React from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import AuthScreen from './AuthScreen'; // Assuming AuthScreen is in the same directory

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <AuthScreen />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
});