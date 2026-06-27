import * as LegacyFS from 'expo-file-system/legacy';
import { Share } from 'react-native';
import type { NoteEvent } from './recorder';
import { encodeSMF, toBase64 } from './smf';

// Encode the recorded events to a .mid file in the app's document directory,
// then open the iOS share sheet (which includes AirDrop). Returns false if
// there was nothing to export.
export async function exportAndShare(events: NoteEvent[]): Promise<boolean> {
  if (events.length === 0) return false;

  const bytes = encodeSMF(events);
  const name = `clip-${Date.now()}.mid`;
  const uri = `${LegacyFS.documentDirectory}${name}`;

  await LegacyFS.writeAsStringAsync(uri, toBase64(bytes), {
    encoding: LegacyFS.EncodingType.Base64,
  });

  // On iOS, a file:// url opens UIActivityViewController with AirDrop available.
  await Share.share({ url: uri });
  return true;
}
