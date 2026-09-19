import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '../theme';

const ARTWORK = require('../../assets/chaos-coordinated-intro.jpg');

const absoluteFill = { position: 'absolute' as const, top: 0, right: 0, bottom: 0, left: 0 };\n\nconst ASSEMBLY_MS = 900;
const HOLD_MS = 2000;
const EXIT_MS = 340;

type Fragment = {
  x: number;
  y: number;
  size: number;
  color: string;
  rotation: number;
};

const FRAGMENTS: Fragment[] = [
  { x: -154, y: -82, size: 5, color: '#54E4DA', rotation: -32 },
  { x: -142, y: -66, size: 9, color: '#13CFC4', rotation: 18 },
  { x: -132, y: -50, size: 6, color: '#F4FBFF', rotation: -16 },
  { x: -162, y: -35, size: 7, color: '#20D7CE', rotation: 34 },
  { x: -145, y: -22, size: 12, color: '#77EEE7', rotation: 4 },
  { x: -127, y: -8, size: 7, color: '#ECFBFF', rotation: -40 },
  { x: -169, y: 4, size: 6, color: '#11D1C7', rotation: 20 },
  { x: -148, y: 16, size: 10, color: '#4AE1D8', rotation: 45 },
  { x: -129, y: 29, size: 5, color: '#F1FCFF', rotation: -12 },
  { x: -160, y: 42, size: 8, color: '#2ADBD1', rotation: 14 },
  { x: -143, y: 57, size: 13, color: '#79EEE7', rotation: 45 },
  { x: -122, y: 70, size: 6, color: '#0CCBC1', rotation: -34 },
  { x: -171, y: 84, size: 5, color: '#E8FBFF', rotation: 20 },
  { x: -150, y: 96, size: 8, color: '#38DED4', rotation: -15 },
  { x: -131, y: 108, size: 5, color: '#7BF0E8', rotation: 32 },
];

function PixelFragment({
  fragment,
  index,
  started,
  screenWidth,
  screenHeight,
}: {
  fragment: Fragment;
  index: number;
  started: boolean;
  screenWidth: number;
  screenHeight: number;
}) {
  const progress = useSharedValue(0);
  const scaleX = Math.min(Math.max(screenWidth / 390, 0.82), 1.28);
  const scaleY = Math.min(Math.max(screenHeight / 844, 0.82), 1.28);
  const targetX = fragment.x * scaleX;
  const targetY = fragment.y * scaleY;
  const startX = -screenWidth * 0.66 - index * 4;
  const startY = targetY + ((index % 5) - 2) * 34;

  useEffect(() => {
    if (!started) return;
    progress.value = withDelay(
      index * 34,
      withTiming(1, {
        duration: 520 + (index % 4) * 55,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [index, progress, started]);

  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: Math.min(1, p * 1.45),
      transform: [
        { translateX: startX + (targetX - startX) * p },
        { translateY: startY + (targetY - startY) * p },
        { scale: 0.38 + 0.62 * p },
        { rotateZ: `${fragment.rotation * (1 - p)}deg` },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.pixel,
        {
          width: fragment.size,
          height: fragment.size,
          backgroundColor: fragment.color,
        },
        animatedStyle,
      ]}
    />
  );
}

export function BrandedIntro({
  onReady,
  onComplete,
}: {
  onReady: () => void | Promise<void>;
  onComplete: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const [layoutReady, setLayoutReady] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [started, setStarted] = useState(false);
  const signaledReady = useRef(false);
  const assemble = useSharedValue(0);
  const scan = useSharedValue(0);
  const exit = useSharedValue(0);

  useEffect(() => {
    if (!layoutReady || !imageReady || signaledReady.current) return;
    signaledReady.current = true;
    let active = true;

    Promise.resolve(onReady())
      .catch(() => undefined)
      .finally(() => {
        if (active) setStarted(true);
      });

    return () => {
      active = false;
    };
  }, [imageReady, layoutReady, onReady]);

  useEffect(() => {
    if (!started) return;

    assemble.value = withTiming(1, {
      duration: ASSEMBLY_MS,
      easing: Easing.out(Easing.cubic),
    });
    scan.value = withTiming(1, {
      duration: ASSEMBLY_MS - 80,
      easing: Easing.inOut(Easing.quad),
    });

    const exitTimer = setTimeout(() => {
      exit.value = withTiming(1, {
        duration: EXIT_MS,
        easing: Easing.inOut(Easing.quad),
      });
    }, ASSEMBLY_MS + HOLD_MS);

    const completeTimer = setTimeout(onComplete, ASSEMBLY_MS + HOLD_MS + EXIT_MS);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(completeTimer);
    };
  }, [assemble, exit, onComplete, scan, started]);

  const rootStyle = useAnimatedStyle(() => ({
    opacity: 1 - exit.value,
    transform: [{ scale: 1 - exit.value * 0.008 }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: 0.46 - assemble.value * 0.18,
    transform: [{ scale: 1.09 - assemble.value * 0.025 }],
  }));

  const artworkStyle = useAnimatedStyle(() => ({
    opacity: 0.24 + assemble.value * 0.76,
    transform: [{ scale: 1.025 - assemble.value * 0.025 }],
  }));

  const scanStyle = useAnimatedStyle(() => ({
    opacity: scan.value < 0.96 ? 0.78 : Math.max(0, (1 - scan.value) * 20),
    transform: [{ translateY: -16 + (height + 32) * scan.value }],
  }));

  return (
    <Animated.View
      onLayout={() => setLayoutReady(true)}
      pointerEvents="auto"
      style={[styles.root, rootStyle]}
    >
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Image
          source={ARTWORK}
          resizeMode="cover"
          blurRadius={12}
          style={styles.fill}
        />
      </Animated.View>

      <View style={styles.scrim} />

      <Animated.View style={[styles.artwork, artworkStyle]}>
        <Image
          source={ARTWORK}
          resizeMode="contain"
          onLoadEnd={() => setImageReady(true)}
          onError={() => setImageReady(true)}
          style={styles.fill}
        />
      </Animated.View>

      <View pointerEvents="none" style={styles.pixelAnchor}>
        {FRAGMENTS.map((fragment, index) => (
          <PixelFragment
            key={`${fragment.x}-${fragment.y}`}
            fragment={fragment}
            index={index}
            started={started}
            screenWidth={width}
            screenHeight={height}
          />
        ))}
      </View>

      <Animated.View pointerEvents="none" style={[styles.scanLine, scanStyle]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...absoluteFill,
    backgroundColor: '#06131F',
    elevation: 1000,
    overflow: 'hidden',
    zIndex: 1000,
  },
  fill: {
    height: '100%',
    width: '100%',
  },
  backdrop: {
    ...absoluteFill,
  },
  artwork: {
    ...absoluteFill,
  },
  scrim: {
    ...absoluteFill,
    backgroundColor: 'rgba(3, 12, 20, 0.16)',
  },
  pixelAnchor: {
    left: '50%',
    position: 'absolute',
    top: '39.5%',
  },
  pixel: {
    borderRadius: 1.5,
    position: 'absolute',
    shadowColor: colors.tealBright,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.32,
    shadowRadius: 5,
  },
  scanLine: {
    backgroundColor: 'rgba(83, 232, 222, 0.78)',
    height: 2,
    left: '8%',
    position: 'absolute',
    top: 0,
    width: '84%',
    shadowColor: colors.tealBright,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.72,
    shadowRadius: 8,
  },
});
