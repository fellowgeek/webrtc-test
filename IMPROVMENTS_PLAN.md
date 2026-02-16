# Improvement Plan: PHP-Based STUN/TURN Implementation

This document outlines the strategy for implementing STUN (Session Traversal Utilities for NAT) and TURN (Traversal Using Relays around NAT) servers using a PHP back-end.

## 1. Overview

While STUN/TURN servers are typically implemented in low-level languages like C/C++ (e.g., `coturn`) for performance, it is possible to build a functional implementation in PHP using asynchronous networking libraries. This plan focuses on leveraging Composer packages to build a custom solution.

## 2. Technical Stack

- **Runtime**: PHP 8.1+
- **Asynchronous Engine**: [Swoole](https://www.swoole.co.uk/) or [ReactPHP](https://reactphp.org/). Swoole is preferred for its high-performance UDP/TCP handling.
- **Protocol Libraries**:
    - `php-webrtc/stun`: For parsing and generating STUN messages.
    - `php-webrtc/turn`: For handling TURN-specific logic (allocations, relaying).
    - `quasarstream/webrtc` (Alternative): A modern, all-in-one WebRTC implementation for PHP 8.4+ using ReactPHP and FFI.

## 3. Implementation Plan

### Phase 1: Environment Setup
1. **Swoole Installation**: Ensure the Swoole extension is installed (`pecl install swoole`).
2. **Composer Initialization**: Initialize a new project and install dependencies.
   ```bash
   composer require php-webrtc/stun php-webrtc/turn
   ```

### Phase 2: STUN Server Implementation
1. **UDP Listener**: Create a Swoole UDP server listening on port 3478.
2. **Message Handling**:
   - Receive raw UDP packets.
   - Use `PHP-WebRTC/stun` to decode the packet into a `StunMessage`.
   - Identify `BindingRequest`.
   - Send a `BindingResponse` containing the sender's public IP and port (XOR-MAPPED-ADDRESS).

### Phase 3: TURN Server Implementation
1. **Authentication Logic**:
   - Implement the "Long-Term Credential Mechanism".
   - PHP will handle username/password validation against a database or configuration.
2. **Allocation Management**:
   - Handle `AllocateRequest` to reserve a relay port on the server.
   - Track active allocations (using an in-memory store like Redis or Swoole Table).
3. **Relaying Data**:
   - Implement the logic to forward data between the peer and the relay address.
   - Handle `SendIndication` and `DataIndication` messages.
   - Manage `Permission` and `ChannelBind` requests.

### Phase 4: Integration with PeerWire
1. **ICE Configuration**: Update the frontend `RTCPeerConnection` configuration to point to the new PHP server.
2. **Dynamic Credentials**: Implement a PHP endpoint to generate time-limited TURN credentials for clients.

## 4. Challenges & Mitigations

| Challenge | Mitigation |
| :--- | :--- |
| **Performance** | Use Swoole's coroutines and native UDP handling to minimize overhead. |
| **High Load** | For production scaling, consider a load balancer or a hybrid approach where PHP handles auth and a dedicated binary handles relaying. |
| **UDP Fragmentation** | Carefully manage MTU sizes and packet buffering. |

## 5. Alternative (Recommended for Production)

If the PHP implementation faces performance bottlenecks under high concurrent video calls, the recommended path is:
- Use **Coturn** as the engine.
- Use **PHP** to provide the `REST API` for TURN authentication (Shared Secret mechanism).

## 6. Native High-Performance Alternatives

For high-concurrency scenarios and production environments, native implementations in C, Go, or Erlang are recommended due to their superior performance and stability.

### 1. Coturn (C) - The Industry Standard
- **Strengths**: Highly optimized, supports almost all STUN/TURN RFCs, battle-tested in massive deployments.
- **Performance**: Can handle thousands of simultaneous relay sessions per CPU.
- **Ideal for**: Production environments where stability and full protocol support are paramount.

### 2. eturnal (Erlang) - Modern & Scalable
- **Strengths**: Written in Erlang (like WhatsApp), making it naturally proficient at massive concurrency and soft real-time tasks. Easier to configure than Coturn and very Kubernetes-friendly.
- **Performance**: High throughput and excellent resource management under load.
- **Ideal for**: Modern cloud-native deployments and developers looking for a "cleaner" alternative to Coturn.

### 3. Pion TURN (Go) - Developer Friendly
- **Strengths**: A Go-based toolkit that can be embedded directly into Go applications. Great for custom logic and rapid development.
- **Performance**: Good performance, though traditionally slightly behind Coturn in raw UDP relay benchmarks. Improving rapidly.
- **Ideal for**: Scenarios where you want to build a custom TURN server or integrate it deeply with other Go services.

### 4. STUNner (Go/K8s) - Kubernetes Native
- **Strengths**: Specifically designed to act as a gateway for WebRTC traffic entering Kubernetes clusters.
- **Ideal for**: Complex Kubernetes networking setups.
