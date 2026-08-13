import { StatusBar } from 'expo-status-bar';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Keyboard,
  type KeyboardEvent,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { createLatestFrameCoalescer } from './frameCoalescer';
import {
  beginGesture,
  centroid,
  LONG_PRESS_DELAY_MS,
  shouldBeginWindowMode,
  shouldTap,
  type GestureState,
  type Point,
} from './gestureState';
import { keyboardInsetFromFrame } from './keyboard-insets';
import {
  hostStateUrl,
  POINTER_BUTTONS,
  RELEASABLE_KEYS,
  releaseInputMessages,
  serializeMessage,
  socketUrl,
  supportedWorkspaceActions,
  type ActionCapabilities,
  type ConnectionState,
  type HostState,
  type PointerButton,
  type ServerMessage,
  type TapPadMessage,
  supportsPointerButton,
} from './protocol';
import { theme } from './theme';

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

const KEY_GROUPS = [
  {
    title: 'Modifiers',
    rows: [[
      ['Super', 'MetaLeft'], ['Ctrl', 'ControlLeft'], ['Alt', 'AltLeft'], ['Shift', 'ShiftLeft'], ['Space', 'Space'],
    ]],
  },
  {
    title: 'Navigation',
    rows: [
      [['Esc', 'Escape'], ['Tab', 'Tab'], ['Enter', 'Enter'], ['⌫', 'Backspace'], ['PrtSc', 'PrintScreen']],
      [['←', 'ArrowLeft'], ['↑', 'ArrowUp'], ['↓', 'ArrowDown'], ['→', 'ArrowRight']],
    ],
  },
  {
    title: 'Common keys',
    rows: [
      [['A', 'KeyA'], ['C', 'KeyC'], ['V', 'KeyV'], ['X', 'KeyX'], ['Z', 'KeyZ']],
      [['B', 'KeyB'], ['S', 'KeyS'], ['T', 'KeyT'], ['W', 'KeyW'], ['F', 'KeyF']],
      [['1', 'Digit1'], ['2', 'Digit2'], ['3', 'Digit3'], ['4', 'Digit4'], ['5', 'Digit5']],
    ],
  },
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

type MaterialIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const MEDIA_GROUPS: { title: string; actions: { icon: MaterialIconName; label: string; action: string; primary?: boolean }[] }[] = [
  {
    title: 'Playback',
    actions: [
      { icon: 'skip-previous', label: 'Previous', action: 'media.prev' },
      { icon: 'play-pause', label: 'Play / pause', action: 'media.play_pause', primary: true },
      { icon: 'skip-next', label: 'Next', action: 'media.next' },
    ],
  },
  {
    title: 'Volume',
    actions: [
      { icon: 'volume-minus', label: 'Volume down', action: 'media.volume_down' },
      { icon: 'volume-mute', label: 'Mute', action: 'media.mute' },
      { icon: 'volume-plus', label: 'Volume up', action: 'media.volume_up' },
    ],
  },
];

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
  const [pointerButtonSupported, setPointerButtonSupported] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const mountedRef = useRef(true);
  const heldKeysRef = useRef(new Set<string>());
  const heldButtonsRef = useRef(new Set<PointerButton>());

  const send = useCallback((message: TapPadMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(serializeMessage(message));
    return true;
  }, []);

  const releaseAll = useCallback(() => {
    for (const message of releaseInputMessages(heldButtonsRef.current, heldKeysRef.current)) send(message);
    heldButtonsRef.current.clear();
    heldKeysRef.current.clear();
  }, [send]);

  const pressKey = useCallback((code: string) => {
    if (heldKeysRef.current.has(code)) return true;
    if (!send({ type: 'key', code, down: true })) return false;
    heldKeysRef.current.add(code);
    return true;
  }, [send]);

  const releaseKey = useCallback((code: string) => {
    if (!heldKeysRef.current.has(code)) return;
    send({ type: 'key', code, down: false });
    heldKeysRef.current.delete(code);
  }, [send]);

  const pressPointerButton = useCallback((button: PointerButton) => {
    if (!pointerButtonSupported) return false;
    if (heldButtonsRef.current.has(button)) return true;
    if (!send({ type: 'pointerButton', button, down: true })) return false;
    heldButtonsRef.current.add(button);
    return true;
  }, [pointerButtonSupported, send]);

  const releasePointerButton = useCallback((button: PointerButton) => {
    if (!heldButtonsRef.current.has(button)) return;
    send({ type: 'pointerButton', button, down: false });
    heldButtonsRef.current.delete(button);
  }, [send]);

  const connectSocket = useCallback(() => {
    if (!mountedRef.current) return;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    releaseAll();
    socketRef.current?.close();
    setPointerButtonSupported(false);
    setConnectionState('connecting');
    setConnectionError(null);

    const socket = new WebSocket(socketUrl(host, port, token));
    socketRef.current = socket;
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (message.type === 'error') {
          setNotice(message.message || 'The host rejected an input message.');
          return;
        }
        if (message.type !== 'ready') return;
        reconnectAttemptRef.current = 0;
        setConnectionState('connected');
        setConnectionError(null);
        setPointerButtonSupported(supportsPointerButton(message));
        // Recover from an interrupted previous socket before accepting new input.
        for (const messageToSend of releaseInputMessages(POINTER_BUTTONS, RELEASABLE_KEYS)) {
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
      heldButtonsRef.current.clear();
      heldKeysRef.current.clear();
      setPointerButtonSupported(false);
      setConnectionState('disconnected');
      const delay = Math.min(1_000 * 2 ** reconnectAttemptRef.current, 8_000);
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = setTimeout(connectSocket, delay);
    };
  }, [host, port, releaseAll, token]);

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
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to hosts"
          onPress={() => { releaseAll(); onExit(); }}
          style={({ pressed }) => [styles.iconButton, styles.backButton, pressed && styles.controlPressed]}
        >
          <MaterialCommunityIcons name="arrow-left" color={theme.color.textStrong} size={19} />
          <Text style={styles.backButtonText}>Hosts</Text>
        </Pressable>
        <View style={styles.hostTitleWrap}>
          <Text style={styles.hostTitle} numberOfLines={1}>{hostName}</Text>
          <View style={styles.statusRow} accessibilityLiveRegion="polite">
            <View style={[
              styles.statusDot,
              connectionState === 'connected' && styles.statusDotReady,
              connectionState === 'error' && styles.statusDotError,
            ]} />
            <Text style={[styles.statusLabel, connectionState !== 'connected' && styles.statusLabelAttention]}>
              {statusText(connectionState)}
            </Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reconnect"
          onPress={connectSocket}
          style={({ pressed }) => [styles.iconButton, styles.reconnectButton, pressed && styles.controlPressed]}
        >
          <MaterialCommunityIcons name="refresh" color={theme.color.textStrong} size={21} />
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
            style={({ pressed }) => [styles.tab, panel === tab.id && styles.tabActive, pressed && styles.tabPressed]}
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
            pressPointerButton={pressPointerButton}
            releasePointerButton={releasePointerButton}
            windowDragSupported={pointerButtonSupported}
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
  pressKey: (code: string) => boolean;
  releaseKey: (code: string) => void;
  pressPointerButton: (button: PointerButton) => boolean;
  releasePointerButton: (button: PointerButton) => void;
  windowDragSupported: boolean;
  connected: boolean;
  setNotice: (message: string | null) => void;
};

