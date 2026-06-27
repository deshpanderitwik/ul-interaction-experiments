import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

// Minimal app-wide toast. Call showToast('...') from anywhere; render <Toaster/>
// once at the root so it overlays every screen.

const listeners = new Set<(message: string) => void>();

export function showToast(message: string) {
  for (const l of listeners) l(message);
}

export function Toaster() {
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useSharedValue(0);
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onToast = (m: string) => {
      setMessage(m);
      opacity.value = withTiming(1, { duration: 180 });
      if (hideRef.current) clearTimeout(hideRef.current);
      hideRef.current = setTimeout(() => {
        opacity.value = withTiming(0, { duration: 320 });
      }, 1800);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
      if (hideRef.current) clearTimeout(hideRef.current);
    };
  }, [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (!message) return null;
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Animated.View style={[styles.toast, style]}>
        <Text style={styles.text}>{message}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', bottom: 90, left: 0, right: 0, alignItems: 'center' },
  toast: {
    backgroundColor: 'rgba(22,22,22,0.96)',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  text: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
