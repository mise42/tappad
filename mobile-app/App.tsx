import * as ServiceDiscovery from '@inthepocket/react-native-service-discovery';
import type { Service } from '@inthepocket/react-native-service-discovery';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from 'react-native-safe-area-context';

import { NativeControlSurface } from './src/NativeControlSurface';
import { PairingQrScanner } from './src/pairing-qr-scanner';
import { theme } from './src/theme';

const SERVICE_TYPE = 'tappad';
const PAIRINGS_KEY = 'tappad.pairings.v1';
const CONNECTION_TIMEOUT_MS = 5_000;

type Pairing = { hostId: string; token: string };
type Pairings = Record<string, Pairing>;
type ConnectedHost = { host: string; name: string; port: number; token: string };

function serviceKey(service: Service) {
  return `${service.name}|${service.type}|${service.domain}`;
}

function hostId(service: Service) {
  return service.txt.id || service.hostName || serviceKey(service);
}

function displayName(service: Service) {
  return service.txt.name || service.name || service.hostName;
}

function urlHost(host: string) {
  const normalized = host.replace(/\.$/, '');
  return normalized.includes(':') ? `[${normalized}]` : normalized;
}

function connectionHost(service: Service) {
  const advertisedIpv4 = service.txt.ipv4;
  if (advertisedIpv4) return urlHost(advertisedIpv4);
  const advertisedHost = service.txt.host || service.txt.name;
  if (advertisedHost) return urlHost(advertisedHost);
  if (service.hostName) return urlHost(service.hostName);

  const address = service.addresses.find((candidate) => candidate.includes('.')) ?? service.addresses[0];
  if (!address) throw new Error('The host did not publish a reachable address.');
  return urlHost(address);
}

function pairingHosts(service: Service) {
  return [service.txt.ipv4, service.txt.host, service.hostName, ...service.addresses]
    .filter((host): host is string => Boolean(host));
}

function websocketUrl(service: Service, token: string) {
  return `ws://${connectionHost(service)}:${service.port}/ws?token=${encodeURIComponent(token)}`;
}

function verifyConnection(service: Service, token: string) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(websocketUrl(service, token));
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(
      () => finish(new Error('Connection timed out. Check that both devices are on the same Wi-Fi.')),
      CONNECTION_TIMEOUT_MS,
    );

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'ready') finish();
      } catch {
        finish(new Error('The host returned an invalid pairing response.'));
      }
    };
    socket.onerror = () => finish(new Error('Pairing failed. Check the token shown on the desktop host.'));
    socket.onclose = () => finish(new Error('The host closed the pairing connection.'));
  });
}

async function loadPairings(): Promise<Pairings> {
  const value = await SecureStore.getItemAsync(PAIRINGS_KEY);
  if (!value) return {};
  try {
    return JSON.parse(value) as Pairings;
  } catch {
    return {};
  }
}

async function savePairings(pairings: Pairings) {
  await SecureStore.setItemAsync(PAIRINGS_KEY, JSON.stringify(pairings));
}

