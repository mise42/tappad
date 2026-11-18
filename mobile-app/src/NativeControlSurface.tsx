import { StatusBar } from 'expo-status-bar';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as SecureStore from 'expo-secure-store';
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Platform,
  Keyboard,
  type KeyboardEvent,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { PinnedWebSocket, randomNonce } from '../modules/tappad-pinned-socket';
import { createWheelMotion } from './wheelMotion';
import { bindingAuthorization, verifyHostProof } from './host-binding';
import {
  AUTHORIZATION_RETRY_COOLDOWN_MS,
  authorizationPasswordError,
  authorizationPasswordKey,
  authorizationRecoveryState,
  authorizationResultNotice,
  shouldMaskAuthorizationPassword,
} from './authorization';
import {
  beginGesture,
  centroid,
  DOUBLE_TAP_WINDOW_MS,
  recordPosition,
  shouldBeginDrag,
  shouldRightClick,
  shouldTap,
  TAP_MAX_DURATION_MS,
  type GestureState,
  type Point,
} from './gestureState';
import { keyboardInset as keyboardInsetFor } from './keyboard-insets';
import {
  hostStateActionCapabilities,
  POINTER_BUTTONS,
  RELEASABLE_KEYS,
  releaseInputMessages,
  readyActionCapabilities,
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
  supportsTextSubmit,
} from './protocol';
import { theme } from './theme';

type Panel = 'pad' | 'keys' | 'actions' | 'media';