function PadPanel({
  send,
  pressKey,
  releaseKey,
  pressPointerButton,
  releasePointerButton,
  windowDragSupported,
  connected,
  setNotice,
}: PadProps) {
  const [text, setText] = useState('');
  const [windowMode, setWindowMode] = useState(false);
  const [keyboardScreenY, setKeyboardScreenY] = useState<number | null>(
    () => Keyboard.metrics()?.screenY ?? null,
  );
  const { height: windowHeight } = useWindowDimensions();
  const { bottom: bottomSafeArea } = useSafeAreaInsets();
  const gestureRef = useRef<GestureState | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapAtRef = useRef(0);
  const wheelSender = useMemo(() => createLatestFrameCoalescer<number>(
    (dy) => send({ type: 'wheel', dy }),
    { request: requestAnimationFrame, cancel: cancelAnimationFrame },
  ), [send]);
  // Edge-to-edge Android windows can keep their full reported height while the IME overlays them.
  const keyboardInset = keyboardInsetFromFrame(windowHeight, keyboardScreenY, bottomSafeArea);

  useEffect(() => {
    const show = (event: KeyboardEvent) => {
      setKeyboardScreenY(event.endCoordinates.screenY);
    };
    const showSubscription = Keyboard.addListener('keyboardDidShow', show);
    const frameSubscription = Keyboard.addListener('keyboardDidChangeFrame', show);
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setKeyboardScreenY(null));
    return () => {
      showSubscription.remove();
      frameSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }, []);

  const endWindowMode = useCallback(() => {
    releasePointerButton('left');
    releaseKey('MetaLeft');
    setWindowMode(false);
  }, [releaseKey, releasePointerButton]);

  const endGesture = useCallback((canceled: boolean) => {
    clearLongPress();
    wheelSender.cancel();
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture) return;

    if (gesture.mode === 'window') {
      endWindowMode();
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
  }, [clearLongPress, endWindowMode, send, wheelSender]);

  useEffect(() => () => {
    clearLongPress();
    wheelSender.cancel();
    if (pendingTapTimerRef.current) clearTimeout(pendingTapTimerRef.current);
    if (gestureRef.current?.mode === 'window') endWindowMode();
  }, [clearLongPress, endWindowMode, wheelSender]);

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
        if (!windowDragSupported) {
          setNotice('Window drag requires a TapPad Host with pointer hold support.');
          return;
        }
        if (!pressKey('MetaLeft')) return;
        if (!pressPointerButton('left')) {
          releaseKey('MetaLeft');
          return;
        }
        gesture.mode = 'window';
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
          endWindowMode();
        }
        const next = centroid(points.slice(0, 2));
        if (gesture.mode !== 'scroll') {
          gesture.mode = 'scroll';
          gesture.last = next;
          return;
        }
        const dy = next.y - gesture.last.y;
        gesture.last = next;
        if (Math.abs(dy) > 0.5) wheelSender.push(-dy * 0.25);
        return;
      }

      const next = points[0];
      if (!next) return;
      if (gesture.mode === 'scroll') {
        wheelSender.cancel();
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
  }), [
    clearLongPress,
    endGesture,
    endWindowMode,
    pressKey,
    pressPointerButton,
    releaseKey,
    send,
    setNotice,
    wheelSender,
    windowDragSupported,
  ]);

  const sendText = useCallback(() => {
    if (!text.trim()) return;
    if (!send({ type: 'text', value: text })) {
      setNotice('Text was not sent because TapPad is disconnected.');
      return;
    }
    setText('');
  }, [send, setNotice, text]);

  return (
    <View style={[styles.padPanel, keyboardInset > 0 && { paddingBottom: keyboardInset + theme.space.sm }]}>
      <View
        {...panResponder.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel="Touchpad. Move one finger for pointer, two fingers to scroll, long press to move a window."
        style={[styles.touchPad, !connected && styles.controlDisabled, windowMode && styles.touchPadWindowMode]}
      >
        <View style={styles.padGuide}>
          <Text style={styles.padHint}>{windowMode ? 'Keep holding and move' : 'Move · Tap · Two-finger scroll'}</Text>
          <Text style={styles.padLongHint}>{windowMode ? 'Release to exit' : 'Long press to move a window'}</Text>
        </View>
      </View>

      <View style={styles.textRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          placeholder="Type or dictate text"
          placeholderTextColor={theme.color.textSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.textInput}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send text"
          onPress={sendText}
          style={({ pressed }) => [styles.sendButton, pressed && styles.sendButtonPressed]}
        >
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
    </View>
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
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Keyboard</Text>
        <Text style={styles.sectionBody}>Hold a modifier, then tap another key.</Text>
      </View>
      <View style={styles.keyboardGroups}>
        {KEY_GROUPS.map((group) => (
          <View key={group.title} style={styles.keyGroup}>
            <Text style={styles.groupTitle}>{group.title}</Text>
            <View style={styles.keyboard}>
              {group.rows.map((row, rowIndex) => (
                <View key={rowIndex} style={styles.keyRow}>
                  {row.map(([label, code]) => (
                    <KeyButton key={code} label={label} code={code} onDown={pressKey} onUp={releaseKey} />
                  ))}
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Release all held keys"
        onPress={releaseAll}
        style={({ pressed }) => [styles.releaseButton, pressed && styles.releaseButtonPressed]}
      >
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
  const workspaceActions = supportedWorkspaceActions(capabilities);
  const workspaceNavigation = workspaceActions.filter(({ action }) => !/^workspace\.\d+$/.test(action));
  const numberedWorkspaces = workspaceActions.filter(({ action }) => /^workspace\.\d+$/.test(action));

  return (
    <ScrollView contentContainerStyle={styles.scrollPanel} showsVerticalScrollIndicator={false}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Actions</Text>
        {!capabilities && !capabilityError ? <Text style={styles.sectionBody}>Checking availability…</Text> : null}
      </View>
      {capabilityError ? <Text style={styles.inlineWarning}>Availability check failed: {capabilityError}</Text> : null}
      {workspaceActions.length > 0 ? (
        <View style={styles.actionGroup}>
          <Text style={styles.groupTitle}>Workspaces</Text>
          <View style={styles.workspaceControls}>
            <View style={styles.workspaceNavigationRow}>
              {workspaceNavigation.map(({ label, action }) => (
                <Pressable
                  key={action}
                  accessibilityRole="button"
                  accessibilityLabel={`Switch to ${label.toLowerCase()} workspace`}
                  onPress={() => sendAction(label, action)}
                  style={({ pressed }) => [styles.workspaceNavigationButton, pressed && styles.actionButtonPressed]}
                >
                  <Text style={styles.actionButtonText}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.workspaceNumberRow}>
              {numberedWorkspaces.map(({ label, action }) => (
                <Pressable
                  key={action}
                  accessibilityRole="button"
                  accessibilityLabel={`Switch to workspace ${label}`}
                  onPress={() => sendAction(`Workspace ${label}`, action)}
                  style={({ pressed }) => [styles.workspaceNumberButton, pressed && styles.actionButtonPressed]}
                >
                  <Text style={styles.workspaceNumberText}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      ) : null}
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
                  style={({ pressed }) => [
                    styles.actionButton,
                    unavailable && styles.actionButtonUnavailable,
                    pressed && styles.actionButtonPressed,
                  ]}
                >
                  <Text style={styles.actionButtonText}>{label}</Text>
                  {unavailable && capabilities ? <Text style={styles.actionStateUnavailable}>Unavailable</Text> : null}
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
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Media</Text>
        <Text style={styles.sectionBody}>Playback and system volume.</Text>
      </View>
      {MEDIA_GROUPS.map((group) => (
        <View key={group.title} style={styles.mediaGroup}>
          <Text style={styles.groupTitle}>{group.title}</Text>
          <View style={styles.mediaRow}>
            {group.actions.map(({ icon, label, action, primary }) => (
              <Pressable
                key={action}
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={() => sendAction(label, action)}
                style={({ pressed }) => [
                  styles.mediaButton,
                  primary && styles.mediaButtonPrimary,
                  pressed && styles.mediaButtonPressed,
                  primary && pressed && styles.mediaButtonPrimaryPressed,
                ]}
              >
                <MaterialCommunityIcons name={icon} color={primary ? theme.color.onPrimary : theme.color.textStrong} size={27} />
                <Text style={[styles.mediaLabel, primary && styles.mediaLabelPrimary]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.color.canvas },
  topBar: { minHeight: 50, flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space.sm, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  iconButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center' },
  backButton: { width: 76, justifyContent: 'flex-start', gap: 4, paddingHorizontal: theme.space.xs },
  backButtonText: { color: theme.color.textStrong, fontSize: 13, fontWeight: '700' },
  hostTitleWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hostTitle: { color: theme.color.text, fontSize: 14, fontWeight: '800', maxWidth: 220 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  statusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: theme.color.pending },
  statusDotReady: { backgroundColor: theme.color.online },
  statusDotError: { backgroundColor: theme.color.danger },
  statusLabel: { color: theme.color.textSubtle, fontSize: 10, fontWeight: '600' },
  statusLabelAttention: { color: theme.color.textMuted },
  reconnectButton: { width: 76, justifyContent: 'flex-end', paddingHorizontal: 8 },
  controlPressed: { opacity: 0.58 },
  bannerError: { color: theme.color.danger, backgroundColor: theme.color.dangerSurface, paddingHorizontal: 14, paddingVertical: 9, fontSize: 13 },
  tabBar: { flexDirection: 'row', marginHorizontal: theme.space.md, marginTop: theme.space.xs, padding: theme.space.xxs, backgroundColor: theme.color.surfaceMuted, borderRadius: theme.radius.pad },
  tab: { flex: 1, minHeight: 32, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.control },
  tabActive: { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  tabPressed: { backgroundColor: theme.color.surfacePressed },
  tabText: { color: theme.color.textSubtle, fontSize: 12, fontWeight: '700' },
  tabTextActive: { color: theme.color.text },
  panelContainer: { flex: 1, marginTop: 7 },
  notice: { marginHorizontal: theme.space.md, marginBottom: theme.space.sm, paddingHorizontal: 13, paddingVertical: 9, borderRadius: theme.radius.panel, backgroundColor: theme.color.surfaceMuted, borderWidth: 1, borderColor: theme.color.border },
  noticeText: { color: theme.color.textMuted, fontSize: 12, lineHeight: 17 },
  padPanel: { flex: 1, paddingHorizontal: theme.space.md, paddingBottom: theme.space.sm },
  touchPad: { flex: 1, minHeight: 250, borderRadius: theme.radius.pad, overflow: 'hidden', alignItems: 'center', backgroundColor: theme.color.surfaceMuted, borderWidth: 1, borderColor: theme.color.border },
  touchPadWindowMode: { borderColor: theme.color.borderStrong, backgroundColor: theme.color.surfacePressed },
  controlDisabled: { opacity: 0.58 },
  padGuide: { position: 'absolute', bottom: 15, alignItems: 'center' },
  padHint: { color: theme.color.textMuted, fontSize: 11, fontWeight: '600' },
  padLongHint: { color: theme.color.textSubtle, fontSize: 10, marginTop: theme.space.xxs },
  textRow: { flexDirection: 'row', gap: theme.space.sm, marginTop: theme.space.sm },
  textInput: { flex: 1, minHeight: 46, maxHeight: 80, borderRadius: theme.radius.panel, paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm, backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border, color: theme.color.text, fontSize: 13 },
  sendButton: { width: 66, minHeight: 46, borderRadius: theme.radius.panel, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.primary },
  sendButtonPressed: { backgroundColor: theme.color.primaryPressed },
  sendButtonText: { color: theme.color.onPrimary, fontSize: 12, fontWeight: '800' },
  quickKeys: { flexDirection: 'row', gap: 6, marginTop: 7 },
  keyButton: { flex: 1, minWidth: 46, minHeight: 44, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.control, backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  keyButtonCompact: { minWidth: 0, minHeight: 40 },
  keyButtonPressed: { backgroundColor: theme.color.surfacePressed, borderColor: theme.color.borderStrong },
  keyButtonText: { color: theme.color.textStrong, fontSize: 12, fontWeight: '700' },
  keyButtonTextPressed: { color: theme.color.text },
  scrollPanel: { paddingHorizontal: 14, paddingTop: 2, paddingBottom: 24 },
  sectionHeader: { marginBottom: 12 },
  sectionTitle: { color: theme.color.text, fontSize: 19, fontWeight: '800' },
  sectionBody: { color: theme.color.textSubtle, fontSize: 12, lineHeight: 17, marginTop: theme.space.xxs },
  inlineWarning: { color: theme.color.warning, backgroundColor: theme.color.warningSurface, borderRadius: theme.radius.panel, padding: 10, fontSize: 12, lineHeight: 17, marginTop: 10 },
  keyboardGroups: { gap: 15 },
  keyGroup: { gap: 7 },
  keyboard: { gap: 6 },
  keyRow: { flexDirection: 'row', gap: 6 },
  releaseButton: { height: 40, borderRadius: theme.radius.control, alignItems: 'center', justifyContent: 'center', marginTop: theme.space.lg, backgroundColor: theme.color.dangerSurface, borderWidth: 1, borderColor: theme.color.dangerBorder },
  releaseButtonPressed: { backgroundColor: '#F0DEDF' },
  releaseButtonText: { color: theme.color.danger, fontSize: 12, fontWeight: '700' },
  actionGroup: { marginTop: 16 },
  groupTitle: { color: theme.color.textMuted, fontSize: 12, fontWeight: '700' },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  actionButton: { width: '48.5%', minHeight: 58, borderRadius: theme.radius.panel, paddingHorizontal: theme.space.md, paddingVertical: 9, justifyContent: 'center', backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  actionButtonPressed: { backgroundColor: theme.color.surfacePressed },
  actionButtonUnavailable: { backgroundColor: theme.color.warningSurface, borderColor: theme.color.warningBorder },
  actionButtonText: { color: theme.color.textStrong, fontSize: 13, fontWeight: '700' },
  actionStateUnavailable: { color: theme.color.warning, fontSize: 10, fontWeight: '700', marginTop: 4 },
  workspaceControls: { gap: 8, marginTop: 8 },
  workspaceNavigationRow: { flexDirection: 'row', gap: 8 },
  workspaceNavigationButton: { flex: 1, minHeight: 48, borderRadius: theme.radius.panel, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  workspaceNumberRow: { flexDirection: 'row', gap: 8 },
  workspaceNumberButton: { flex: 1, minHeight: 48, borderRadius: theme.radius.control, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surfaceMuted, borderWidth: 1, borderColor: theme.color.border },
  workspaceNumberText: { color: theme.color.textStrong, fontSize: 15, fontWeight: '800' },
  mediaPanel: { flex: 1, paddingHorizontal: 14, paddingTop: 2 },
  mediaGroup: { marginTop: 16 },
  mediaRow: { flexDirection: 'row', gap: 9, marginTop: 8 },
  mediaButton: { flex: 1, minHeight: 86, borderRadius: theme.radius.panel, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  mediaButtonPrimary: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  mediaButtonPressed: { backgroundColor: theme.color.surfacePressed },
  mediaButtonPrimaryPressed: { backgroundColor: theme.color.primaryPressed, borderColor: theme.color.primaryPressed },
  mediaLabel: { color: theme.color.textMuted, fontSize: 10, fontWeight: '700', marginTop: 7, textAlign: 'center' },
  mediaLabelPrimary: { color: theme.color.onPrimary },
});
