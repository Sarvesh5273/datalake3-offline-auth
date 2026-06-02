import {useEffect, useRef, useState} from 'react';

export type FaceLandmark = {
  x: number;
  y: number;
  z?: number;
};

export type LivenessOptions = {
  earThreshold?: number;
  blinkWindowMs?: number;
  yawRatioThreshold?: number;
  timestampMs?: number;
};

export type LivenessResult = {
  isLive: boolean;
  promptText: string;
};

const LEFT_EYE = [33, 160, 158, 133, 153, 144] as const;
const RIGHT_EYE = [362, 385, 387, 263, 373, 380] as const;
const NOSE_TIP = 1;
const LEFT_CHEEK = 234;
const RIGHT_CHEEK = 454;

const DEFAULT_EAR_THRESHOLD = 0.2;
const DEFAULT_BLINK_WINDOW_MS = 400;
const DEFAULT_YAW_RATIO_THRESHOLD = 0.08;
const REQUIRED_MAX_INDEX = 454;

const PROMPT_BLINK = 'Blink now';
const PROMPT_TURN = 'Turn head slightly';
const PROMPT_LIVE = '';

export function calculateEAR(landmarks: FaceLandmark[], indices: readonly number[]): number {
  const p1 = landmarks[indices[0]];
  const p2 = landmarks[indices[1]];
  const p3 = landmarks[indices[2]];
  const p4 = landmarks[indices[3]];
  const p5 = landmarks[indices[4]];
  const p6 = landmarks[indices[5]];

  const v1 = distance2D(p2, p6);
  const v2 = distance2D(p3, p5);
  const h = distance2D(p1, p4);

  if (h === 0) {
    return 0;
  }
  return (v1 + v2) / (2.0 * h);
}

export function calculateAverageEAR(landmarks: FaceLandmark[]): number {
  const left = calculateEAR(landmarks, LEFT_EYE);
  const right = calculateEAR(landmarks, RIGHT_EYE);
  return (left + right) * 0.5;
}

export function calculateYawRatio(landmarks: FaceLandmark[]): number {
  const nose = landmarks[NOSE_TIP];
  const left = landmarks[LEFT_CHEEK];
  const right = landmarks[RIGHT_CHEEK];

  const leftDist = distance2D(nose, left);
  const rightDist = distance2D(nose, right);
  const denom = leftDist + rightDist;
  if (denom === 0) {
    return 0;
  }
  return (rightDist - leftDist) / denom;
}

export function useFaceLiveness(
  landmarks: FaceLandmark[] | null,
  options: LivenessOptions = {},
): LivenessResult {
  const earThreshold = options.earThreshold ?? DEFAULT_EAR_THRESHOLD;
  const blinkWindowMs = options.blinkWindowMs ?? DEFAULT_BLINK_WINDOW_MS;
  const yawRatioThreshold = options.yawRatioThreshold ?? DEFAULT_YAW_RATIO_THRESHOLD;
  const timestampMs = options.timestampMs;

  const [isLive, setIsLive] = useState(false);
  const [promptText, setPromptText] = useState(PROMPT_BLINK);

  const blinkStartMsRef = useRef(0);
  const blinkDetectedRef = useRef(false);
  const headTurnDetectedRef = useRef(false);
  const liveRef = useRef(false);
  const promptRef = useRef(PROMPT_BLINK);

  useEffect(() => {
    if (!landmarks || landmarks.length <= REQUIRED_MAX_INDEX) {
      blinkStartMsRef.current = 0;
      blinkDetectedRef.current = false;
      headTurnDetectedRef.current = false;
      updateState(false, PROMPT_BLINK);
      return;
    }

    const now = timestampMs ?? Date.now();
    const ear = calculateAverageEAR(landmarks);

    if (ear < earThreshold) {
      if (blinkStartMsRef.current === 0) {
        blinkStartMsRef.current = now;
      } else if (now - blinkStartMsRef.current > blinkWindowMs) {
        blinkStartMsRef.current = now;
      }
    } else if (blinkStartMsRef.current > 0) {
      const duration = now - blinkStartMsRef.current;
      if (duration <= blinkWindowMs) {
        blinkDetectedRef.current = true;
      }
      blinkStartMsRef.current = 0;
    }

    const yawRatio = Math.abs(calculateYawRatio(landmarks));
    if (yawRatio >= yawRatioThreshold) {
      headTurnDetectedRef.current = true;
    }

    const liveNow = blinkDetectedRef.current && headTurnDetectedRef.current;
    let nextPrompt = PROMPT_LIVE;
    if (!blinkDetectedRef.current) {
      nextPrompt = PROMPT_BLINK;
    } else if (!headTurnDetectedRef.current) {
      nextPrompt = PROMPT_TURN;
    }

    updateState(liveNow, nextPrompt);
  }, [landmarks, earThreshold, blinkWindowMs, yawRatioThreshold, timestampMs]);

  return {isLive, promptText};

  function updateState(nextLive: boolean, nextPrompt: string) {
    if (nextLive !== liveRef.current) {
      liveRef.current = nextLive;
      setIsLive(nextLive);
    }
    if (nextPrompt !== promptRef.current) {
      promptRef.current = nextPrompt;
      setPromptText(nextPrompt);
    }
  }
}

function distance2D(a: FaceLandmark, b: FaceLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}
