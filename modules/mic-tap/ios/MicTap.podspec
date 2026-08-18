Pod::Spec.new do |s|
  s.name           = 'MicTap'
  s.version        = '1.0.0'
  s.summary        = 'Live microphone input tap streaming waveform frames to JS'
  s.description    = 'AVAudioEngine input tap that emits downsampled peak/RMS frames for rendering live waveforms.'
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
