# TapPad Mobile App

Expo/React Native shell for discovering nearby TapPad Desktop Hosts over DNS-SD and opening the existing Mobile Input Surface.

## Development

mDNS uses native iOS and Android APIs, so this app does not run in Expo Go. Build a development client instead:

```sh
npm install
npm run ios
```

For Android, connect a physical device and run `npm run android`. Physical devices are the reliable validation target because emulator networking commonly does not forward multicast DNS traffic.

The app browses `_tappad._tcp.local`. A discovered host must still pass TapPad's token authorization before the credential is saved in the platform secure store. After a successful pairing, the app reconnects to that host automatically and loads the host-served control UI.