function AppContent() {
  const [services, setServices] = useState<Record<string, Service>>({});
  const [pairings, setPairings] = useState<Pairings>({});
  const [selected, setSelected] = useState<Service | null>(null);
  const [token, setToken] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [connectedHost, setConnectedHost] = useState<ConnectedHost | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [autoReconnectEnabled, setAutoReconnectEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const attemptedReconnects = useRef(new Set<string>());

  const hosts = useMemo(
    () => Object.values(services).sort((left, right) => displayName(left).localeCompare(displayName(right))),
    [services],
  );

  const beginDiscovery = useCallback(async () => {
    setError(null);
    setDiscovering(true);
    try {
      await ServiceDiscovery.startSearch(SERVICE_TYPE);
    } catch (cause) {
      setDiscovering(false);
      setError(cause instanceof Error ? cause.message : 'Could not start local host discovery.');
    }
  }, []);

  useEffect(() => {
    void loadPairings().then(setPairings);
    const found = ServiceDiscovery.addEventListener('serviceFound', (service) => {
      setServices((current) => ({ ...current, [serviceKey(service)]: service }));
    });
    const lost = ServiceDiscovery.addEventListener('serviceLost', (service) => {
      setServices((current) => {
        const next = { ...current };
        delete next[serviceKey(service)];
        return next;
      });
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void beginDiscovery();
      else void ServiceDiscovery.stopSearch(SERVICE_TYPE);
    });

    void beginDiscovery();
    return () => {
      found.remove();
      lost.remove();
      appState.remove();
      void ServiceDiscovery.stopSearch(SERVICE_TYPE);
    };
  }, [beginDiscovery]);

  const connect = useCallback(async (service: Service, pairingToken: string) => {
    const normalizedToken = pairingToken.trim();
    if (!normalizedToken) {
      setError('Enter the pairing token shown by the desktop host.');
      return false;
    }

    setConnecting(true);
    setError(null);
    try {
      await verifyConnection(service, normalizedToken);
      const id = hostId(service);
      const nextPairings = { ...pairings, [id]: { hostId: id, token: normalizedToken } };
      await savePairings(nextPairings);
      setPairings(nextPairings);
      setSelected(null);
      setToken('');
      setConnectedHost({
        host: connectionHost(service),
        name: displayName(service),
        port: service.port,
        token: normalizedToken,
      });
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect to this host.');
      return false;
    } finally {
      setConnecting(false);
    }
  }, [pairings]);

  const selectHost = useCallback(async (service: Service) => {
    const saved = pairings[hostId(service)];
    setError(null);

    if (!saved) {
      setSelected(service);
      setToken('');
      return;
    }

    const connected = await connect(service, saved.token);
    if (!connected) {
      setSelected(service);
      setToken(saved.token);
    }
  }, [connect, pairings]);

  useEffect(() => {
    if (!autoReconnectEnabled || connectedHost || selected || connecting) return;
    const pairedHost = hosts.find((service) => pairings[hostId(service)]);
    if (!pairedHost) return;

    const key = serviceKey(pairedHost);
    if (attemptedReconnects.current.has(key)) return;
    attemptedReconnects.current.add(key);
    void connect(pairedHost, pairings[hostId(pairedHost)].token);
  }, [autoReconnectEnabled, connect, connectedHost, connecting, hosts, pairings, selected]);

  if (connectedHost) {
    return (
      <NativeControlSurface
        host={connectedHost.host}
        hostName={connectedHost.name}
        port={connectedHost.port}
        token={connectedHost.token}
        onExit={() => {
          setAutoReconnectEnabled(false);
          setConnectedHost(null);
        }}
      />
    );
  }

  if (scannerOpen && selected) {
    return (
      <PairingQrScanner
        allowedHosts={pairingHosts(selected)}
        expectedPort={selected.port}
        hostName={displayName(selected)}
        onCancel={() => setScannerOpen(false)}
        onToken={(scannedToken) => {
          setScannerOpen(false);
          setToken(scannedToken);
          void connect(selected, scannedToken);
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>TAPPAD</Text>
            <Text style={styles.title}>{selected ? 'Pair host' : 'Hosts'}</Text>
          </View>
          <View style={styles.discoveryStatus}>
            {discovering && !error ? <ActivityIndicator size="small" color={theme.color.textMuted} /> : (
              <View style={[styles.statusDot, error && styles.statusDotError]} />
            )}
            <Text style={styles.discoveryStatusText}>{error ? 'Attention' : 'Discovering'}</Text>
          </View>
        </View>

        {error ? (
          <View style={styles.error}>
            <MaterialCommunityIcons name="alert-circle-outline" size={17} color={theme.color.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {selected ? (
          <View style={styles.pairingPanel}>
            <View style={styles.pairingHeader}>
              <View style={styles.hostGlyph}>
                <MaterialCommunityIcons name="monitor" size={20} color={theme.color.textStrong} />
              </View>
              <View style={styles.hostDetails}>
                <Text style={styles.cardTitle}>{displayName(selected)}</Text>
                <Text style={styles.hostAddress}>{connectionHost(selected)}:{selected.port}</Text>
              </View>
            </View>
            <View style={styles.divider} />
            <Text style={styles.fieldLabel}>SCAN PAIRING QR</Text>
            <Text style={styles.fieldHint}>Scan the code shown by TapPad Desktop Host to pair securely.</Text>
            <Pressable
              onPress={() => { setError(null); setScannerOpen(true); }}
              style={({ pressed }) => [styles.scanButton, pressed && styles.primaryButtonPressed]}
              disabled={connecting}
            >
              <MaterialCommunityIcons name="qrcode-scan" size={19} color={theme.color.onPrimary} />
              <Text style={styles.scanButtonText}>Scan QR code</Text>
            </Pressable>
            <View style={styles.orRow}>
              <View style={styles.orLine} />
              <Text style={styles.orText}>OR ENTER TOKEN</Text>
              <View style={styles.orLine} />
            </View>
            <Text style={styles.fieldHint}>Enter the token manually if the camera is unavailable.</Text>
            <TextInput
              value={token}
              onChangeText={setToken}
              placeholder="Pairing token"
              placeholderTextColor={theme.color.textSubtle}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={styles.input}
              editable={!connecting}
              onSubmitEditing={() => void connect(selected, token)}
            />
            <View style={styles.actions}>
              <Pressable onPress={() => { setSelected(null); setToken(''); setScannerOpen(false); setError(null); }} style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={() => void connect(selected, token)} style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed, connecting && styles.buttonDisabled]} disabled={connecting}>
                {connecting ? <ActivityIndicator color={theme.color.onPrimary} /> : <Text style={styles.primaryButtonText}>Connect</Text>}
              </Pressable>
            </View>
          </View>
        ) : (
          <FlatList
            data={hosts}
            keyExtractor={serviceKey}
            contentContainerStyle={styles.hostList}
            renderItem={({ item }) => {
              const saved = pairings[hostId(item)];
              return (
                <Pressable
                  disabled={connecting}
                  style={({ pressed }) => [styles.hostCard, pressed && styles.hostCardPressed, connecting && styles.buttonDisabled]}
                  onPress={() => void selectHost(item)}
                >
                  <View style={styles.hostGlyph}>
                    <MaterialCommunityIcons name="monitor" size={20} color={theme.color.textStrong} />
                  </View>
                  <View style={styles.hostDetails}>
                    <Text style={styles.hostName}>{displayName(item)}</Text>
                    <Text style={styles.hostMeta}>{connectionHost(item)}:{item.port}</Text>
                  </View>
                  <View style={styles.hostAction}>
                    <Text style={styles.hostState}>{saved ? 'Paired' : 'Pair'}</Text>
                    <MaterialCommunityIcons name="chevron-right" size={19} color={theme.color.textSubtle} />
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <View style={styles.emptyGlyph}>
                  <MaterialCommunityIcons name="radar" size={24} color={theme.color.textMuted} />
                </View>
                <Text style={styles.emptyTitle}>Looking for hosts</Text>
                <Text style={styles.emptyBody}>Keep TapPad Desktop Host running and connect both devices to the same local network.</Text>
                <Pressable onPress={() => void beginDiscovery()} style={({ pressed }) => [styles.retryButton, pressed && styles.secondaryButtonPressed]}>
                  <Text style={styles.retryButtonText}>Scan again</Text>
                </Pressable>
              </View>
            }
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.color.canvas },
  container: { flex: 1, paddingHorizontal: theme.space.lg },
  header: { minHeight: 82, paddingVertical: theme.space.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: theme.color.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: theme.color.text, fontSize: 22, fontWeight: '700', marginTop: theme.space.xxs },
  discoveryStatus: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: theme.space.xs, paddingHorizontal: theme.space.sm, borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.control, backgroundColor: theme.color.surface },
  discoveryStatusText: { color: theme.color.textMuted, fontSize: 12, fontWeight: '600' },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.color.textSubtle },
  statusDotError: { backgroundColor: theme.color.danger },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.sm, backgroundColor: theme.color.dangerSurface, borderRadius: theme.radius.panel, borderWidth: 1, borderColor: theme.color.dangerBorder, padding: theme.space.md, marginBottom: theme.space.md },
  errorText: { flex: 1, color: theme.color.danger, fontSize: 13, lineHeight: 18 },
  hostList: { gap: theme.space.sm, paddingBottom: 28, flexGrow: 1 },
  hostCard: { minHeight: 66, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.color.surface, borderRadius: theme.radius.panel, paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm, borderWidth: 1, borderColor: theme.color.border },
  hostCardPressed: { backgroundColor: theme.color.surfacePressed, borderColor: theme.color.borderStrong },
  hostGlyph: { width: 38, height: 38, borderRadius: theme.radius.control, backgroundColor: theme.color.surfaceMuted, borderWidth: 1, borderColor: theme.color.border, alignItems: 'center', justifyContent: 'center' },
  hostDetails: { flex: 1, marginLeft: theme.space.md },
  hostName: { color: theme.color.text, fontSize: 15, fontWeight: '700' },
  hostMeta: { color: theme.color.textMuted, fontSize: 12, marginTop: theme.space.xxs },
  hostAction: { flexDirection: 'row', alignItems: 'center', gap: theme.space.xxs, marginLeft: theme.space.sm },
  hostState: { color: theme.color.textMuted, fontSize: 12, fontWeight: '700' },
  emptyState: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  emptyGlyph: { width: 44, height: 44, borderRadius: theme.radius.panel, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surfaceMuted, borderWidth: 1, borderColor: theme.color.border },
  emptyTitle: { color: theme.color.textStrong, fontSize: 16, fontWeight: '700', marginTop: theme.space.md },
  emptyBody: { color: theme.color.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: theme.space.xs, maxWidth: 340 },
  retryButton: { marginTop: theme.space.lg, minHeight: 38, paddingHorizontal: theme.space.md, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.control, backgroundColor: theme.color.surfaceMuted, borderWidth: 1, borderColor: theme.color.border },
  retryButtonText: { color: theme.color.textStrong, fontSize: 13, fontWeight: '700' },
  pairingPanel: { backgroundColor: theme.color.surface, borderRadius: theme.radius.panel, padding: theme.space.lg, borderWidth: 1, borderColor: theme.color.border },
  pairingHeader: { flexDirection: 'row', alignItems: 'center' },
  divider: { height: 1, backgroundColor: theme.color.border, marginVertical: theme.space.lg },
  fieldLabel: { color: theme.color.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  fieldHint: { color: theme.color.textMuted, fontSize: 13, lineHeight: 18, marginTop: theme.space.xs },
  cardTitle: { color: theme.color.text, fontSize: 16, fontWeight: '700' },
  hostAddress: { color: theme.color.textMuted, fontSize: 12, marginTop: theme.space.xxs },
  input: { height: 44, borderWidth: 1, borderColor: theme.color.borderStrong, borderRadius: theme.radius.control, paddingHorizontal: theme.space.md, fontSize: 15, color: theme.color.text, backgroundColor: theme.color.canvas, marginTop: theme.space.md },
  scanButton: { height: 44, marginTop: theme.space.md, borderRadius: theme.radius.control, flexDirection: 'row', gap: theme.space.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.primary },
  scanButtonText: { color: theme.color.onPrimary, fontSize: 14, fontWeight: '700' },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, marginTop: theme.space.lg },
  orLine: { flex: 1, height: 1, backgroundColor: theme.color.border },
  orText: { color: theme.color.textSubtle, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  actions: { flexDirection: 'row', gap: theme.space.sm, marginTop: theme.space.md },
  secondaryButton: { flex: 1, height: 42, borderRadius: theme.radius.control, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surfaceMuted, borderWidth: 1, borderColor: theme.color.border },
  secondaryButtonPressed: { backgroundColor: theme.color.surfacePressed, borderColor: theme.color.borderStrong },
  secondaryButtonText: { color: theme.color.textStrong, fontSize: 14, fontWeight: '700' },
  primaryButton: { flex: 1, height: 42, borderRadius: theme.radius.control, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.primary },
  primaryButtonPressed: { backgroundColor: theme.color.primaryPressed },
  primaryButtonText: { color: theme.color.onPrimary, fontSize: 14, fontWeight: '700' },
  buttonDisabled: { opacity: 0.55 },
});
