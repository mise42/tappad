import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons

Item {
  id: root

  property QtObject bar: null
  property var anchorItem: null
  property bool opened: false
  property bool loading: false
  property string qrSource: ""
  property string pairingUrl: ""
  property string error: ""

  function open() {
    root.opened = true
    root.loading = true
    root.qrSource = ""
    root.pairingUrl = ""
    root.error = ""
    pairingProcess.running = true
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    root.opened = false
    root.loading = false
    root.qrSource = ""
    root.pairingUrl = ""
    root.error = ""
    if (pairingProcess.running) pairingProcess.running = false
  }

  function toggle() {
    if (root.opened) root.close()
    else root.open()
  }

  Process {
    id: pairingProcess
    command: ["tappad-host", "pairing"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        if (!root.opened) return
        try {
          const state = JSON.parse(text)
          root.qrSource = state.pairing.qrCodeDataUrl || ""
          root.pairingUrl = state.pairing.preferredUrl || ""
          root.error = root.qrSource === "" ? "Pairing QR is unavailable" : ""
        } catch (error) {
          root.error = "Could not read pairing information"
        }
      }
    }
    stderr: StdioCollector {
      waitForEnd: true
      onStreamFinished: if (root.opened && String(text || "").trim() !== "") root.error = String(text).trim()
    }
    onExited: function(exitCode) {
      root.loading = false
      if (root.opened && exitCode !== 0 && root.error === "") root.error = "TapPad Host is unavailable"
    }
  }

  PanelWindow {
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.namespace: "tappad-pairing"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive

    Rectangle {
      anchors.fill: parent
      color: Qt.rgba(0, 0, 0, 0.78)
      MouseArea { anchors.fill: parent; onClicked: root.close() }
    }

    Item {
      id: keyCatcher
      anchors.fill: parent
      focus: true
      Keys.onEscapePressed: root.close()

      Rectangle {
        anchors.centerIn: parent
        width: Math.min(420, parent.width - 32)
        height: content.implicitHeight + 48
        radius: 18
        color: "#171917"

        MouseArea { anchors.fill: parent; onClicked: {} }

        ColumnLayout {
          id: content
          anchors.centerIn: parent
          width: parent.width - 48
          spacing: 16

          Text {
            text: "TAPPAD"
            color: "white"
            font.family: Style.font.family
            font.pixelSize: 22
            font.bold: true
            Layout.alignment: Qt.AlignHCenter
          }

          Image {
            visible: root.qrSource !== ""
            source: root.qrSource
            sourceSize.width: 280
            sourceSize.height: 280
            fillMode: Image.PreserveAspectFit
            Layout.preferredWidth: 280
            Layout.preferredHeight: 280
            Layout.alignment: Qt.AlignHCenter
          }

          Text {
            visible: root.loading
            text: "Loading pairing code…"
            color: "#b8b8b8"
            font.family: Style.font.family
            font.pixelSize: 14
            Layout.alignment: Qt.AlignHCenter
          }

          Text {
            visible: root.error !== ""
            text: root.error
            color: "#ff6b6b"
            font.family: Style.font.family
            font.pixelSize: 14
            wrapMode: Text.Wrap
            horizontalAlignment: Text.AlignHCenter
            Layout.fillWidth: true
          }

          Text {
            visible: root.qrSource !== ""
            text: "Scan in the TapPad app to pair this Host"
            color: "#b8b8b8"
            font.family: Style.font.family
            font.pixelSize: 14
            wrapMode: Text.Wrap
            horizontalAlignment: Text.AlignHCenter
            Layout.fillWidth: true
          }
        }
      }
    }
  }
}
