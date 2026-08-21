import ExpoModulesCore
import CoreMIDI

// The MIDI seam, deliberately minimal: a virtual MIDI source (visible to other
// apps on-device and over IDAM/USB) plus the network MIDI session (so a laptop
// on the same Wi-Fi — e.g. Ableton via Audio MIDI Setup's Network session —
// can receive). JS gets note on/off, CC, and all-notes-off; sequencing stays
// in JS where it can iterate over the air.
public class MidiOutModule: Module {
  private var client = MIDIClientRef()
  private var source = MIDIEndpointRef()
  private var ready = false

  public func definition() -> ModuleDefinition {
    Name("MidiOut")

    // Create the virtual source (once) and enable the network session.
    // Resolves true when the source exists.
    AsyncFunction("enable") { () -> Bool in
      if !self.ready {
        MIDIClientCreate("ul-interaction-experiments" as CFString, nil, nil, &self.client)
        MIDISourceCreate(self.client, "ul-experiments out" as CFString, &self.source)
        self.ready = self.source != 0
      }
      let session = MIDINetworkSession.default()
      session.isEnabled = true
      session.connectionPolicy = .anyone
      return self.ready
    }

    Function("isEnabled") { () -> Bool in
      return self.ready
    }

    // channel 0–15, note 0–127, velocity 0–127.
    AsyncFunction("noteOn") { (channel: Int, note: Int, velocity: Int) in
      self.send([
        UInt8(0x90 | (channel & 0x0f)),
        UInt8(max(0, min(127, note))),
        UInt8(max(0, min(127, velocity))),
      ])
    }

    AsyncFunction("noteOff") { (channel: Int, note: Int) in
      self.send([
        UInt8(0x80 | (channel & 0x0f)),
        UInt8(max(0, min(127, note))),
        0,
      ])
    }

    // Control change: controller 0–127, value 0–127.
    AsyncFunction("cc") { (channel: Int, controller: Int, value: Int) in
      self.send([
        UInt8(0xb0 | (channel & 0x0f)),
        UInt8(max(0, min(127, controller))),
        UInt8(max(0, min(127, value))),
      ])
    }

    // CC 123: everything off on a channel (panic).
    AsyncFunction("allNotesOff") { (channel: Int) in
      self.send([UInt8(0xb0 | (channel & 0x0f)), 123, 0])
    }
  }

  private func send(_ bytes: [UInt8]) {
    guard ready else { return }
    var packetList = MIDIPacketList()
    let packet = MIDIPacketListInit(&packetList)
    _ = MIDIPacketListAdd(
      &packetList, MemoryLayout<MIDIPacketList>.size, packet, 0, bytes.count, bytes)
    MIDIReceived(source, &packetList)
  }
}
