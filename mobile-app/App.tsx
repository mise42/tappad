import * as ServiceDiscovery from '@inthepocket/react-native-service-discovery';
import type { Service } from '@inthepocket/react-native-service-discovery';
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

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>LOCAL INPUT</Text>
          <Text style={styles.title}>Nearby TapPad hosts</Text>
          <Text style={styles.subtitle}>
            Hosts appear automatically when this phone and the desktop are on the same local network.
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {selected ? (
          <View style={styles.pairingCard}>
            <Text style={styles.cardLabel}>PAIR WITH</Text>
            <Text style={styles.cardTitle}>{displayName(selected)}</Text>
            <Text style={styles.hostAddress}>{connectionHost(selected)}:{selected.port}</Text>
            <TextInput
              value={token}
              onChangeText={setToken}
              placeholder="Pairing token"
              placeholderTextColor="#7A828D"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={styles.input}
              editable={!connecting}
              onSubmitEditing={() => void connect(selected, token)}
            />
            <View style={styles.actions}>
              <Pressable onPress={() => { setSelected(null); setToken(''); setError(null); }} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={() => void connect(selected, token)} style={[styles.primaryButton, connecting && styles.buttonDisabled]} disabled={connecting}>
                {connecting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Connect</Text>}
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
                  style={[styles.hostCard, connecting && styles.buttonDisabled]}
                  onPress={() => void selectHost(item)}
                >
                  <View style={styles.hostIcon}><View style={styles.hostIconDot} /></View>
                  <View style={styles.hostDetails}>
                    <Text style={styles.hostName}>{displayName(item)}</Text>
                    <Text style={styles.hostMeta}>{connectionHost(item)}:{item.port}</Text>
                  </View>
                  <Text style={styles.hostState}>{saved ? 'Paired' : 'Pair'}</Text>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                {discovering ? <ActivityIndicator color="#4361EE" /> : null}
                <Text style={styles.emptyTitle}>Looking for hosts…</Text>
                <Text style={styles.emptyBody}>Keep the TapPad Desktop Host running and check that both devices use the same Wi-Fi.</Text>
                <Pressable onPress={() => void beginDiscovery()} style={styles.retryButton}>
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
  safeArea: { flex: 1, backgroundColor: '#F5F7FA' },
  container: { flex: 1, paddingHorizontal: 20 },
  hero: { paddingTop: 28, paddingBottom: 22 },
  eyebrow: { color: '#4361EE', fontSize: 12, fontWeight: '800', letterSpacing: 1.7 },
  title: { color: '#171A21', fontSize: 32, fontWeight: '800', marginTop: 8 },
  subtitle: { color: '#606873', fontSize: 15, lineHeight: 22, marginTop: 10, maxWidth: 520 },
  error: { color: '#A32929', backgroundColor: '#FDECEC', borderRadius: 12, padding: 12, marginBottom: 14 },
  hostList: { gap: 12, paddingBottom: 28, flexGrow: 1 },
  hostCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: '#E6E9EF' },
  hostIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#E9EDFF', alignItems: 'center', justifyContent: 'center' },
  hostIconDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#4361EE' },
  hostDetails: { flex: 1, marginLeft: 14 },
  hostName: { color: '#171A21', fontSize: 17, fontWeight: '700' },
  hostMeta: { color: '#747C87', fontSize: 13, marginTop: 4 },
  hostState: { color: '#4361EE', fontSize: 14, fontWeight: '700' },
  emptyState: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  emptyTitle: { color: '#252A33', fontSize: 18, fontWeight: '700', marginTop: 16 },
  emptyBody: { color: '#717985', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8 },
  retryButton: { marginTop: 20, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 12, backgroundColor: '#E9EDFF' },
  retryButtonText: { color: '#3651CF', fontWeight: '700' },
  pairingCard: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 20, borderWidth: 1, borderColor: '#E6E9EF' },
  cardLabel: { color: '#7A828D', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  cardTitle: { color: '#171A21', fontSize: 24, fontWeight: '800', marginTop: 8 },
  hostAddress: { color: '#747C87', fontSize: 14, marginTop: 5 },
  input: { height: 52, borderWidth: 1, borderColor: '#CDD2DB', borderRadius: 13, paddingHorizontal: 14, fontSize: 16, color: '#171A21', marginTop: 22 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  secondaryButton: { flex: 1, height: 50, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF0F4' },
  secondaryButtonText: { color: '#454C57', fontSize: 16, fontWeight: '700' },
  primaryButton: { flex: 1, height: 50, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#4361EE' },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  buttonDisabled: { opacity: 0.65 },
});
