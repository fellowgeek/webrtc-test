# **PRD: Project "PeerWire" (Pure Frontend P2P)**

## **1\. Executive Summary**

PeerWire is a client-side only, two-party video conferencing tool. It uses WebRTC for media and MQTT.js (via HiveMQ's public broker) for signaling. No backend server is required. Users join a room by adding a hash to the URL, and the browser handles all connectivity logic.

## **2\. Technical Stack**

* Frontend: HTML5, CSS3, Vanilla JavaScript (ES6+).  
* Signaling: MQTT over WSS (Websocket Secure).  
* Broker: broker.hivemq.com (Port 8884).  
* Library: mqtt.min.js (User-provided local file).  
* Media: Browser WebRTC API (RTCPeerConnection, getUserMedia).

## **3\. Functional Requirements**

### **3.1 Room & Identity Management**

* URL-Based Rooms: The app reads the room ID from the URL hash (e.g., index.html\#my-secret-room).  
* Automatic Role Assignment: \* Since there is no server to say "you are the caller," both clients generate a random clientID.  
  1. The client with the lexicographically higher string ID becomes the Initiator (Caller).  
* Topic Structure: All signaling occurs under: peerwire/rooms/\[ROOM\_ID\]/\#

### **3.2 Signaling Flow (The Handshake)**

* Subscription: Both clients subscribe to peerwire/rooms/\[ROOMID\]/signals.  
* Offer/Answer:  
  1. Initiator: Generates an SDP Offer and publishes it to the topic.  
  2. Receiver: Receives the Offer, sets it as the Remote Description, generates an SDP Answer, and publishes it back.  
* ICE Candidate Exchange: As the browser finds network paths (ICE Candidates), they are published to the same topic. The other peer adds them immediately.

### **3.3 Audio/Video Features**

* Local Stream: Capture camera/mic and display in a video element with muted attribute (to prevent feedback).  
* Remote Stream: Once the P2P connection is successful, the remote video stream is attached to the main video element.  
* UI Controls: \* Toggle Audio/Video.  
  * Copy Link to Clipboard (to share the room URL).  
  * Connection status indicator (Connecting, Online, Disconnected).

## **4\. Detailed Implementation Requirements**

### **4.1 MQTT Connection Configuration**

* URL: wss://broker.hivemq.com:8884/mqtt  
* Client ID: A random string (e.g., user\_ \+ Math.random()).  
* Clean Session: true (to ensure old signals don't interfere with new calls).

### **4.2 WebRTC Configuration**

* ICE Servers: Use Google's public STUN servers.  
  JavaScript  
  const iceConfig \= {  
    iceServers: \[{ urls: "stun:stun.l.google.com:19302" }\]  
  };

### **4.3 Signaling Message Schema**

Messages sent over MQTT should be JSON strings:

JSON

{  
  "sender": "clientId\_123",  
  "type": "offer | answer | candidate",  
  "data": { ...SDP or ICE Object... }  
}

## **5\. UI/UX Specification (HTML/CSS)**

* Fullscreen Layout: The remote video should fill the browser window.  
* PIP (Picture-in-Picture): The local camera view should be a small, rounded-corner window in the bottom-right.  
* Control Overlay: A floating bar at the bottom with icons (SVG preferred) for:  
  * Mic: Green if on, Red if muted.  
  * Camera: Green if on, Red if off.  
  * Hangup: Red button to close the connection and redirect to the home screen.

## **6\. Security & Constraints**

* No Privacy on Public Broker: Because HiveMQ is public, anyone can subscribe to peerwire/rooms/\#.  
  * Mitigation: Use long, complex room names (UUIDs).  
* HTTPS Requirement: The browser will not grant camera access unless the page is loaded via https:// or localhost.

## **7\. Next Steps for gemini-cli**

1. Draft HTML/CSS: "Generate a single-file HTML/CSS layout for PeerWire with a fullscreen remote video and a small floating local video preview."  
2. Logic Generation: "Write the JavaScript for PeerWire using the provided mqtt.min.js. It should connect to HiveMQ WSS, handle the 'higher-ID-is-caller' logic, and manage the WebRTC RTCPeerConnection handshake."