type Props = {
  hostId: string;
  host: string;
  hostName: string;
  port: number;
  token: string;
  /** SHA-256 of the paired Host certificate; the only certificate this surface talks to. */
  fingerprint: string;
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

export function NativeControlSurface({ hostId, host, hostName, port, token, fingerprint, onExit }: Props) {
  const [panel, setPanel] = useState<Panel>('pad');
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<ActionCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [pointerButtonSupported, setPointerButtonSupported] = useState(false);
  const [textSubmitSupported, setTextSubmitSupported] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [authorizationRequestActive, setAuthorizationRequestActive] = useState(false);
  const [authorizationPasswordSaved, setAuthorizationPasswordSaved] = useState<boolean | undefined>(undefined);
  const [authorizationModalOpen, setAuthorizationModalOpen] = useState(false);
  const [authorizationPassword, setAuthorizationPassword] = useState('');
  const [authorizationPasswordIssue, setAuthorizationPasswordIssue] = useState<string | null>(null);
  const [authorizationPasswordVisible, setAuthorizationPasswordVisible] = useState(false);
  const [authorizationReplacingPassword, setAuthorizationReplacingPassword] = useState(false);
  const [authorizationSubmitting, setAuthorizationSubmitting] = useState(false);
  const [authorizationSubmittedAt, setAuthorizationSubmittedAt] = useState<number | null>(null);
  const [authorizationCooldownNow, setAuthorizationCooldownNow] = useState(() => Date.now());
  const { top: topSafeArea } = useSafeAreaInsets();
  const socketRef = useRef<PinnedWebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const hostDisconnectedRef = useRef(false);
  const mountedRef = useRef(true);
  const heldKeysRef = useRef(new Set<string>());
  const heldButtonsRef = useRef(new Set<PointerButton>());

  const send = useCallback((message: TapPadMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== PinnedWebSocket.OPEN) return false;
    return socket.send(serializeMessage(message));
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

  // Host state travels over the pinned socket; the answer arrives as a `hostState` message.
  const loadCapabilities = useCallback(async () => {
    send({ type: 'hostState' });
  }, [send]);

  const applyHostState = useCallback((state: HostState) => {
    setCapabilities(hostStateActionCapabilities(state));
    setAuthorizationRequestActive(state.authorization?.requestActive === true);
    setCapabilityError(null);
  }, []);

  const connectSocket = useCallback(() => {
    if (!mountedRef.current || hostDisconnectedRef.current) return;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    releaseAll();
    socketRef.current?.close();
    setPointerButtonSupported(false);
    setTextSubmitSupported(false);
    setConnectionState('connecting');
    setConnectionError(null);

    const nonce = randomNonce();
    const socket = new PinnedWebSocket(
      socketUrl(host, port),
      fingerprint,
      bindingAuthorization(token, fingerprint, nonce),
    );
    socketRef.current = socket;
    let hostVerified = false;
    socket.onmessage = (event) => {
      if (socketRef.current !== socket) return;
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (!hostVerified) {
          // Nothing is sent or trusted until the Host proves it holds the token for this certificate.
          if (message.type !== 'ready' || !verifyHostProof(token, fingerprint, nonce, message.hostProof)) {
            hostDisconnectedRef.current = true;
            setConnectionState('error');
            setConnectionError('The host could not prove its identity. Pair again by scanning its QR code.');
            socket.close();
            return;
          }
          hostVerified = true;
        }
        if (message.type === 'hostState') {
          if (message.state) applyHostState(message.state);
          return;
        }
        if (message.type === 'disconnected') {
          hostDisconnectedRef.current = true;
          setNotice('Disconnected by Host. Pairing is saved; tap Reconnect.');
          socket.close();
          return;
        }
        if (message.type === 'error') {
          setNotice(message.message || 'The host rejected an input message.');
          return;
        }
        if (message.type === 'authorizationResult') {
          setAuthorizationSubmitting(false);
          if (message.status === 'submitted') {
            const submittedAt = Date.now();
            setAuthorizationSubmittedAt(submittedAt);
            setAuthorizationCooldownNow(submittedAt);
          }
          setNotice(authorizationResultNotice(message.status, message.message));
          void loadCapabilities();
          return;
        }
        if (message.type !== 'ready') return;
        if (message.connectionManagement) {
          socket.send(serializeMessage({ type: 'clientInfo', name: Platform.OS === 'android' ? Platform.constants.Model : 'TapPad on iOS' }));
        }
        reconnectAttemptRef.current = 0;
        setConnectionState('connected');
        setConnectionError(null);
        setPointerButtonSupported(supportsPointerButton(message));
        setTextSubmitSupported(supportsTextSubmit(message));
        const readyCapabilities = readyActionCapabilities(message);
        if (readyCapabilities) setCapabilities(readyCapabilities);
        void loadCapabilities();
        // Recover from an interrupted previous socket before accepting new input.
        for (const messageToSend of releaseInputMessages(POINTER_BUTTONS, RELEASABLE_KEYS)) {
          socket.send(serializeMessage(messageToSend));
        }
      } catch {
        setConnectionState('error');
        setConnectionError('The host returned an invalid response.');
      }
    };
    socket.onerror = (error) => {
      if (socketRef.current !== socket) return;
      if (!mountedRef.current) return;
      // A different certificate is not a network blip: never retry it automatically.
      if (error.certificateMismatch) hostDisconnectedRef.current = true;
      setAuthorizationSubmitting(false);
      setConnectionState('error');
      setConnectionError(error.message);
    };
    socket.onclose = () => {
      if (!mountedRef.current || socketRef.current !== socket) return;
      heldButtonsRef.current.clear();
      heldKeysRef.current.clear();
      setPointerButtonSupported(false);
      setTextSubmitSupported(false);
      setAuthorizationSubmitting(false);
      setAuthorizationRequestActive(false);
      setConnectionState((current) => (current === 'error' ? current : 'disconnected'));
      if (hostDisconnectedRef.current) return;
      const delay = Math.min(1_000 * 2 ** reconnectAttemptRef.current, 8_000);
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = setTimeout(connectSocket, delay);
    };
  }, [applyHostState, fingerprint, host, loadCapabilities, port, releaseAll, token]);

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
      if (state === 'active') {
        void loadCapabilities();
      } else {
        releaseAll();
      }
    });
    return () => subscription.remove();
  }, [loadCapabilities, releaseAll]);

  useEffect(() => { void loadCapabilities(); }, [loadCapabilities]);

  useEffect(() => {
    void loadCapabilities();
    const timer = setInterval(() => { void loadCapabilities(); }, 1_000);
    return () => clearInterval(timer);
  }, [loadCapabilities]);

  useEffect(() => {
    if (!authorizationRequestActive) setAuthorizationSubmittedAt(null);
  }, [authorizationRequestActive]);

  useEffect(() => {
    if (authorizationSubmittedAt === null) return;
    const remaining = AUTHORIZATION_RETRY_COOLDOWN_MS - (Date.now() - authorizationSubmittedAt);
    if (remaining <= 0) {
      setAuthorizationCooldownNow(Date.now());
      return;
    }
    const timer = setTimeout(() => setAuthorizationCooldownNow(Date.now()), remaining);
    return () => clearTimeout(timer);
  }, [authorizationSubmittedAt]);

  useEffect(() => {
    let active = true;
    setAuthorizationPasswordSaved(undefined);
    void SecureStore.getItemAsync(authorizationPasswordKey(hostId)).then(
      (password) => { if (active) setAuthorizationPasswordSaved(Boolean(password)); },
      () => {
        if (!active) return;
        setAuthorizationPasswordSaved(false);
        setNotice('Unable to read the saved Host password.');
      },
    );
    return () => { active = false; };
  }, [hostId]);

  const submitAuthorization = useCallback((password: string) => {
    if (!send({ type: 'authorize', password })) {
      setAuthorizationSubmitting(false);
      setNotice('Disconnected. Authorization was not submitted.');
      return false;
    }
    setAuthorizationSubmitting(true);
    setNotice('Submitting…');
    return true;
  }, [send]);

  const openAuthorizationPasswordModal = useCallback((replacing: boolean) => {
    setAuthorizationReplacingPassword(replacing);
    setAuthorizationPassword('');
    setAuthorizationPasswordIssue(null);
    setAuthorizationPasswordVisible(false);
    setAuthorizationModalOpen(true);
  }, []);

  const closeAuthorizationPasswordModal = useCallback(() => {
    setAuthorizationModalOpen(false);
    setAuthorizationPassword('');
    setAuthorizationPasswordIssue(null);
    setAuthorizationPasswordVisible(false);
    setAuthorizationReplacingPassword(false);
  }, []);

  const authorizationRecovery = authorizationRecoveryState({
    requestActive: authorizationRequestActive,
    passwordSaved: authorizationPasswordSaved === true,
    submittedAt: authorizationSubmittedAt,
    now: authorizationCooldownNow,
  });
  const authorizationCoolingDown = authorizationRecovery === 'cooldown';

  const authorize = useCallback(async () => {
    if (!authorizationRequestActive || connectionState !== 'connected' || authorizationSubmitting) return;
    if (authorizationPasswordSaved) {
      try {
        const password = await SecureStore.getItemAsync(authorizationPasswordKey(hostId));
        if (password) {
          submitAuthorization(password);
          return;
        }
        setAuthorizationPasswordSaved(false);
      } catch {
        setNotice('Unable to read the saved Host password.');
        return;
      }
    }
    openAuthorizationPasswordModal(false);
  }, [authorizationPasswordSaved, authorizationRequestActive, authorizationSubmitting, connectionState, hostId, openAuthorizationPasswordModal, submitAuthorization]);

  const replaceAuthorizationPassword = useCallback(() => {
    if (authorizationRecovery !== 'replace') return;
    openAuthorizationPasswordModal(true);
  }, [authorizationRecovery, openAuthorizationPasswordModal]);

  const saveAndSubmitAuthorization = useCallback(async () => {
    const issue = authorizationPasswordError(authorizationPassword);
    if (issue) {
      setAuthorizationPasswordIssue(issue);
      return;
    }
    if (!authorizationRequestActive) {
      setAuthorizationPasswordIssue('The authorization request has ended.');
      return;
    }
    try {
      await SecureStore.setItemAsync(
        authorizationPasswordKey(hostId),
        authorizationPassword,
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
      );
      setAuthorizationPasswordSaved(true);
      setAuthorizationModalOpen(false);
      setAuthorizationReplacingPassword(false);
      setAuthorizationPasswordVisible(false);
      submitAuthorization(authorizationPassword);
      setAuthorizationPassword('');
    } catch {
      setAuthorizationPasswordIssue('Unable to save the password securely.');
    }
  }, [authorizationPassword, authorizationRequestActive, hostId, submitAuthorization]);

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
          onPress={() => { hostDisconnectedRef.current = false; connectSocket(); }}
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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Submit the current Omarchy authorization request"
        accessibilityState={{ disabled: !authorizationRequestActive || connectionState !== 'connected' || authorizationSubmitting || authorizationCoolingDown || authorizationPasswordSaved === undefined }}
        disabled={!authorizationRequestActive || connectionState !== 'connected' || authorizationSubmitting || authorizationCoolingDown || authorizationPasswordSaved === undefined}
        onPress={() => void authorize()}
        style={({ pressed }) => [
          styles.authorizationButton,
          authorizationRequestActive && connectionState === 'connected' && styles.authorizationButtonActive,
          pressed && styles.authorizationButtonPressed,
        ]}
      >
        <MaterialCommunityIcons
          name="shield-key-outline"
          size={18}
          color={authorizationRequestActive && connectionState === 'connected' ? theme.color.onPrimary : theme.color.textSubtle}
        />
        <Text style={[
          styles.authorizationButtonText,
          authorizationRequestActive && connectionState === 'connected' && styles.authorizationButtonTextActive,
        ]}>Authorize</Text>
        <Text style={[
          styles.authorizationButtonState,
          authorizationRequestActive && connectionState === 'connected' && styles.authorizationButtonTextActive,
        ]}>{authorizationSubmitting ? 'Submitting' : authorizationCoolingDown ? 'Please wait' : authorizationRequestActive ? 'Request pending' : 'No request'}</Text>
      </Pressable>

      {authorizationRecovery === 'cooldown' ? (
        <Text style={styles.authorizationRecoveryHint}>Submitted. Password retry will be available shortly.</Text>
      ) : null}
      {authorizationRecovery === 'replace' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Replace this Host authorization password"
          onPress={replaceAuthorizationPassword}
          style={({ pressed }) => [styles.authorizationReplaceButton, pressed && styles.controlPressed]}
        >
          <MaterialCommunityIcons name="key-change" size={16} color={theme.color.textStrong} />
          <Text style={styles.authorizationReplaceText}>Replace password</Text>
        </Pressable>
      ) : null}

      <View style={styles.panelContainer}>
        {panel === 'pad' ? (
          <PadPanel
            send={send}
            pressKey={pressKey}
            releaseKey={releaseKey}
            pressPointerButton={pressPointerButton}
            releasePointerButton={releasePointerButton}
            windowDragSupported={pointerButtonSupported}
            textSubmitSupported={textSubmitSupported}
            connected={connectionState === 'connected'}
            setNotice={setNotice}
          />
        ) : null}
        {panel === 'keys' ? <KeysPanel pressKey={pressKey} releaseKey={releaseKey} releaseAll={releaseAll} /> : null}
        {panel === 'actions' ? (
          <ActionsPanel
            capabilities={capabilities}
            capabilityError={capabilityError}
            sendAction={sendAction}
          />
        ) : null}
        {panel === 'media' ? <MediaPanel sendAction={sendAction} /> : null}
      </View>

      {notice ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss message" onPress={() => setNotice(null)} style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
        </Pressable>
      ) : null}

      <Modal
        visible={authorizationModalOpen}
        transparent
        animationType="fade"
        onRequestClose={closeAuthorizationPasswordModal}
      >
        {/* The edge-to-edge dialog window does not resize for the IME, so keep the form in the top half. */}
        <View style={[styles.modalScrim, { paddingTop: topSafeArea + 48 }]}>
          <View style={styles.authorizationDialog}>
            <Text style={styles.authorizationDialogTitle}>{authorizationReplacingPassword ? 'Replace Host password' : 'Save Host password'}</Text>
            <Text style={styles.authorizationDialogBody}>Stored securely on this phone only. ASCII passwords supported.</Text>
            <View style={styles.authorizationPasswordRow}>
              <TextInput
                value={authorizationPassword}
                onChangeText={(value) => { setAuthorizationPassword(value); setAuthorizationPasswordIssue(null); }}
                autoFocus
                secureTextEntry={shouldMaskAuthorizationPassword(authorizationPasswordVisible)}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Password"
                placeholderTextColor={theme.color.textSubtle}
                onSubmitEditing={() => void saveAndSubmitAuthorization()}
                style={styles.authorizationPasswordInput}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={authorizationPasswordVisible ? 'Hide password' : 'Show password'}
                onPress={() => setAuthorizationPasswordVisible((visible) => !visible)}
                style={({ pressed }) => [styles.authorizationVisibilityButton, pressed && styles.controlPressed]}
              >
                <MaterialCommunityIcons
                  name={authorizationPasswordVisible ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={theme.color.textStrong}
                />
              </Pressable>
            </View>
            {authorizationPasswordIssue ? <Text style={styles.authorizationPasswordIssue}>{authorizationPasswordIssue}</Text> : null}
            <View style={styles.authorizationDialogActions}>
              <Pressable onPress={closeAuthorizationPasswordModal} style={styles.authorizationCancelButton}>
                <Text style={styles.authorizationCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void saveAndSubmitAuthorization()}
                disabled={!authorizationRequestActive}
                style={[styles.authorizationSubmitButton, !authorizationRequestActive && styles.controlDisabled]}
              >
                <Text style={styles.authorizationSubmitText}>{authorizationReplacingPassword ? 'Replace and submit' : 'Save and submit'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  textSubmitSupported: boolean;
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
  textSubmitSupported,
  connected,
  setNotice,
}: PadProps) {
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  const [latchedModifiers, setLatchedModifiers] = useState<string[]>([]);
  const [keyboardHeight, setKeyboardHeight] = useState<number | null>(
    () => Keyboard.metrics()?.height ?? null,
  );
  const { bottom: bottomSafeArea } = useSafeAreaInsets();
  const gestureRef = useRef<GestureState | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latchedModifiersRef = useRef<string[]>([]);
  const wheel = useMemo(() => createWheelMotion(
    (dy) => send({ type: 'wheel', dy }),
    { request: requestAnimationFrame, cancel: cancelAnimationFrame },
    () => performance.now(),
  ), [send]);
  // Edge-to-edge Android windows keep their full height while the IME overlays them.
  const keyboardInset = keyboardInsetFor(Platform.OS, keyboardHeight, bottomSafeArea);

  useEffect(() => {
    const show = (event: KeyboardEvent) => {
      setKeyboardHeight(event.endCoordinates.height);
    };
    const showSubscription = Keyboard.addListener('keyboardDidShow', show);
    const frameSubscription = Keyboard.addListener('keyboardDidChangeFrame', show);
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(null));
    return () => {
      showSubscription.remove();
      frameSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const clearHold = useCallback(() => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  }, []);

  // React Native hands a second finger to the view that already owns the first touch, so a modifier held on the
  // key bar cannot coexist with a pad touch. The bar's modifiers latch instead and apply to the next click,
  // drag, or quick key, then release.
  const releaseLatched = useCallback(() => {
    for (const code of latchedModifiersRef.current) releaseKey(code);
    latchedModifiersRef.current = [];
    setLatchedModifiers([]);
  }, [releaseKey]);

  const toggleModifier = useCallback((code: string) => {
    const latched = latchedModifiersRef.current;
    if (latched.includes(code)) {
      releaseKey(code);
      latchedModifiersRef.current = latched.filter((held) => held !== code);
    } else if (pressKey(code)) {
      latchedModifiersRef.current = [...latched, code];
    }
    setLatchedModifiers(latchedModifiersRef.current);
  }, [pressKey, releaseKey]);

  const releaseQuickKey = useCallback((code: string) => {
    releaseKey(code);
    releaseLatched();
  }, [releaseKey, releaseLatched]);

  useEffect(() => {
    // The control surface already released every held key when the connection dropped.
    if (connected) return;
    latchedModifiersRef.current = [];
    setLatchedModifiers([]);
  }, [connected]);

  const click = useCallback((button: PointerButton, clickCount: number) => {
    send({ type: 'click', button, clickCount });
    releaseLatched();
  }, [releaseLatched, send]);

  // A gesture that starts right after a tap owes that tap's single click unless it becomes a double click or a drag.
  const settleOwedClick = useCallback((gesture: GestureState) => {
    if (!gesture.afterTap) return;
    gesture.afterTap = false;
    click('left', 1);
  }, [click]);

  const beginDrag = useCallback((gesture: GestureState) => {
    if (!windowDragSupported) setNotice('Drag requires a TapPad Host with pointer hold support.');
    if (!windowDragSupported || !pressPointerButton('left')) {
      settleOwedClick(gesture);
      return;
    }
    gesture.afterTap = false;
    gesture.mode = 'drag';
    setDragging(true);
  }, [pressPointerButton, setNotice, settleOwedClick, windowDragSupported]);

  const endDrag = useCallback(() => {
    releasePointerButton('left');
    releaseLatched();
    setDragging(false);
  }, [releaseLatched, releasePointerButton]);

  const endGesture = useCallback((canceled: boolean) => {
    clearHold();
    const gesture = gestureRef.current;
    gestureRef.current = null;
    // A scroll coasts on after the fingers lift; one that switched to the pointer already started its coast.
    if (canceled) wheel.stop();
    else if (gesture?.mode === 'scroll') wheel.release();
    if (!gesture) return;

    if (gesture.mode === 'drag') {
      endDrag();
      return;
    }
    const now = Date.now();
    if (!canceled && shouldRightClick(gesture, now)) {
      click('right', 1);
      return;
    }
    if (canceled || !shouldTap(gesture, now)) {
      settleOwedClick(gesture);
      return;
    }
    if (gesture.afterTap) {
      click('left', 2);
      return;
    }
    pendingTapTimerRef.current = setTimeout(() => {
      pendingTapTimerRef.current = null;
      click('left', 1);
    }, DOUBLE_TAP_WINDOW_MS);
  }, [clearHold, click, endDrag, settleOwedClick, wheel]);

  useEffect(() => () => {
    clearHold();
    wheel.stop();
    if (pendingTapTimerRef.current) clearTimeout(pendingTapTimerRef.current);
    if (gestureRef.current?.mode === 'drag') releasePointerButton('left');
    releaseLatched();
  }, [clearHold, releaseLatched, releasePointerButton, wheel]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => true,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (event) => {
      const points = pointsFromTouches(event.nativeEvent.touches);
      const point = points[0] ?? { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
      // A touch while the last tap's click is still deferred continues that tap as a double click or a drag.
      const afterTap = pendingTapTimerRef.current !== null;
      if (pendingTapTimerRef.current) clearTimeout(pendingTapTimerRef.current);
      pendingTapTimerRef.current = null;
      const gesture = beginGesture(point, Date.now(), afterTap);
      // A touch that stops a coasting scroll is not a tap, so it cannot click whatever scrolled under the pointer.
      if (wheel.stop()) gesture.moved = true;
      gestureRef.current = gesture;
      clearHold();
      if (!afterTap) return;
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        if (gestureRef.current === gesture && shouldBeginDrag(gesture)) beginDrag(gesture);
      }, TAP_MAX_DURATION_MS);
    },
    onPanResponderStart: (event) => {
      // A second finger landing rules out tap-and-drag before the hold timer or the next move can start one.
      const gesture = gestureRef.current;
      if (!gesture) return;
      gesture.maxTouches = Math.max(gesture.maxTouches, event.nativeEvent.touches.length);
      if (gesture.maxTouches < 2) return;
      clearHold();
      settleOwedClick(gesture);
    },
    onPanResponderMove: (event) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      const points = pointsFromTouches(event.nativeEvent.touches);
      gesture.maxTouches = Math.max(gesture.maxTouches, points.length);

      if (points.length >= 2) {
        clearHold();
        settleOwedClick(gesture);
        if (gesture.mode === 'drag') endDrag();
        const next = centroid(points.slice(0, 2));
        if (gesture.mode !== 'scroll') {
          gesture.mode = 'scroll';
          gesture.anchor = next;
          gesture.last = next;
          return;
        }
        const dy = next.y - gesture.last.y;
        recordPosition(gesture, next);
        wheel.push(-dy * 0.25);
        return;
      }

      const next = points[0];
      if (!next) return;
      if (gesture.mode === 'scroll') {
        // Fingers rarely lift together; the first one lifting ends the scroll.
        wheel.release();
        gesture.mode = 'pointer';
        gesture.anchor = next;
        gesture.last = next;
        return;
      }
      const dx = next.x - gesture.last.x;
      const dy = next.y - gesture.last.y;
      recordPosition(gesture, next);
      if (gesture.moved && shouldBeginDrag(gesture)) {
        clearHold();
        beginDrag(gesture);
      }
      if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
        send({ type: 'move', dx: dx * 1.25, dy: dy * 1.25 });
      }
    },
    onPanResponderRelease: () => endGesture(false),
    onPanResponderTerminate: () => endGesture(true),
  }), [
    beginDrag,
    clearHold,
    endDrag,
    endGesture,
    send,
    settleOwedClick,
    wheel,
  ]);

  const sendText = useCallback((pressEnter: boolean) => {
    if (!text.trim()) return;
    // A latched Super or Ctrl would turn typed text into shortcuts.
    releaseLatched();
    const submit = pressEnter && textSubmitSupported;
    if (!send({ type: 'text', value: text, submit })) {
      setNotice('Text was not sent because TapPad is disconnected.');
      return;
    }
    setText('');
    if (!pressEnter) setNotice('已发送文字，未按回车。');
    else if (!submit) setNotice('已发送文字；此 Host 版本不支持发送后回车，请更新 Host 或再点 Enter。');
  }, [releaseLatched, send, setNotice, text, textSubmitSupported]);

  const superLatched = latchedModifiers.includes('MetaLeft');
  return (
    <View style={[styles.padPanel, keyboardInset > 0 && { paddingBottom: keyboardInset + theme.space.sm }]}>
      <View
        {...panResponder.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel="Touchpad. Move one finger for pointer, tap to click, tap then hold to drag, two fingers to scroll, two-finger tap to right click."
        style={[styles.touchPad, !connected && styles.controlDisabled, dragging && styles.touchPadDragging]}
      >
        <View style={styles.padGuide}>
          <Text style={styles.padHint}>{dragging ? 'Dragging' : 'Move · Tap · Two-finger scroll'}</Text>
          <Text style={styles.padLongHint}>
            {dragging
              ? 'Release to drop'
              : superLatched
                ? 'Super held: tap, then hold to move a window'
                : 'Tap, then hold to drag · Two-finger tap: right click'}
          </Text>
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
          accessibilityLabel="Send text and press Enter"
          accessibilityHint="Long press to send the text without pressing Enter."
          onPress={() => sendText(true)}
          onLongPress={() => sendText(false)}
          style={({ pressed }) => [styles.sendButton, pressed && styles.sendButtonPressed]}
        >
          <Text style={styles.sendButtonText}>Send</Text>
          <MaterialCommunityIcons name="keyboard-return" size={15} color={theme.color.onPrimary} />
        </Pressable>
      </View>
      <View style={styles.quickKeys}>
        {[['Super', 'MetaLeft'], ['Alt', 'AltLeft'], ['Ctrl', 'ControlLeft'], ['Shift', 'ShiftLeft']].map(([label, code]) => (
          <LatchKeyButton
            key={code}
            label={label}
            latched={latchedModifiers.includes(code)}
            onPress={() => toggleModifier(code)}
          />
        ))}
        {[['Enter', 'Enter'], ['⌫', 'Backspace']].map(([label, code]) => (
          <KeyButton key={code} label={label} code={code} onDown={pressKey} onUp={releaseQuickKey} compact />
        ))}
      </View>
    </View>
  );
}

