import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

// The entire hello app: one centered greeting. Empty on purpose — this is the
// clean starting point to build a second app onto.
export default function Index() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Hello, world</Text>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  text: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '600',
  },
});
