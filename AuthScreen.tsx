// @ts-nocheck
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  NativeModules,
  StyleSheet,
  Text,
  View,
} from 'react-native';
// @ts-ignore
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput, // V5 API
} from 'react-native-vision-camera';
import {useRunOnJS} from 'react-native-worklets-core';
import {FaceLandmark, useFaceLiveness} from './useFaceLiveness';

type FaceMeshResult = {
  landmarks: FaceLandmark[];
};

type FacialAuthNative = {
  verifyFace: (imagePath: string) => Promise<number[]>;
};

export default function AuthScreen() {
  const cameraRef = useRef<any>(null);
  const {hasPermission, requestPermission} = useCameraPermission();
  const device = useCameraDevice('front');

  const [landmarks, setLandmarks] = useState<FaceLandmark[] | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const {isLive, promptText} = useFaceLiveness(landmarks);

  const facialAuth = (NativeModules as {FacialAuth?: FacialAuthNative}).FacialAuth;
  const captureInFlightRef = useRef(false);
  const captureDoneRef = useRef(false);

  useEffect(() => {
    if (!hasPermission) {
      requestPermission().catch(error => {
        setErrorText(
          error instanceof Error ? error.message : 'Camera permission request failed.',
        );
      });
    }
  }, [hasPermission, requestPermission]);

  const onLandmarks = useCallback((nextLandmarks: FaceLandmark[]) => {
    setLandmarks(nextLandmarks);
  }, []);
  const onLandmarksWorklet = useRunOnJS(onLandmarks, [onLandmarks]);

  // V5 API FIX: Replaced useFrameProcessor with useFrameOutput
  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',
    onFrame: (frame: any) => {
      'worklet';
      try {
        if (typeof global.faceMesh === 'undefined') {
          return;
        }
        
        const result = global.faceMesh(frame) as FaceMeshResult | null;
        
        if (result && result.landmarks && result.landmarks.length > 0) {
          onLandmarksWorklet(result.landmarks);
        }
      } finally {
        // V5 STRICT REQUIREMENT: You MUST dispose the frame
        frame.dispose();
      }
    }
  });

  useEffect(() => {
    if (!isLive || captureInFlightRef.current || captureDoneRef.current) {
      return;
    }
    if (!facialAuth?.verifyFace) {
      setErrorText('FacialAuth native module is unavailable.');
      captureDoneRef.current = true;
      return;
    }

    captureInFlightRef.current = true;
    (async () => {
      const camera = cameraRef.current;
      if (!camera) {
        throw new Error('Camera not ready.');
      }
      const photo = await camera.takePhoto({skipMetadata: true});
      await facialAuth.verifyFace(photo.path);
    })()
      .catch(error => {
        setErrorText(error instanceof Error ? error.message : 'Verification failed.');
      })
      .finally(() => {
        captureInFlightRef.current = false;
        captureDoneRef.current = true;
      });
  }, [facialAuth, isLive]);

  if (!device) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View style={styles.centered}>
        <Text style={styles.infoText}>Camera permission required.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* @ts-ignore */}
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        photo={true}
        audio={false}
        outputs={[frameOutput]} // V5 API FIX: Replaced frameProcessor with outputs array
      />
      <View style={styles.overlay}>
        <Text style={styles.promptText}>{promptText}</Text>
        {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  overlay: {
    position: 'absolute',
    bottom: 48,
    left: 24,
    right: 24,
    alignItems: 'center',
  },
  promptText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: {width: -1, height: 1},
    textShadowRadius: 10,
  },
  errorText: {
    color: '#ff6b6b',
    marginTop: 8,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 4,
    borderRadius: 4,
  },
  infoText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
});
