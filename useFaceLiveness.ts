import {useEffect, useRef, useState} from 'react';

// 1. Define explicit steps for the UI flow
export enum LivenessStep {
  BLINK = 'BLINK',
  TURN = 'TURN',
  VERIFYING = 'VERIFYING',
  SUCCESS = 'SUCCESS',
}

export type FaceLandmark = { x: number; y: number; z?: number; };

// 2. Constants for logic tuning
const LEFT_EYE = [33, 160, 158, 133, 153, 144] as const;
const RIGHT_EYE = [362, 385, 387, 263, 373, 380] as const;
const NOSE_TIP = 1;
const LEFT_CHEEK = 234;
const RIGHT_CHEEK = 454;
const REQUIRED_MAX_INDEX = 454;

export function useFaceLiveness(landmarks: FaceLandmark[] | null) {
  const [step, setStep] = useState<LivenessStep>(LivenessStep.BLINK);
  const [promptText, setPromptText] = useState('Please blink your eyes');

  // Refs for tracking detection without re-renders
  const blinkStartRef = useRef<number | null>(null);
  const hasBlinkedRef = useRef(false);
  const hasTurnedRef = useRef(false);

  useEffect(() => {
    if (!landmarks || landmarks.length <= REQUIRED_MAX_INDEX) return;

    if (step === LivenessStep.BLINK) {
      const ear = calculateAverageEAR(landmarks);
      const now = Date.now();

      // Detection Logic: EAR drops < 0.2
      if (ear < 0.2) {
        if (!blinkStartRef.current) blinkStartRef.current = now;
      } else if (blinkStartRef.current) {
        // If eyes opened within 50-400ms, it's a valid blink
        const duration = now - blinkStartRef.current;
        if (duration > 50) {
          hasBlinkedRef.current = true;
          setStep(LivenessStep.TURN);
          setPromptText('Now turn your head slightly');
        }
        blinkStartRef.current = null;
      }
    } 
    
    else if (step === LivenessStep.TURN) {
      const yaw = Math.abs(calculateYawRatio(landmarks));
      // Detection Logic: Significant deviation from center
      if (yaw > 0.15) {
        hasTurnedRef.current = true;
        setStep(LivenessStep.VERIFYING);
        setPromptText('Verifying identity...');
      }
    }
  }, [landmarks, step]);

  return { step, promptText, isVerifying: step === LivenessStep.VERIFYING };
}

// Math Helpers (Kept for precision)
function distance2D(a: FaceLandmark, b: FaceLandmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function calculateEAR(landmarks: FaceLandmark[], indices: readonly number[]) {
  const v1 = distance2D(landmarks[indices[1]], landmarks[indices[5]]);
  const v2 = distance2D(landmarks[indices[2]], landmarks[indices[4]]);
  const h = distance2D(landmarks[indices[0]], landmarks[indices[3]]);
  return h === 0 ? 0 : (v1 + v2) / (2.0 * h);
}

function calculateAverageEAR(landmarks: FaceLandmark[]) {
  return (calculateEAR(landmarks, LEFT_EYE) + calculateEAR(landmarks, RIGHT_EYE)) * 0.5;
}

function calculateYawRatio(landmarks: FaceLandmark[]) {
  const nose = landmarks[NOSE_TIP];
  const left = landmarks[LEFT_CHEEK];
  const right = landmarks[RIGHT_CHEEK];
  const leftDist = distance2D(nose, left);
  const rightDist = distance2D(nose, right);
  const denom = leftDist + rightDist;
  return denom === 0 ? 0 : (rightDist - leftDist) / denom;
}