import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Sketch } from './types';

// San Francisco. Open-Meteo is free + keyless, so this fetches live on-device
// (the first sketch here to hit the network) — no API key, no native rebuild.
const SF = { lat: 37.7749, lon: -122.4194 };
const FORECAST_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${SF.lat}&longitude=${SF.lon}` +
  '&daily=weather_code,temperature_2m_max,temperature_2m_min,' +
  'precipitation_probability_max,wind_speed_10m_max' +
  '&temperature_unit=fahrenheit&wind_speed_unit=mph' +
  '&timezone=America%2FLos_Angeles&forecast_days=4';

const ACCENT = '#00d2a8';
const AMBER = '#ffb454';
const DIM = '#6a6a7b';

type Day = {
  date: string;
  code: number;
  hi: number;
  lo: number;
  precip: number; // % chance
  wind: number; // mph
};

type Forecast = {
  glyph: string;
  label: string;
};

// WMO weather codes → a glyph + short label. Grouped because Open-Meteo splits
// each condition into intensity buckets we don't need to distinguish here.
function describe(code: number): Forecast {
  if (code === 0) return { glyph: '☀️', label: 'Clear' };
  if (code === 1 || code === 2) return { glyph: '🌤️', label: 'Partly cloudy' };
  if (code === 3) return { glyph: '☁️', label: 'Overcast' };
  if (code === 45 || code === 48) return { glyph: '🌫️', label: 'Fog' };
  if (code >= 51 && code <= 57) return { glyph: '🌦️', label: 'Drizzle' };
  if (code >= 61 && code <= 67) return { glyph: '🌧️', label: 'Rain' };
  if (code >= 71 && code <= 77) return { glyph: '🌨️', label: 'Snow' };
  if (code >= 80 && code <= 82) return { glyph: '🌧️', label: 'Showers' };
  if (code >= 85 && code <= 86) return { glyph: '🌨️', label: 'Snow showers' };
  if (code >= 95) return { glyph: '⛈️', label: 'Thunderstorm' };
  return { glyph: '🌡️', label: 'Mild' };
}

// Turn the numbers into a short, opinionated packing list. SF logic: days can
// be mild but evenings cool off fast, and the wind/fog earn their own callouts.
function outfit(day: Day): { headline: string; items: string[] } {
  const items: string[] = [];
  const { hi, lo, precip, wind, code } = day;

  if (hi < 55) items.push('Warm coat');
  else if (hi < 63) items.push('Jacket or sweater');
  else if (hi < 72) items.push('Long-sleeve top');
  else items.push('T-shirt');

  if (hi >= 75) items.push('Shorts weather');
  else items.push('Long pants');

  // SF nights bite — flag a layer whenever the low drops well below the high.
  if (lo < 52 || hi - lo >= 14) items.push('Layer for the evening');

  if (precip >= 50) items.push('Umbrella + rain jacket');
  else if (precip >= 25) items.push('Pack a compact umbrella');

  if (wind >= 22) items.push('Windbreaker');

  if (code >= 45 && code <= 48) items.push('Light scarf for the fog');
  if (code === 0 && hi >= 65) items.push('Sunglasses');

  let headline: string;
  if (precip >= 50) headline = 'Dress for rain';
  else if (hi < 58) headline = 'Bundle up';
  else if (hi >= 75) headline = 'Keep it light';
  else if (hi - lo >= 14 || lo < 52) headline = 'Layer up';
  else headline = 'Easy, mild day';

  return { headline, items };
}

const weekday = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' });
const monthDay = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

function DayCard({ day, today }: { day: Day; today: boolean }) {
  const { glyph, label } = describe(day.code);
  const { headline, items } = outfit(day);

  return (
    <View style={[styles.card, today && styles.cardToday]}>
      <View style={styles.cardHead}>
        <View>
          <Text style={styles.day}>{today ? 'Today' : weekday(day.date)}</Text>
          <Text style={styles.date}>{monthDay(day.date)}</Text>
        </View>
        <View style={styles.glyphWrap}>
          <Text style={styles.glyph}>{glyph}</Text>
          <Text style={styles.cond}>{label}</Text>
        </View>
      </View>

      <View style={styles.stats}>
        <Text style={styles.temp}>
          {Math.round(day.hi)}°<Text style={styles.lo}> / {Math.round(day.lo)}°</Text>
        </Text>
        <View style={styles.meta}>
          <Text style={styles.metaItem}>💧 {day.precip}%</Text>
          <Text style={styles.metaItem}>🌬️ {Math.round(day.wind)} mph</Text>
        </View>
      </View>

      <Text style={styles.headline}>{headline}</Text>
      <View style={styles.items}>
        {items.map((it) => (
          <View key={it} style={styles.chip}>
            <Text style={styles.chipText}>{it}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function WeatherOutfit() {
  const insets = useSafeAreaInsets();
  const [days, setDays] = useState<Day[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(FORECAST_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const d = json.daily;
      const out: Day[] = d.time.map((date: string, i: number) => ({
        date,
        code: d.weather_code[i],
        hi: d.temperature_2m_max[i],
        lo: d.temperature_2m_min[i],
        precip: d.precipitation_probability_max[i] ?? 0,
        wind: d.wind_speed_10m_max[i],
      }));
      setDays(out);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {},
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load forecast');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
        () => {},
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    load();
  };

  return (
    <View style={styles.fill}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 32 },
        ]}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>NEXT 4 DAYS</Text>
            <Text style={styles.title}>San Francisco</Text>
          </View>
          <Pressable onPress={refresh} hitSlop={12} style={styles.refresh}>
            <Text style={styles.refreshText}>↻</Text>
          </Pressable>
        </View>

        {loading && !days && (
          <View style={styles.center}>
            <ActivityIndicator color={ACCENT} />
            <Text style={styles.muted}>Checking the forecast…</Text>
          </View>
        )}

        {error && !loading && (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={refresh} style={styles.retry} hitSlop={8}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        )}

        {days?.map((day, i) => (
          <DayCard key={day.date} day={day} today={i === 0} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#0b0b0f' },
  scroll: { paddingHorizontal: 18, gap: 14 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 4,
  },
  kicker: { color: ACCENT, fontSize: 12, fontWeight: '700', letterSpacing: 2 },
  title: { color: '#fff', fontSize: 30, fontWeight: '800', marginTop: 4 },
  refresh: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#15151d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshText: { color: ACCENT, fontSize: 22, fontWeight: '700' },
  center: { alignItems: 'center', gap: 12, paddingVertical: 60 },
  muted: { color: DIM, fontSize: 14 },
  errorText: { color: '#ff6b6b', fontSize: 15, textAlign: 'center' },
  retry: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: '#15151d',
  },
  retryText: { color: ACCENT, fontSize: 14, fontWeight: '700' },
  card: {
    backgroundColor: '#121219',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1e1e29',
    gap: 12,
  },
  cardToday: { borderColor: '#2a3f3a', backgroundColor: '#101a18' },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  day: { color: '#fff', fontSize: 20, fontWeight: '700' },
  date: { color: DIM, fontSize: 13, marginTop: 2 },
  glyphWrap: { alignItems: 'flex-end' },
  glyph: { fontSize: 34 },
  cond: { color: DIM, fontSize: 12, marginTop: 2 },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  temp: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  lo: { color: DIM, fontSize: 20, fontWeight: '600' },
  meta: { flexDirection: 'row', gap: 14 },
  metaItem: { color: '#9a9aab', fontSize: 13, fontVariant: ['tabular-nums'] },
  headline: { color: AMBER, fontSize: 15, fontWeight: '700' },
  items: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: '#1b1b25',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  chipText: { color: '#d8d8e2', fontSize: 13, fontWeight: '600' },
});

const sketch: Sketch = {
  id: 'weather-outfit',
  title: 'Weather → outfit',
  description:
    "SF's next 4 days from a live forecast, each with an opinionated what-to-wear list.",
  order: 90,
  Component: WeatherOutfit,
};

export default sketch;
