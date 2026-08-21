Pod::Spec.new do |s|
  s.name           = 'MidiOut'
  s.version        = '1.0.0'
  s.summary        = 'Minimal CoreMIDI out: a virtual source + network session'
  s.description    = 'Sends note on/off and CC from JS through a virtual MIDI source; enables the network MIDI session so a laptop can receive.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
