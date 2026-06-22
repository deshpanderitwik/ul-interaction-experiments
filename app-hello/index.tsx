import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

// The entire hello app: one centered greeting. Empty on purpose — this is the
// clean starting point to build a second app onto.
export default function Index() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Hello from your phone ⚡</Text>
      <Text style={styles.subtitle}>This line shipped over-the-air</Text>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a12',
  },
  text: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '600',
  },
  subtitle: {
    color: '#7aa2ff',
    fontSize: 15,
    marginTop: 10,
  },
});
