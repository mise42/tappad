import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  beginGesture,
  centroid,
  LONG_PRESS_DELAY_MS,
  shouldBeginWindowMode,
  shouldTap,
  type GestureState,
  type Point,
} from './gestureState';
import {
  hostStateUrl,
  RELEASABLE_KEYS,
  releaseMessages,
  serializeMessage,
  socketUrl,
  type ActionCapabilities,
  type ConnectionState,
  type HostState,
  type TapPadMessage,
} from './protocol';

type Panel = 'pad' | 'keys' | 'actions' | 'media';

type Props = {
  host: string;
  hostName: string;
  port: number;
  token: string;
  onExit: () => void;
};

type TouchLike = { pageX: number; pageY: number };

const TABS: { id: Panel; label: string }[] = [
  { id: 'pad', label: 'Pad' },
  { id: 'keys', label: 'Keys' },
  { id: 'actions', label: 'Actions' },
  { id: 'media', label: 'Media' },
];

const KEY_ROWS = [
  [
    ['Esc', 'Escape'],
    ['Tab', 'Tab'],
    ['Enter', 'Enter'],
    ['⌫', 'Backspace'],
    ['PrtSc', 'PrintScreen'],
  ],
  [
    ['Super', 'MetaLeft'],
    ['Ctrl', 'ControlLeft'],
    ['Shift', 'ShiftLeft'],
    ['Alt', 'AltLeft'],
    ['Space', 'Space'],
  ],
  [
    ['↑', 'ArrowUp'],
    ['←', 'ArrowLeft'],
    ['↓', 'ArrowDown'],
    ['→', 'ArrowRight'],
  ],
  [
    ['A', 'KeyA'], ['C', 'KeyC'], ['V', 'KeyV'], ['X', 'KeyX'], ['Z', 'KeyZ'],
  ],
  [
    ['B', 'KeyB'], ['S', 'KeyS'], ['T', 'KeyT'], ['W', 'KeyW'], ['F', 'KeyF'],
  ],
  [
    ['1', 'Digit1'], ['2', 'Digit2'], ['3', 'Digit3'], ['4', 'Digit4'], ['5', 'Digit5'],
  ],
] as const;

const ACTION_GROUPS = [
  {
    title: 'Recording',
    actions: [
      ['Record screen', 'screenrecord.screen'],
      ['Record window', 'screenrecord.window'],
      ['Record + audio', 'screenrecord.screen.audio'],
      ['Record + camera', 'screenrecord.screen.webcam'],
      ['Stop recording', 'screenrecord.stop'],
      ['Open recordings', 'open_recordings_folder'],
    ],
  },
  {
    title: 'Desktop',
    actions: [
      ['Screenshot', 'screenshot'],
      ['Close window', 'close_window'],
      ['App launcher', 'app_launcher'],
      ['Lock screen', 'lock_screen'],
    ],
  },
] as const;

const MEDIA_ACTIONS = [
  ['⏮', 'Previous', 'media.prev'],
  ['▶', 'Play / pause', 'media.play_pause'],
  ['⏭', 'Next', 'media.next'],
  ['−', 'Volume down', 'media.volume_down'],
  ['⌁', 'Mute', 'media.mute'],
  ['＋', 'Volume up', 'media.volume_up'],
] as const;

function pointsFromTouches(touches: readonly TouchLike[]): Point[] {
  return Array.from(touches, (touch) => ({ x: touch.pageX, y: touch.pageY }));
}

function statusText(state: ConnectionState) {
  switch (state) {
    case 'connected': return 'Connected';
    case 'connecting': return 'Connecting…';
    case 'error': return 'Connection error';
    default: return 'Disconnected';
  }
}

