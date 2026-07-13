import { useClock } from '@shopify/react-native-skia';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import PathExplorations from '../bodies/path-explorations';
import DrumSubdivisions from '../drums/subdivisions';
import { SharedClockProvider } from './clock';

// Combinations — several experiments running at once on ONE clock, with a bottom
// nav to flip which is on screen. The first combination pairs Path Explorations
// with drum Subdivisions.
//
// How "playing together" works: both experiments stay MOUNTED the whole time —
// only their visibility flips. Their audio runs on a setInterval that keeps
// ticking regardless of whether the view is shown, so the hidden one keeps
// sounding. And both read the host's single Skia clock (via SharedClockProvider)
// and anchor at its origin, so their grids are phase-locked — the drums and the
// path arps sit on the same pulse rather than drifting.

type Tab = { id: string; title: string };
const TABS: Tab[] = [
  { id: 'paths', title: 'Paths' },
  { id: 'drums', title: 'Drums' },
];

export default function PathsAndDrums() {
  // The one clock both experiments share. useClock is driven by a global frame
  // callback, so it advances whether or not a given layer is currently drawn.
  const clock = useClock();
  const [active, setActive] = useState<string>('paths');

  return (
    <SharedClockProvider value={clock}>
      <View style={styles.fill}>
        {/* Both mounted at once; the inactive layer is hidden (display:none) but
            keeps running its scheduler, so it keeps playing. */}
        <View
          style={[styles.layer, active === 'paths' ? styles.shown : styles.hidden]}
          pointerEvents={active === 'paths' ? 'auto' : 'none'}
        >
          <PathExplorations />
        </View>
        <View
          style={[styles.layer, active === 'drums' ? styles.shown : styles.hidden]}
          pointerEvents={active === 'drums' ? 'auto' : 'none'}
        >
          <DrumSubdivisions />
        </View>

        <BottomNav active={active} onSelect={setActive} />
      </View>
    </SharedClockProvider>
  );
}

// A small segmented control pinned to the bottom. Rendered last so it sits above
// both experiments' full-screen gesture layers.
function BottomNav({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={styles.navWrap} pointerEvents="box-none">
      <View style={styles.nav}>
        {TABS.map((t) => {
          const on = t.id === active;
          return (
            <Pressable
              key={t.id}
              onPress={() => onSelect(t.id)}
              style={[styles.navBtn, on ? styles.navBtnOn : null]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t.title}
            >
              <Text style={[styles.navText, on ? styles.navTextOn : null]}>{t.title}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  shown: {},
  hidden: { display: 'none' },
  // Bottom-center container; box-none lets touches fall through everywhere
  // except the pill itself.
  navWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 44,
    alignItems: 'center',
  },
  nav: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(16,16,18,0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    gap: 4,
  },
  navBtn: {
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 999,
  },
  navBtnOn: { backgroundColor: 'rgba(255,255,255,0.92)' },
  navText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  navTextOn: { color: '#0a0a0a' },
});
