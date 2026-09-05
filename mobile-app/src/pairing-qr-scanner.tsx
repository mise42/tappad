import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { BarcodeScanningResult } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { parsePairingQrData } from './pairing-qr';
import { theme } from './theme';

type Props = {
  allowedHosts: readonly string[];
  expectedPort: number;
  hostName: string;
  onCancel: () => void;
  onToken: (token: string) => void;
};

export function PairingQrScanner({ allowedHosts, expectedPort, hostName, onCancel, onToken }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanLocked, setScanLocked] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const requestedPermission = useRef(false);

  useEffect(() => {
    if (!permission || permission.granted || !permission.canAskAgain || requestedPermission.current) return;
    requestedPermission.current = true;
    void requestPermission();
  }, [permission, requestPermission]);

  const handleBarcodeScanned = useCallback((result: BarcodeScanningResult) => {
    if (scanLocked) return;

    const pairing = parsePairingQrData(result.data, allowedHosts, expectedPort);
    if (!pairing.ok) {
      setScanLocked(true);
      setScanError(pairing.error);
      return;
    }

    setScanLocked(true);
    onToken(pairing.token);
  }, [allowedHosts, expectedPort, onToken, scanLocked]);

  if (!permission) {
    return (
      <SafeAreaView style={styles.permissionScreen}>
        <StatusBar style="light" />
        <ActivityIndicator color={theme.color.onPrimary} />
        <Text style={styles.permissionBody}>Preparing the camera…</Text>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permissionScreen}>
        <StatusBar style="light" />
        <View style={styles.permissionIcon}>
          <MaterialCommunityIcons name="camera-outline" size={28} color={theme.color.onPrimary} />
        </View>
        <Text style={styles.permissionTitle}>Camera access needed</Text>
        <Text style={styles.permissionBody}>Allow TapPad to scan the pairing QR code shown by {hostName}.</Text>
        <Pressable
          onPress={() => void (permission.canAskAgain ? requestPermission() : Linking.openSettings())}
          style={({ pressed }) => [styles.permissionButton, pressed && styles.buttonPressed]}
        >
          <Text style={styles.permissionButtonText}>{permission.canAskAgain ? 'Allow camera' : 'Open Settings'}</Text>
        </Pressable>
        <Pressable onPress={onCancel} style={styles.cancelTextButton}>
          <Text style={styles.cancelText}>Enter token manually</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.scanner}>
      <StatusBar style="light" />
      <CameraView
        active
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        facing="back"
        onBarcodeScanned={scanLocked ? undefined : handleBarcodeScanned}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.overlay}>
        <View style={styles.scannerHeader}>
          <Pressable onPress={onCancel} style={({ pressed }) => [styles.closeButton, pressed && styles.buttonPressed]}>
            <MaterialCommunityIcons name="close" size={22} color={theme.color.onPrimary} />
          </Pressable>
          <View style={styles.scannerHeading}>
            <Text style={styles.scannerTitle}>Scan pairing code</Text>
            <Text style={styles.scannerHost} numberOfLines={1}>{hostName}</Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.scannerBody}>
          <View style={[styles.scanFrame, scanError && styles.scanFrameError]}>
            <View style={[styles.corner, styles.cornerTopLeft]} />
            <View style={[styles.corner, styles.cornerTopRight]} />
            <View style={[styles.corner, styles.cornerBottomLeft]} />
            <View style={[styles.corner, styles.cornerBottomRight]} />
          </View>
        </View>

        <View style={styles.scannerFooter}>
          {scanError ? (
            <View style={styles.scanErrorPanel}>
              <Text style={styles.scanErrorText}>{scanError}</Text>
              <Pressable
                onPress={() => { setScanError(null); setScanLocked(false); }}
                style={({ pressed }) => [styles.tryAgainButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.tryAgainText}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.scannerHint}>Point the camera at the QR code shown by TapPad Desktop Host.</Text>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  scanner: { flex: 1, backgroundColor: '#000000' },
  overlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.34)' },
  scannerHeader: { minHeight: 72, paddingHorizontal: theme.space.lg, flexDirection: 'row', alignItems: 'center' },
  closeButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0, 0, 0, 0.56)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.28)' },
  scannerHeading: { flex: 1, alignItems: 'center', paddingHorizontal: theme.space.sm },
  scannerTitle: { color: theme.color.onPrimary, fontSize: 17, fontWeight: '700' },
  scannerHost: { color: 'rgba(255, 255, 255, 0.72)', fontSize: 12, marginTop: theme.space.xxs, maxWidth: 240 },
  headerSpacer: { width: 42 },
  scannerBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  scanFrame: { width: '100%', maxWidth: 330, aspectRatio: 1, borderRadius: 24, backgroundColor: 'rgba(0, 0, 0, 0.08)' },
  scanFrameError: { backgroundColor: 'rgba(154, 59, 69, 0.2)' },
  corner: { position: 'absolute', width: 44, height: 44, borderColor: theme.color.onPrimary },
  cornerTopLeft: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 24 },
  cornerTopRight: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 24 },
  cornerBottomLeft: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 24 },
  cornerBottomRight: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 24 },
  scannerFooter: { minHeight: 156, justifyContent: 'center', paddingHorizontal: 28, paddingBottom: theme.space.lg },
  scannerHint: { color: theme.color.onPrimary, fontSize: 14, lineHeight: 20, textAlign: 'center', fontWeight: '600' },
  scanErrorPanel: { backgroundColor: 'rgba(0, 0, 0, 0.72)', borderRadius: theme.radius.panel, padding: theme.space.lg, gap: theme.space.md, alignItems: 'center' },
  scanErrorText: { color: theme.color.onPrimary, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  tryAgainButton: { minHeight: 40, paddingHorizontal: theme.space.lg, borderRadius: theme.radius.control, backgroundColor: theme.color.onPrimary, alignItems: 'center', justifyContent: 'center' },
  tryAgainText: { color: theme.color.primary, fontSize: 14, fontWeight: '700' },
  permissionScreen: { flex: 1, backgroundColor: '#111111', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  permissionIcon: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 255, 255, 0.12)', marginBottom: theme.space.lg },
  permissionTitle: { color: theme.color.onPrimary, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  permissionBody: { color: 'rgba(255, 255, 255, 0.72)', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: theme.space.sm, maxWidth: 340 },
  permissionButton: { minHeight: 46, borderRadius: theme.radius.control, paddingHorizontal: 24, marginTop: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.onPrimary },
  permissionButtonText: { color: theme.color.primary, fontSize: 15, fontWeight: '700' },
  cancelTextButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.space.md, marginTop: theme.space.sm },
  cancelText: { color: 'rgba(255, 255, 255, 0.78)', fontSize: 14, fontWeight: '600' },
  buttonPressed: { opacity: 0.72 },
});
