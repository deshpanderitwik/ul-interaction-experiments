import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

// Resolve once. Wrapped in try/catch so a missing/old native module can never
// crash the bundle — we just fall back to the painted capsule below.
let LIQUID_GLASS = false;
try {
  LIQUID_GLASS = isLiquidGlassAvailable();
} catch {
  LIQUID_GLASS = false;
}

type Props = {
  onPress?: () => void;
  disabled?: boolean;
  children: ReactNode;
  /** extra style on the bubble — e.g. force a perfect circle for icon buttons */
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/**
 * A header button wrapped in an iOS 26 Liquid Glass bubble, drawn in JS.
 *
 * We render the glass ourselves instead of letting the native stack header do
 * it, because the native nav bar plays a bright entrance "bloom" on every push
 * — the white flash behind the buttons on arrival. Mounting our own GlassView
 * shows the bubble already settled, with no bloom.
 *
 * GlassView falls back to a plain View off iOS 26, so we paint a subtle
 * translucent capsule underneath for that case. Note: GlassView stops rendering
 * if opacity hits 0 on it or any parent, so we never animate the bubble's
 * opacity (icon fade-ins live in sibling views, and press feedback comes from
 * the glass's own `isInteractive` highlight rather than a dimming overlay).
 */
export default function GlassButton({
  onPress,
  disabled,
  children,
  style,
  accessibilityLabel,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[styles.bubble, style]}
    >
      {LIQUID_GLASS ? (
        <GlassView
          style={StyleSheet.absoluteFill}
          glassEffectStyle="regular"
          colorScheme="dark"
          isInteractive
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallback]} />
      )}
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bubble: {
    minWidth: 36,
    height: 36,
    borderRadius: 18,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fallback: { backgroundColor: 'rgba(255, 255, 255, 0.08)' },
});
