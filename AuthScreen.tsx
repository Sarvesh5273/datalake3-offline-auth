// @ts-nocheck
import React, {useCallback, useEffect, useRef, useState} from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { scanFaces } from 'react-native-vision-camera-face-detector';
import { runOnJS } from 'react-native-reanimated';
import { LivenessStep, useFaceLiveness } from './useFaceLiveness';

export default function AuthScreen() {
  const cameraRef = useRef<Camera>(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const [landmarks, setLandmarks] = useState(null);

  // FSM Hook
  const { step, promptText, isVerifying } = useFaceLiveness(landmarks);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  const onLandmarks = useCallback((nextLandmarks) => {
    setLandmarks(nextLandmarks);
  }, []);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    const faces = scanFaces(frame);
    if (faces && faces.length > 0) {
      runOnJS(onLandmarks)(faces[0].landmarks);
    }
  }, [onLandmarks]);

  if (!device) return <ActivityIndicator color="#fff" style={StyleSheet.absoluteFill} />;
  if (!hasPermission) return <Text style={styles.infoText}>Camera permission required.</Text>;

  return (
    <View style={styles.container}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        photo={true}
        frameProcessor={frameProcessor}
        pixelFormat="native"
      />
      
      <View style={styles.overlay}>
        <View style={styles.instructionCard}>
          <Text style={styles.promptText}>{promptText}</Text>
          {isVerifying && <ActivityIndicator color="#000" size="small" />}
        </View>

        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: step === LivenessStep.BLINK ? '33%' : step === LivenessStep.TURN ? '66%' : '100%' }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  overlay: { position: 'absolute', bottom: 50, left: 24, right: 24, alignItems: 'center' },
  instructionCard: { backgroundColor: 'white', padding: 20, borderRadius: 15, alignItems: 'center', width: '100%' },
  promptText: { color: '#000', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  infoText: { color: '#fff', fontSize: 16, textAlign: 'center' },
  progressBar: { width: '100%', height: 8, backgroundColor: '#333', borderRadius: 4, marginTop: 20 },
  progressFill: { height: 8, backgroundColor: '#4CAF50', borderRadius: 4 },
});