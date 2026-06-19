import Foundation
import Darwin

enum NetworkAddresses {
    static func preferredLANAddress() -> String? {
        allIPv4Addresses().first { address in
            address.hasPrefix("192.168.")
                || address.hasPrefix("10.")
                || private172Range(address)
        } ?? allIPv4Addresses().first
    }

    private static func allIPv4Addresses() -> [String] {
        var addresses: [String] = []
        var pointer: UnsafeMutablePointer<ifaddrs>?

        guard getifaddrs(&pointer) == 0, let first = pointer else {
            return []
        }
        defer { freeifaddrs(pointer) }

        for interface in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let flags = Int32(interface.pointee.ifa_flags)
            let isUp = (flags & IFF_UP) != 0
            let isLoopback = (flags & IFF_LOOPBACK) != 0
            guard isUp, !isLoopback else {
                continue
            }

            guard let address = interface.pointee.ifa_addr,
                  address.pointee.sa_family == UInt8(AF_INET) else {
                continue
            }

            var addr = address.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee }
            var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            guard inet_ntop(AF_INET, &addr.sin_addr, &buffer, socklen_t(INET_ADDRSTRLEN)) != nil else {
                continue
            }

            if let end = buffer.firstIndex(of: 0) {
                let address = String(decoding: buffer[..<end].map(UInt8.init(bitPattern:)), as: UTF8.self)
                addresses.append(address)
            }
        }

        return addresses
    }

    private static func private172Range(_ address: String) -> Bool {
        let parts = address.split(separator: ".").compactMap { Int($0) }
        return parts.count == 4 && parts[0] == 172 && (16...31).contains(parts[1])
    }
}