export function NativeControlSurface({ host, hostName, port, token, onExit }: Props) {
  const [panel, setPanel] = useState<Panel>('pad');
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<ActionCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const mountedRef = useRef(true);
  const heldKeysRef = useRef(new Set<string>());

  const send = useCallback((message: TapPadMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(serializeMessage(message));
    return true;
  }, []);

  const releaseAll = useCallback(() => {
    for (const message of releaseMessages(heldKeysRef.current)) send(message);
    heldKeysRef.current.clear();
  }, [send]);

  const pressKey = useCallback((code: string) => {
    if (heldKeysRef.current.has(code)) return;
    if (send({ type: 'key', code, down: true })) heldKeysRef.current.add(code);
  }, [send]);

  const releaseKey = useCallback((code: string) => {
    if (!heldKeysRef.current.has(code)) return;
    send({ type: 'key', code, down: false });
    heldKeysRef.current.delete(code);
  }, [send]);

  const connectSocket = useCallback(() => {
    if (!mountedRef.current) return;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    socketRef.current?.close();
    setConnectionState('connecting');
    setConnectionError(null);

    const socket = new WebSocket(socketUrl(host, port, token));
    socketRef.current = socket;
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type?: string };
        if (message.type !== 'ready') return;
        reconnectAttemptRef.current = 0;
        setConnectionState('connected');
        setConnectionError(null);
        // Recover from an interrupted previous socket before accepting new input.
        for (const messageToSend of releaseMessages(RELEASABLE_KEYS)) {
          socket.send(serializeMessage(messageToSend));
        }
      } catch {
        setConnectionState('error');
        setConnectionError('The host returned an invalid response.');
      }
    };
    socket.onerror = () => {
      if (!mountedRef.current) return;
      setConnectionState('error');
      setConnectionError('Could not reach the desktop host.');
    };
    socket.onclose = () => {
      if (!mountedRef.current || socketRef.current !== socket) return;
      heldKeysRef.current.clear();
      setConnectionState('disconnected');
      const delay = Math.min(1_000 * 2 ** reconnectAttemptRef.current, 8_000);
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = setTimeout(connectSocket, delay);
    };
  }, [host, port, token]);

  useEffect(() => {
    mountedRef.current = true;
    connectSocket();
    return () => {
      releaseAll();
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [connectSocket, releaseAll]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') releaseAll();
    });
    return () => subscription.remove();
  }, [releaseAll]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(hostStateUrl(host, port), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Host returned HTTP ${response.status}.`);
        return response.json() as Promise<HostState>;
      })
      .then((state) => {
        setCapabilities(state.actions ?? {});
        setCapabilityError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setCapabilityError(cause instanceof Error ? cause.message : 'Action availability could not be loaded.');
      });
    return () => controller.abort();
  }, [host, port]);

  const switchPanel = useCallback((next: Panel) => {
    releaseAll();
    setNotice(null);
    setPanel(next);
  }, [releaseAll]);

  const sendAction = useCallback((label: string, action: string) => {
    const capability = capabilities?.[action];
    if (!capability) {
      setNotice(`${label} is unavailable because this host did not advertise the action.`);
      return;
    }
    if (capability.state !== 'supported') {
      setNotice(capability.note || `${label} is unavailable on this host.`);
      return;
    }
    if (!send({ type: 'cmd', action })) {
      setNotice(`${label} was not sent because TapPad is disconnected.`);
      return;
    }
    setNotice(`${label} sent to ${hostName}.`);
  }, [capabilities, hostName, send]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to hosts"
          onPress={() => { releaseAll(); onExit(); }}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>‹ Hosts</Text>
        </Pressable>
        <View style={styles.hostTitleWrap}>
          <Text style={styles.hostTitle} numberOfLines={1}>{hostName}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, connectionState === 'connected' && styles.statusDotReady]} />
            <Text style={styles.statusLabel}>{statusText(connectionState)}</Text>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Reconnect" onPress={connectSocket} style={styles.reconnectButton}>
          <Text style={styles.reconnectText}>↻</Text>
        </Pressable>
      </View>

      {connectionError ? <Text style={styles.bannerError}>{connectionError}</Text> : null}

      <View style={styles.tabBar}>
        {TABS.map((tab) => (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: panel === tab.id }}
            onPress={() => switchPanel(tab.id)}
            style={[styles.tab, panel === tab.id && styles.tabActive]}
          >
            <Text style={[styles.tabText, panel === tab.id && styles.tabTextActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.panelContainer}>
        {panel === 'pad' ? (
          <PadPanel
            send={send}
            pressKey={pressKey}
            releaseKey={releaseKey}
            connected={connectionState === 'connected'}
            setNotice={setNotice}
          />
        ) : null}
        {panel === 'keys' ? <KeysPanel pressKey={pressKey} releaseKey={releaseKey} releaseAll={releaseAll} /> : null}
        {panel === 'actions' ? (
          <ActionsPanel capabilities={capabilities} capabilityError={capabilityError} sendAction={sendAction} />
        ) : null}
        {panel === 'media' ? <MediaPanel sendAction={sendAction} /> : null}
      </View>

      {notice ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss message" onPress={() => setNotice(null)} style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

type PadProps = {
  send: (message: TapPadMessage) => boolean;
  pressKey: (code: string) => void;
  releaseKey: (code: string) => void;
  connected: boolean;
  setNotice: (message: string | null) => void;
};

function PadPanel({ send, pressKey, releaseKey, connected, setNotice }: PadProps) {
  const [text, setText] = useState('');
  const [windowMode, setWindowMode] = useState(false);
  const gestureRef = useRef<GestureState | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapAtRef = useRef(0);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }, []);

  const endGesture = useCallback((canceled: boolean) => {
    clearLongPress();
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture) return;

    if (gesture.mode === 'window') {
      releaseKey('MetaLeft');
      setWindowMode(false);
      return;
    }
    if (canceled || !shouldTap(gesture, Date.now())) return;

    const now = Date.now();
    if (now - lastTapAtRef.current < 320) {
      if (pendingTapTimerRef.current) clearTimeout(pendingTapTimerRef.current);
      pendingTapTimerRef.current = null;
      lastTapAtRef.current = 0;
      send({ type: 'click', button: 'left', clickCount: 2 });
      return;
    }
    lastTapAtRef.current = now;
    pendingTapTimerRef.current = setTimeout(() => {
      send({ type: 'click', button: 'left', clickCount: 1 });
      pendingTapTimerRef.current = null;
      lastTapAtRef.current = 0;
    }, 320);
  }, [clearLongPress, releaseKey, send]);

  useEffect(() => () => {
    clearLongPress();
    if (pendingTapTimerRef.current) clearTimeout(pendingTapTimerRef.current);
    if (gestureRef.current?.mode === 'window') releaseKey('MetaLeft');
  }, [clearLongPress, releaseKey]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => true,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (event) => {
      const points = pointsFromTouches(event.nativeEvent.touches);
      const point = points[0] ?? { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
      gestureRef.current = beginGesture(point, Date.now());
      clearLongPress();
      longPressTimerRef.current = setTimeout(() => {
        const gesture = gestureRef.current;
        if (!gesture || !shouldBeginWindowMode(gesture)) return;
        gesture.mode = 'window';
        pressKey('MetaLeft');
        // The stable protocol exposes an atomic click but no separate mouse-down.
        // Keep this best-effort sequence isolated and always pair the modifier release.
        send({ type: 'click', button: 'left', clickCount: 1 });
        setWindowMode(true);
      }, LONG_PRESS_DELAY_MS);
    },
    onPanResponderMove: (event) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      const points = pointsFromTouches(event.nativeEvent.touches);
      gesture.maxTouches = Math.max(gesture.maxTouches, points.length);

      if (points.length >= 2) {
        clearLongPress();
        if (gesture.mode === 'window') {
          releaseKey('MetaLeft');
          setWindowMode(false);
        }
        const next = centroid(points.slice(0, 2));
        if (gesture.mode !== 'scroll') {
          gesture.mode = 'scroll';
          gesture.last = next;
          return;
        }
        const dy = next.y - gesture.last.y;
        gesture.last = next;
        if (Math.abs(dy) > 0.5) send({ type: 'wheel', dy: -dy * 0.25 });
        return;
      }

      const next = points[0];
      if (!next) return;
      if (gesture.mode === 'scroll') {
        gesture.mode = 'pointer';
        gesture.last = next;
        return;
      }
      const dx = next.x - gesture.last.x;
      const dy = next.y - gesture.last.y;
      gesture.last = next;
      if (!shouldBeginWindowMode(gesture)) clearLongPress();
      if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
        send({ type: 'move', dx: dx * 1.25, dy: dy * 1.25 });
      }
    },
    onPanResponderRelease: () => endGesture(false),
    onPanResponderTerminate: () => endGesture(true),
  }), [clearLongPress, endGesture, pressKey, releaseKey, send]);

  const sendText = useCallback(() => {
    if (!text.trim()) return;
    if (!send({ type: 'text', value: text })) {
      setNotice('Text was not sent because TapPad is disconnected.');
      return;
    }
    setText('');
  }, [send, setNotice, text]);

  return (
    <KeyboardAvoidingView style={styles.padPanel} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View
        {...panResponder.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel="Touchpad. Move one finger for pointer, two fingers to scroll, long press to move a window."
        style={[styles.touchPad, !connected && styles.controlDisabled, windowMode && styles.touchPadWindowMode]}
      >
        <View style={styles.padGlow} />
        <Text style={styles.padTitle}>{windowMode ? 'WINDOW MODE' : 'TAPPAD'}</Text>
        <Text style={styles.padHint}>{windowMode ? 'Keep holding and move' : 'Move · Tap · Two-finger scroll'}</Text>
        <Text style={styles.padLongHint}>Long press: move window</Text>
      </View>

      <View style={styles.textRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          placeholder="Type or dictate text"
          placeholderTextColor="#707887"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.textInput}
        />
        <Pressable onPress={sendText} style={styles.sendButton}>
          <Text style={styles.sendButtonText}>Send</Text>
        </Pressable>
      </View>
      <View style={styles.quickKeys}>
        {[
          ['Super', 'MetaLeft'], ['Alt', 'AltLeft'], ['Ctrl', 'ControlLeft'], ['Shift', 'ShiftLeft'], ['Enter', 'Enter'], ['⌫', 'Backspace'],
        ].map(([label, code]) => (
          <KeyButton key={code} label={label} code={code} onDown={pressKey} onUp={releaseKey} compact />
        ))}
      </View>
    </KeyboardAvoidingView>
  );
}

function KeyButton({ label, code, onDown, onUp, compact = false }: {
  label: string;
  code: string;
  onDown: (code: string) => void;
  onUp: (code: string) => void;
  compact?: boolean;
}) {
  const [pressed, setPressed] = useState(false);
  const release = useCallback(() => {
    setPressed(false);
    onUp(code);
  }, [code, onUp]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPressIn={() => { setPressed(true); onDown(code); }}
      onPressOut={release}
      style={[styles.keyButton, compact && styles.keyButtonCompact, pressed && styles.keyButtonPressed]}
    >
      <Text style={[styles.keyButtonText, pressed && styles.keyButtonTextPressed]}>{label}</Text>
    </Pressable>
  );
}

function KeysPanel({ pressKey, releaseKey, releaseAll }: {
  pressKey: (code: string) => void;
  releaseKey: (code: string) => void;
  releaseAll: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.scrollPanel} showsVerticalScrollIndicator={false}>
      <Text style={styles.sectionEyebrow}>GENERIC KEYS</Text>
      <Text style={styles.sectionTitle}>Hold or tap</Text>
      <Text style={styles.sectionBody}>Buttons preserve the existing key-down and key-up protocol, so shortcuts can be pressed together.</Text>
      <View style={styles.keyboard}>
        {KEY_ROWS.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.keyRow}>
            {row.map(([label, code]) => (
              <KeyButton key={code} label={label} code={code} onDown={pressKey} onUp={releaseKey} />
            ))}
          </View>
        ))}
      </View>
      <Pressable onPress={releaseAll} style={styles.releaseButton}>
        <Text style={styles.releaseButtonText}>Release all keys</Text>
      </Pressable>
    </ScrollView>
  );
}

function ActionsPanel({ capabilities, capabilityError, sendAction }: {
  capabilities: ActionCapabilities | null;
  capabilityError: string | null;
  sendAction: (label: string, action: string) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.scrollPanel} showsVerticalScrollIndicator={false}>
      <Text style={styles.sectionEyebrow}>DESKTOP ACTIONS</Text>
      <Text style={styles.sectionTitle}>Run on the host</Text>
      {capabilityError ? <Text style={styles.inlineWarning}>Availability check failed: {capabilityError}</Text> : null}
      {ACTION_GROUPS.map((group) => (
        <View key={group.title} style={styles.actionGroup}>
          <Text style={styles.groupTitle}>{group.title}</Text>
          <View style={styles.actionGrid}>
            {group.actions.map(([label, action]) => {
              const capability = capabilities?.[action];
              if (capability?.state === 'hidden') return null;
              const unavailable = capability?.state !== 'supported';
              return (
                <Pressable
                  key={action}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: unavailable }}
                  onPress={() => sendAction(label, action)}
                  style={[styles.actionButton, unavailable && styles.actionButtonUnavailable]}
                >
                  <Text style={styles.actionButtonText}>{label}</Text>
                  <Text style={[styles.actionState, unavailable && styles.actionStateUnavailable]}>
                    {unavailable ? (capabilities ? 'Unavailable' : 'Checking…') : 'Ready'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function MediaPanel({ sendAction }: { sendAction: (label: string, action: string) => void }) {
  return (
    <View style={styles.mediaPanel}>
      <Text style={styles.sectionEyebrow}>MEDIA</Text>
      <Text style={styles.sectionTitle}>Playback & volume</Text>
      <View style={styles.mediaGrid}>
        {MEDIA_ACTIONS.map(([icon, label, action], index) => (
          <Pressable
            key={action}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => sendAction(label, action)}
            style={[styles.mediaButton, index === 1 && styles.mediaButtonPrimary]}
          >
            <Text style={[styles.mediaIcon, index === 1 && styles.mediaIconPrimary]}>{icon}</Text>
            <Text style={[styles.mediaLabel, index === 1 && styles.mediaLabelPrimary]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0E1117' },
  topBar: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: '#232936' },
  backButton: { minWidth: 72, minHeight: 42, justifyContent: 'center', paddingHorizontal: 8 },
  backButtonText: { color: '#AFC0FF', fontSize: 15, fontWeight: '700' },
  hostTitleWrap: { flex: 1, alignItems: 'center' },
  hostTitle: { color: '#F7F8FA', fontSize: 15, fontWeight: '800', maxWidth: 220 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF9C66' },
  statusDotReady: { backgroundColor: '#54D39B' },
  statusLabel: { color: '#8F98A8', fontSize: 11, fontWeight: '600' },
  reconnectButton: { minWidth: 72, minHeight: 42, alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: 10 },
  reconnectText: { color: '#AFC0FF', fontSize: 24 },
  bannerError: { color: '#FFC7C7', backgroundColor: '#4A2328', paddingHorizontal: 14, paddingVertical: 9, fontSize: 13 },
  tabBar: { flexDirection: 'row', marginHorizontal: 12, marginTop: 10, padding: 4, backgroundColor: '#171B24', borderRadius: 14 },
  tab: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: '#EEF1FF' },
  tabText: { color: '#818B9D', fontSize: 13, fontWeight: '800' },
  tabTextActive: { color: '#263B9E' },
  panelContainer: { flex: 1, marginTop: 10 },
  notice: { marginHorizontal: 12, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12, backgroundColor: '#293248' },
  noticeText: { color: '#DDE4FA', fontSize: 13, lineHeight: 18 },
  padPanel: { flex: 1, paddingHorizontal: 12, paddingBottom: 8 },
  touchPad: { flex: 1, minHeight: 230, borderRadius: 25, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#171D28', borderWidth: 1, borderColor: '#2B3445' },
  touchPadWindowMode: { borderColor: '#7891FF', backgroundColor: '#1C2540' },
  controlDisabled: { opacity: 0.58 },
  padGlow: { position: 'absolute', width: 210, height: 210, borderRadius: 105, backgroundColor: '#24366A', opacity: 0.35 },
  padTitle: { color: '#F2F5FF', fontSize: 18, fontWeight: '900', letterSpacing: 3 },
  padHint: { color: '#AEB7C8', fontSize: 14, fontWeight: '600', marginTop: 10 },
  padLongHint: { color: '#6F7A8C', fontSize: 12, marginTop: 6 },
  textRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  textInput: { flex: 1, minHeight: 52, maxHeight: 88, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#171B24', borderWidth: 1, borderColor: '#2A303D', color: '#F4F6FA', fontSize: 15 },
  sendButton: { width: 70, minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5975F7' },
  sendButtonText: { color: '#FFFFFF', fontWeight: '900' },
  quickKeys: { flexDirection: 'row', gap: 6, marginTop: 8 },
  keyButton: { flex: 1, minWidth: 48, minHeight: 50, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#202631', borderWidth: 1, borderColor: '#303847' },
  keyButtonCompact: { minWidth: 0, minHeight: 44 },
  keyButtonPressed: { backgroundColor: '#E9EDFF', borderColor: '#A9B8FF' },
  keyButtonText: { color: '#D9DEE8', fontSize: 13, fontWeight: '800' },
  keyButtonTextPressed: { color: '#263B9E' },
  scrollPanel: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 28 },
  sectionEyebrow: { color: '#7891FF', fontSize: 11, fontWeight: '900', letterSpacing: 1.7 },
  sectionTitle: { color: '#F5F7FB', fontSize: 25, fontWeight: '900', marginTop: 5 },
  sectionBody: { color: '#8E98A9', fontSize: 13, lineHeight: 19, marginTop: 7 },
  inlineWarning: { color: '#FFD09B', backgroundColor: '#3B2E20', borderRadius: 10, padding: 10, fontSize: 12, lineHeight: 17, marginTop: 10 },
  keyboard: { gap: 7, marginTop: 18 },
  keyRow: { flexDirection: 'row', gap: 7 },
  releaseButton: { height: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 16, backgroundColor: '#37252B', borderWidth: 1, borderColor: '#5A323A' },
  releaseButtonText: { color: '#FFB8BF', fontWeight: '800' },
  actionGroup: { marginTop: 22 },
  groupTitle: { color: '#B9C0CD', fontSize: 14, fontWeight: '800', marginBottom: 9 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  actionButton: { width: '48.5%', minHeight: 76, borderRadius: 15, padding: 13, justifyContent: 'space-between', backgroundColor: '#1B2230', borderWidth: 1, borderColor: '#2E394C' },
  actionButtonUnavailable: { opacity: 0.62, backgroundColor: '#232127' },
  actionButtonText: { color: '#EEF1F7', fontSize: 14, fontWeight: '800' },
  actionState: { color: '#62D8A1', fontSize: 11, fontWeight: '800', marginTop: 8 },
  actionStateUnavailable: { color: '#E5A06E' },
  mediaPanel: { flex: 1, paddingHorizontal: 14, paddingTop: 8 },
  mediaGrid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 18 },
  mediaButton: { width: '31%', aspectRatio: 0.95, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1B2230', borderWidth: 1, borderColor: '#303A4B' },
  mediaButtonPrimary: { backgroundColor: '#EAF0FF', borderColor: '#EAF0FF' },
  mediaIcon: { color: '#DDE3EE', fontSize: 27, fontWeight: '700' },
  mediaIconPrimary: { color: '#304BB9' },
  mediaLabel: { color: '#8994A6', fontSize: 10, fontWeight: '700', marginTop: 7, textAlign: 'center' },
  mediaLabelPrimary: { color: '#4D60AE' },
});
