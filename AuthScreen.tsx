// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, NativeModules, StyleSheet, Text, View } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { LivenessStep, useFaceLiveness } from './useFaceLiveness';

const { FacialAuth } = NativeModules;

export default function AuthScreen() {
  const cameraRef = useRef(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const [landmarks, setLandmarks] = useState(null);
  const isProcessing = useRef(false);
  const { step, promptText, isVerifying } = useFaceLiveness(landmarks);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    if (!hasPermission || !device) return;
    if (step === LivenessStep.SUCCESS) return; // stop once done

    const interval = setInterval(async () => {
      if (!cameraRef.current || isProcessing.current) return;
      isProcessing.current = true;
      try {
        const photo = await cameraRef.current.takePhoto({ flash: 'off' });
        const result = await FacialAuth.detectLandmarks(photo.path);
        if (result && Array.isArray(result)) setLandmarks(result);
      } catch (_) {}
      finally { isProcessing.current = false; }
    }, 150); // ~6fps

    return () => clearInterval(interval);
  }, [hasPermission, device, step]);

  if (!device) return (
    <View style={styles.container}>
      <ActivityIndicator color="#fff" size="large" />
      <Text style={styles.infoText}>Loading camera...</Text>
    </View>
  );
  if (!hasPermission) return (
    <View style={styles.container}>
      <Text style={styles.infoText}>Camera permission required.</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <Camera ref={cameraRef} style={StyleSheet.absoluteFill}
        device={device} isActive={true} photo={true} pixelFormat="native" />
      <View style={styles.overlay}>
        <View style={styles.instructionCard}>
          <Text style={styles.promptText}>{promptText}</Text>
          {isVerifying && <ActivityIndicator color="#000" size="small" />}
        </View>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill,
            { width: step === LivenessStep.BLINK ? '33%' : step === LivenessStep.TURN ? '66%' : '100%' }
          ]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  overlay: { position: 'absolute', bottom: 50, left: 24, right: 24, alignItems: 'center' },
  instructionCard: { backgroundColor: 'white', padding: 20, borderRadius: 15, alignItems: 'center', width: '100%' },
  promptText: { color: '#000', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  infoText: { color: '#fff', fontSize: 16, textAlign: 'center', marginTop: 12 },
  progressBar: { width: '100%', height: 8, backgroundColor: '#333', borderRadius: 4, marginTop: 20 },
  progressFill: { height: 8, backgroundColor: '#4CAF50', borderRadius: 4 },
});