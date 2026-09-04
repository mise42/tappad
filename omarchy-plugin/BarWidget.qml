import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "io.miselabs.tappad"

  property bool hostRunning: false
  property string statusError: ""
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened : false

  function refresh() {
    if (!statusProcess.running) statusProcess.running = true
  }

  function open() {
    if (panelLoader.item) panelLoader.item.open()
  }

  function close() {
    if (panelLoader.item) panelLoader.item.close()
  }

  function toggle() {
    if (panelLoader.item) panelLoader.item.toggle()
  }

  function injectPanel() {
    if (!panelLoader.item) return
    panelLoader.item.anchorItem = button
    panelLoader.item.bar = root.bar
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  Component.onCompleted: refresh()
  onBarChanged: injectPanel()

  Timer {
    interval: 5000
    repeat: true
    running: true
    onTriggered: root.refresh()
  }

  Process {
    id: statusProcess
    command: ["tappad-host", "status"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        try {
          const state = JSON.parse(text)
          root.hostRunning = state.serverStatus.running === true
          root.statusError = ""
        } catch (error) {
          root.hostRunning = false
          root.statusError = "Invalid Host response"
        }
      }
    }
    stderr: StdioCollector {
      waitForEnd: true
      onStreamFinished: if (String(text || "").trim() !== "") root.statusError = String(text).trim()
    }
    onExited: function(exitCode) {
      if (exitCode !== 0) root.hostRunning = false
    }
  }

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("PairingPanel.qml")
    visible: false
    onLoaded: root.injectPanel()
  }

  IpcHandler {
    target: "io.miselabs.tappad"
    function refresh(): void { root.refresh() }
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "󰌌"
    labelVisible: true
    foreground: root.hostRunning ? (root.bar ? root.bar.foreground : Color.foreground) : Color.muted
    tooltipText: root.hostRunning ? "TapPad is running" : "TapPad is stopped"
    onPressed: function(mouseButton) {
      if (mouseButton === Qt.RightButton && root.bar) root.bar.run("tappad-host restart")
      else root.toggle()
    }
  }
}
