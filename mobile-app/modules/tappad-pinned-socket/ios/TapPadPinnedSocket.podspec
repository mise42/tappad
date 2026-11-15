Pod::Spec.new do |s|
  s.name           = 'TapPadPinnedSocket'
  s.version        = '0.1.0'
  s.summary        = 'WebSocket to a TapPad Host pinned to its certificate fingerprint'
  s.description    = s.summary
  s.license        = 'MIT'
  s.author         = 'TapPad'
  s.homepage       = 'https://github.com/miselabs/tappad'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/miselabs/tappad.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