function LatchKeyButton({ label, latched, onPress }: { label: string; latched: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: latched }}
      onPress={onPress}
      style={({ pressed }) => [styles.keyButton, styles.keyButtonCompact, (latched || pressed) && styles.keyButtonPressed]}
    >
      <Text style={[styles.keyButtonText, latched && styles.keyButtonTextPressed]}>{label}</Text>
    </Pressable>
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
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const workspaceActions = supportedWorkspaceActions(capabilities);

  return (
    <ScrollView
      contentContainerStyle={styles.actionsPanel}
      scrollEnabled={contentHeight > viewportHeight + 1}
      onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
      onContentSizeChange={(_, height) => setContentHeight(height)}
      showsVerticalScrollIndicator={false}
    >
      {!capabilities && !capabilityError ? <Text style={styles.sectionBody}>Checking availability…</Text> : null}
      {capabilityError ? <Text style={styles.inlineWarning}>Availability check failed: {capabilityError}</Text> : null}
      {workspaceActions.length > 0 ? (
        <View style={styles.actionGroup}>
          <Text style={styles.groupTitle}>Workspaces</Text>
          <View style={styles.workspaceControls}>
            <View style={styles.workspaceNumberRow}>
              {workspaceActions.map(({ label, action }) => (
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
                    group.title === 'Desktop' && styles.desktopActionButton,
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
  authorizationButton: { minHeight: 46, marginHorizontal: 14, marginTop: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: theme.radius.control, backgroundColor: theme.color.surfaceMuted, borderWidth: 1, borderColor: theme.color.border },
  authorizationButtonActive: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  authorizationButtonPressed: { opacity: 0.82 },
  authorizationButtonText: { color: theme.color.textSubtle, fontSize: 13, fontWeight: '800' },
  authorizationButtonTextActive: { color: theme.color.onPrimary },
  authorizationButtonState: { marginLeft: 'auto', color: theme.color.textSubtle, fontSize: 11, fontWeight: '700' },
  authorizationRecoveryHint: { marginHorizontal: 16, marginTop: 5, color: theme.color.textSubtle, fontSize: 11 },
  authorizationReplaceButton: { minHeight: 40, marginHorizontal: 14, marginTop: 6, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: theme.radius.control, backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.borderStrong },
  authorizationReplaceText: { color: theme.color.textStrong, fontSize: 12, fontWeight: '700' },
  panelContainer: { flex: 1, marginTop: 7 },
  notice: { marginHorizontal: theme.space.md, marginBottom: theme.space.sm, paddingHorizontal: 13, paddingVertical: 9, borderRadius: theme.radius.panel, backgroundColor: theme.color.surfaceMuted, borderWidth: 1, borderColor: theme.color.border },
  noticeText: { color: theme.color.textMuted, fontSize: 12, lineHeight: 17 },
  padPanel: { flex: 1, paddingHorizontal: theme.space.md, paddingBottom: theme.space.sm },
  touchPad: { flex: 1, minHeight: 250, borderRadius: theme.radius.pad, overflow: 'hidden', alignItems: 'center', backgroundColor: theme.color.surfaceMuted, borderWidth: 1, borderColor: theme.color.border },
  touchPadDragging: { borderColor: theme.color.borderStrong, backgroundColor: theme.color.surfacePressed },
  controlDisabled: { opacity: 0.58 },
  padGuide: { position: 'absolute', bottom: 15, alignItems: 'center' },
  padHint: { color: theme.color.textMuted, fontSize: 11, fontWeight: '600' },
  padLongHint: { color: theme.color.textSubtle, fontSize: 10, marginTop: theme.space.xxs },
  textRow: { flexDirection: 'row', gap: theme.space.sm, marginTop: theme.space.sm },
  textInput: { flex: 1, minHeight: 46, maxHeight: 80, borderRadius: theme.radius.panel, paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm, backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border, color: theme.color.text, fontSize: 13 },
  sendButton: { width: 66, minHeight: 46, flexDirection: 'row', gap: 3, borderRadius: theme.radius.panel, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.primary },
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
  actionsPanel: { paddingHorizontal: 14, paddingTop: 2, paddingBottom: 8, gap: 14 },
  actionGroup: { marginTop: 0 },
  groupTitle: { color: theme.color.textMuted, fontSize: 12, fontWeight: '700' },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  actionButton: { width: '31.5%', minHeight: 52, borderRadius: theme.radius.panel, paddingHorizontal: 8, paddingVertical: 8, justifyContent: 'center', backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  desktopActionButton: { width: '48.5%' },
  actionButtonPressed: { backgroundColor: theme.color.surfacePressed },
  actionButtonUnavailable: { backgroundColor: theme.color.warningSurface, borderColor: theme.color.warningBorder },
  actionButtonText: { color: theme.color.textStrong, fontSize: 13, fontWeight: '700' },
  actionStateUnavailable: { color: theme.color.warning, fontSize: 10, fontWeight: '700', marginTop: 4 },
  workspaceControls: { marginTop: 8 },
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
  modalScrim: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', padding: 24, backgroundColor: 'rgba(0, 0, 0, 0.36)' },
  authorizationDialog: { width: '100%', maxWidth: 420, padding: 18, borderRadius: theme.radius.panel, backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  authorizationDialogTitle: { color: theme.color.text, fontSize: 18, fontWeight: '800' },
  authorizationDialogBody: { color: theme.color.textMuted, fontSize: 13, lineHeight: 19, marginTop: 8 },
  authorizationPasswordRow: { height: 44, marginTop: 14, flexDirection: 'row', alignItems: 'center', borderRadius: theme.radius.control, borderWidth: 1, borderColor: theme.color.borderStrong, backgroundColor: theme.color.canvas },
  authorizationPasswordInput: { flex: 1, height: 42, paddingLeft: 12, paddingRight: 4, color: theme.color.text },
  authorizationVisibilityButton: { width: 44, height: 42, alignItems: 'center', justifyContent: 'center' },
  authorizationPasswordIssue: { color: theme.color.danger, fontSize: 12, marginTop: 8 },
  authorizationDialogActions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  authorizationCancelButton: { flex: 1, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.control, backgroundColor: theme.color.surfaceMuted, borderWidth: 1, borderColor: theme.color.border },
  authorizationCancelText: { color: theme.color.textStrong, fontSize: 14, fontWeight: '700' },
  authorizationSubmitButton: { flex: 1, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.control, backgroundColor: theme.color.primary },
  authorizationSubmitText: { color: theme.color.onPrimary, fontSize: 14, fontWeight: '700' },
});
