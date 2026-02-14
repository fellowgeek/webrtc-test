# PeerWire: P2P WebRTC Video Chat

PeerWire is a lightweight, decentralized video chat application that enables direct browser-to-browser communication using **WebRTC**. It leverages **MQTT** as a signaling mechanism, eliminating the need for a dedicated backend server for call orchestration.

---

## 🚀 Architecture Overview

The system operates on a **Pure Client-Side** architecture. There is no custom backend; instead, it uses public infrastructure for the two main requirements of a P2P connection:

1.  **Signaling (MQTT):** Before peers can connect directly, they must exchange information (SDP offers/answers and ICE candidates). PeerWire uses the HiveMQ public MQTT broker over WebSockets (`wss://`) as the "mailbox" for these messages.
2.  **Media Streaming (WebRTC):** Once signaling is complete, the browser establishes a direct UDP-based stream between the participants for video and audio.

### Component Diagram

```text
[ Browser A ] <---- Signaling (MQTT via HiveMQ) ----> [ Browser B ]
      |                                                     ^
      |                                                     |
      +-------------- Direct P2P Media Stream --------------+
                    (WebRTC - Video/Audio)
```

---

## 🛠 How it Works (Step-by-Step)

### 1. Room Initialization
When a user visits the page, the application checks for a `hash` in the URL (e.g., `#my-secret-room`). 
- If no hash exists, it shows a landing page to generate one.
- If a hash exists, it treats it as the **Room ID**.

### 2. Media Acquisition
The browser requests access to the user's camera and microphone using `navigator.mediaDevices.getUserMedia()`. These tracks are stored in a `localStream` and displayed in the small "local" video window.

### 3. The Signaling Phase (MQTT)
Since WebRTC doesn't know "where" the other peer is, we use MQTT topics based on the Room ID:
- **Topic:** `peerwire/rooms/{ROOM_ID}/signals`
- **Presence:** When a user joins, they publish a `presence` message. 
- **Role Arbitration:** To avoid both users trying to start a call at the same time (a race condition called "glare"), the app compares their randomly generated Client IDs. The user with the "alphabetically higher" ID becomes the **Initiator**.

### 4. The WebRTC Handshake
1.  **Offer:** The Initiator creates an **SDP Offer** (a text description of their media capabilities) and sends it to the signaling topic.
2.  **Answer:** The Receiver gets the offer, sets it as their "Remote Description," creates an **SDP Answer**, and sends it back.
3.  **ICE Candidates:** Simultaneously, both browsers talk to a **STUN server** (provided by Google) to find out their public IP addresses and ports. These "ICE Candidates" are exchanged via MQTT and added to the connection.

### 5. P2P Connection
Once the SDPs and ICE candidates are exchanged, the browsers attempt to connect directly. When successful:
- The `ontrack` event fires.
- The remote video/audio tracks are attached to a `remoteStream`.
- The UI status changes to **Connected**.

---

## 🔧 Technology Stack

-   **Frontend:** HTML5, CSS3, Vanilla JavaScript.
-   **WebRTC API:** For P2P media streaming and connectivity.
-   **MQTT.js:** Client library for signaling over WebSockets.
-   **HiveMQ Public Broker:** A free-to-use MQTT broker for message relay.
-   **Google STUN:** For NAT traversal/IP discovery.

---

## 📂 Project Structure

```text
/
├── index.html          # Main UI structure
├── PRD.md              # Project Requirements Document
├── README.md           # This documentation
└── assets/
    ├── css/
    │   └── style.css   # Modern, dark-themed UI styling
    └── js/
        ├── app.js      # Core PeerWire logic (WebRTC + MQTT)
        └── mqtt.min.js # MQTT client library
```

---

## 🛠 Local Development

1.  Clone the repository.
2.  Open `index.html` in a modern web browser (Chrome, Firefox, or Edge).
3.  **Note:** WebRTC requires a secure context. It works on `localhost`, but if you host it elsewhere, you **must** use `https`.

---

## ⚠️ Important Considerations

-   **Public Signaling:** This app uses a public MQTT broker. While the Room ID acts as a "password," anyone who knows the Room ID can technically listen to the signaling traffic. For production, a private/authenticated broker is recommended.
-   **TURN Servers:** This implementation currently only uses **STUN**. In some strict network environments (like corporate firewalls), a **TURN server** would be required to relay media if a direct P2P connection cannot be established.
