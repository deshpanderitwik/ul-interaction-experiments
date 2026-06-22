import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';

// Empty starting point. A single full-screen black canvas — nothing on it yet.
// Build from here.
export default function Index() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
});
