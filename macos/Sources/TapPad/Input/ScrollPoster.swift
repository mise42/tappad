import CoreGraphics
import Foundation
import QuartzCore

final class ScrollPoster: @unchecked Sendable {
    private let lock = NSLock()
    private var velocity: Double = 0
    private var lastInputTime = CACurrentMediaTime()
    private var timer: DispatchSourceTimer?
    private var phase: CGScrollPhase = .began

    private let lineScale = 0.08
    private let decay = 0.08
    private let tickInterval = 1.0 / 120.0
    private let stopVelocity = 35.0

    func push(deltaY: Double) {
        lock.withLock {
            let now = CACurrentMediaTime()
            let dt = max(tickInterval, min(0.08, now - lastInputTime))
            velocity = velocity * pow(decay, dt) + deltaY / dt
            lastInputTime = now

            post(deltaY: deltaY, phase: phase)
            phase = .changed
            ensureTimer()
        }
    }

    private func ensureTimer() {
        guard timer == nil else {
            return
        }

        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInteractive))
        timer.schedule(deadline: .now() + tickInterval, repeating: tickInterval)
        timer.setEventHandler { [weak self] in
            self?.tick()
        }
        self.timer = timer
        timer.resume()
    }

    private func tick() {
        lock.withLock {
            let now = CACurrentMediaTime()
            let dt = max(0, now - lastInputTime)
            lastInputTime = now
            velocity *= pow(decay, dt)

            if abs(velocity) < stopVelocity {
                post(deltaY: 0, phase: .ended)
                timer?.cancel()
                timer = nil
                phase = .began
                velocity = 0
                return
            }

            post(deltaY: velocity * dt, phase: .changed)
        }
    }

    private func post(deltaY: Double, phase: CGScrollPhase) {
        let pointDelta = Int64(deltaY.rounded())
        let lineDelta = Int64((deltaY * lineScale).rounded())
        let fixedDelta = deltaY * 65536

        guard let event = CGEvent(
            scrollWheelEvent2Source: nil,
            units: .pixel,
            wheelCount: 1,
            wheel1: Int32(pointDelta),
            wheel2: 0,
            wheel3: 0
        ) else {
            return
        }

        event.setIntegerValueField(.scrollWheelEventPointDeltaAxis2, value: pointDelta)
        event.setIntegerValueField(.scrollWheelEventDeltaAxis2, value: lineDelta)
        event.setDoubleValueField(.scrollWheelEventFixedPtDeltaAxis2, value: fixedDelta)
        event.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
        event.setIntegerValueField(.scrollWheelEventScrollPhase, value: Int64(phase.rawValue))
        event.post(tap: .cghidEventTap)
    }
}
