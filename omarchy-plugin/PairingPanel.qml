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
          root.error = !root.hostRunning ? "Host 未运行，请启动后连接。"
            : root.clients.length === 0 && state.lastRejectedAt && Date.now() - state.lastRejectedAt < 60000
              ? "刚才的配对被拒绝，请在手机重新扫描当前二维码。" : ""
        } catch (error) { root.error = "无法读取 Host 状态，请检查 Host 服务。" }
      }
    }
    onExited: function(code) { if (code !== 0) root.error = "无法读取 Host 状态。" }
  }
  Process {
    id: actionProcess
    onExited: function(code) {
      root.error = code === 0 ? "" : "操作失败，请刷新状态后重试。"
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
        catch (error) { root.error = "无法读取配对二维码。" }
      }
    }
    onExited: function(code) { root.loading = false; if (code !== 0) root.error = "无法读取配对二维码。" }
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
          meta: root.hostRunning ? "Host 运行中 · " + (root.clients.length > 0 ? root.clients.length + " 台客户端已连接" : "等待手机连接") : "Host 已停止"
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
              Text { width: parent.width; textFormat: Text.PlainText; text: "客户端自报名称 · 已接收 " + modelData.inputMessages + " 条输入"; color: Color.muted; font.family: Style.font.family; font.pixelSize: Math.max(10, Style.font.body - 2); wrapMode: Text.Wrap }
            }
            PanelActionButton {
              id: disconnectButton
              iconText: "󰅖"
              tooltipText: "断开当前连接（保留配对）"
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
            tooltipText: root.showPairing ? "收起二维码" : "连接新手机"
            focusable: true
            onClicked: root.togglePairing()
          }
          Text {
            text: root.showPairing ? "收起二维码" : "连接新手机"
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
          text: root.loading ? "正在读取二维码…" : "在原生 TapPad App 中选择此 Host，再扫码配对。"
          color: Color.muted
          font.family: Style.font.family
          font.pixelSize: Style.font.body
          wrapMode: Text.Wrap
        }
      }
    }
  }
}
