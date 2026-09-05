import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

Panel {
  id: root
  moduleName: "io.miselabs.tappad"
  manageIpc: false
  property Item anchorItem: null
  property bool hostRunning: false
  property string hostName: "TapPad"
  property var clients: []
  property string address: ""
  property string error: ""
  property bool showPairing: false
  property string qrSource: ""
  property bool loading: false

  function refresh() { if (!statusProcess.running) statusProcess.running = true }
  function togglePairing() {
    showPairing = !showPairing
    qrSource = ""
    if (showPairing) { loading = true; pairingProcess.running = true }
  }
  onOpenedChanged: {
    showPairing = false
    qrSource = ""
    error = ""
    if (opened) refresh()
    else if (pairingProcess.running) pairingProcess.running = false
  }
  Timer { interval: 2000; repeat: true; running: root.opened; onTriggered: root.refresh() }
  Process {
    id: statusProcess
    command: ["tappad-host", "status"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        if (!root.opened) return
        try {
          const state = JSON.parse(text)
          root.hostRunning = state.serverStatus.running === true
          root.hostName = state.serverStatus.host || "TapPad"
          root.clients = state.clients || []
          root.address = state.pairing.preferredUrl || ""
          root.error = !root.hostRunning ? "Host is stopped. Start it to connect."
            : root.clients.length === 0 && state.lastRejectedAt && Date.now() - state.lastRejectedAt < 60000
              ? "Pairing was rejected. Scan the current QR code again." : ""
        } catch (error) { root.error = "Unable to read Host status. Check the Host service." }
      }
    }
    onExited: function(code) { if (code !== 0) root.error = "Unable to read Host status." }
  }
  Process {
    id: actionProcess
    onExited: function(code) {
      root.error = code === 0 ? "" : "Action failed. Refresh and try again."
      root.refresh()
    }
  }
  Process {
    id: pairingProcess
    command: ["tappad-host", "pairing"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        if (!root.opened || !root.showPairing) return
        try { root.qrSource = JSON.parse(text).pairing.qrCodeDataUrl || "" }
        catch (error) { root.error = "Unable to load the pairing QR code." }
      }
    }
    onExited: function(code) { root.loading = false; if (code !== 0) root.error = "Unable to load the pairing QR code." }
  }
  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(340))
    contentHeight: panel.fittedContentHeight(column.implicitHeight)
    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onActivateRequested: root.togglePairing()
      Column {
        id: column
        width: parent.width
        spacing: Style.space(12)
        PanelHero {
          title: "TapPad · " + root.hostName
          meta: root.hostRunning ? "Host running · " + (root.clients.length > 0 ? root.clients.length + " connected" : "Waiting for a phone") : "Host stopped"
          foreground: root.bar ? root.bar.foreground : Color.foreground
          fontFamily: root.bar ? root.bar.fontFamily : Style.font.family
        }
        Text {
          width: parent.width
          textFormat: Text.PlainText
          text: root.address
          color: Color.muted
          font.family: Style.font.family
          font.pixelSize: Style.font.body
          elide: Text.ElideMiddle
        }
        Repeater {
          model: root.clients
          delegate: Row {
            required property var modelData
            width: column.width
            spacing: Style.space(10)
            Column {
              width: parent.width - disconnectButton.width - Style.space(10)
              spacing: Style.space(3)
              Text { width: parent.width; textFormat: Text.PlainText; text: modelData.name; color: Color.foreground; font.family: Style.font.family; font.pixelSize: Style.font.body; elide: Text.ElideRight }
              Text { width: parent.width; textFormat: Text.PlainText; text: "Reported by client · " + modelData.inputMessages + " input messages received"; color: Color.muted; font.family: Style.font.family; font.pixelSize: Math.max(10, Style.font.body - 2); wrapMode: Text.Wrap }
            }
            PanelActionButton {
              id: disconnectButton
              iconText: "󰅖"
              tooltipText: "Disconnect (keep pairing)"
              focusable: true
              onClicked: { actionProcess.command = ["tappad-host", "disconnect", modelData.id]; actionProcess.running = true }
            }
          }
        }
        Text {
          visible: root.error !== ""
          width: parent.width
          textFormat: Text.PlainText
          text: root.error
          color: Color.urgent
          font.family: Style.font.family
          font.pixelSize: Style.font.body
          wrapMode: Text.Wrap
        }
        Row {
          width: parent.width
          spacing: Style.space(10)
          PanelActionButton {
            iconText: root.showPairing ? "−" : "+"
            tooltipText: root.showPairing ? "Hide QR code" : "Connect a new phone"
            focusable: true
            onClicked: root.togglePairing()
          }
          Text {
            text: root.showPairing ? "Hide QR code" : "Connect a new phone"
            color: Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.body
            anchors.verticalCenter: parent.verticalCenter
            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: root.togglePairing() }
          }
        }
        Image {
          visible: root.showPairing && root.qrSource !== ""
          anchors.horizontalCenter: parent.horizontalCenter
          width: Math.min(parent.width, Style.space(260))
          height: width
          source: root.qrSource
          sourceSize.width: width * 2
          sourceSize.height: height * 2
          cache: false
          fillMode: Image.PreserveAspectFit
        }
        Text {
          visible: root.showPairing
          width: parent.width
          textFormat: Text.PlainText
          text: root.loading ? "Loading QR code…" : "Select this Host in the TapPad app, then scan to pair."
          color: Color.muted
          font.family: Style.font.family
          font.pixelSize: Style.font.body
          wrapMode: Text.Wrap
        }
      }
    }
  }
}
