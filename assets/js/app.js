/**
 * PeerWire - P2P Video Chat Logic
 * 
 * This module implements a Peer-to-Peer (P2P) video chat system using WebRTC
 * for media streaming and MQTT as a signaling channel. It handles media
 * acquisition, signaling (offer/answer/ICE candidates), and peer connection
 * management.
 */

/**
 * Global Configuration for MQTT broker and WebRTC ICE servers.
 */
const CONFIG = {
    mqtt: {
        // Public HiveMQ broker using WebSockets with TLS
        url: 'wss://broker.hivemq.com:8884/mqtt',
        // Base topic prefix to avoid collisions on the public broker
        topicPrefix: 'peerwire/rooms'
    },
    rtc: {
        // Standard Google STUN server to help discover public IP addresses
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    }
};

/**
 * PeerWire class manages the lifecycle of a P2P call.
 */
class PeerWire {
    constructor() {
        // Generate a random client ID to identify this peer
        this.clientId = 'user_' + Math.random().toString(36).substr(2, 9);
        // Room ID is extracted from the URL hash (e.g., index.html#myroom)
        this.roomId = window.location.hash.substring(1);
        
        this.mqttClient = null;   // MQTT client instance for signaling
        this.pc = null;           // RTCPeerConnection instance
        this.dataChannel = null;  // RTCDataChannel for text chat
        this.localStream = null;  // MediaStream from user's camera/mic
        this.remoteStream = new MediaStream(); // Stream container for the peer's video
        this.isInitiator = false; // Flag to determine who starts the WebRTC offer
        this.peers = new Set();   // Tracks other client IDs in the room

        // UI element references
        this.localVideo = document.getElementById('local-video');
        this.remoteVideo = document.getElementById('remote-video');
        this.statusText = document.getElementById('status-text');
        this.statusIndicator = document.getElementById('status-indicator');
        this.roomDisplay = document.getElementById('room-id');
        this.landingOverlay = document.getElementById('landing-overlay');
        this.chatMessages = document.getElementById('chat-messages');
        this.chatInput = document.getElementById('chat-input');
        this.sendBtn = document.getElementById('send-btn');

        // Start the application
        this.init();
    }

    /**
     * Initializes the application. Checks for a room ID, sets up media,
     * and connects to the signaling server.
     */
    async init() {
        if (!this.roomId) {
            // No room specified, show the landing page to create/join one
            this.showLanding();
            return;
        }

        this.roomDisplay.innerText = `#${this.roomId}`;
        this.updateStatus('connecting', 'Joining room...');

        try {
            // 1. Get user media (camera/mic)
            await this.setupMedia();
            // 2. Connect to MQTT for signaling
            this.setupMQTT();
        } catch (err) {
            console.error("Initialization error:", err);
            this.updateStatus('disconnected', 'Camera/Mic access denied');
        }

        // 3. Attach UI event listeners
        this.bindEvents();
    }

    /**
     * Displays the landing overlay if the user isn't in a room.
     */
    showLanding() {
        this.landingOverlay.classList.remove('hidden');
        document.getElementById('create-room').onclick = () => {
            // Generate a random 8-character room ID
            const randomRoom = Math.random().toString(36).substr(2, 8);
            window.location.hash = randomRoom;
            window.location.reload(); // Refresh to trigger init() with the new hash
        };
    }

    /**
     * Requests access to the user's camera and microphone.
     * Sets the local video stream to the video element.
     */
    async setupMedia() {
        this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        this.localVideo.srcObject = this.localStream;
        // Assign the remote stream container to the remote video element early
        this.remoteVideo.srcObject = this.remoteStream;
    }

    /**
     * Connects to the MQTT broker and subscribes to the room's signaling topic.
     */
    setupMQTT() {
        // 'mqtt' is provided by the external script assets/js/mqtt.min.js
        this.mqttClient = mqtt.connect(CONFIG.mqtt.url, {
            clientId: this.clientId,
            clean: true
        });

        // Topic where all signaling messages for this specific room are exchanged
        const signalTopic = `${CONFIG.mqtt.topicPrefix}/${this.roomId}/signals`;

        this.mqttClient.on('connect', () => {
            console.log("Connected to MQTT", this.clientId);
            this.mqttClient.subscribe(signalTopic);
            this.updateStatus('connecting', 'Waiting for peer...');
            
            // Broadcast 'presence' to notify others that we've joined
            this.sendSignal('presence', {});
        });

        this.mqttClient.on('message', (topic, message) => {
            const payload = JSON.parse(message.toString());
            // Ignore messages sent by ourselves
            if (payload.sender === this.clientId) return;

            // Process incoming signaling data
            this.handleSignal(payload);
        });
    }

    /**
     * Updates the UI status indicator and text.
     * @param {string} type - 'connecting', 'online', or 'disconnected'
     * @param {string} text - Message to display
     */
    updateStatus(type, text) {
        this.statusIndicator.className = type;
        this.statusText.innerText = text;
    }

    /**
     * Publishes a signaling message to the MQTT topic.
     * @param {string} type - Message type ('presence', 'offer', 'answer', 'candidate')
     * @param {object} data - The payload (SDP or ICE candidate)
     */
    sendSignal(type, data) {
        const signalTopic = `${CONFIG.mqtt.topicPrefix}/${this.roomId}/signals`;
        const payload = JSON.stringify({
            sender: this.clientId,
            type: type,
            data: data
        });
        this.mqttClient.publish(signalTopic, payload);
    }

    /**
     * Routes incoming signaling messages to their respective handlers.
     * @param {object} signal - The signaling message payload
     */
    async handleSignal(signal) {
        const { sender, type, data } = signal;

        switch (type) {
            case 'presence':
                // A new peer has announced themselves.
                // We use a simple alphabetical comparison of IDs to decide who initiates.
                // This prevents 'glare' (both sides trying to offer at the same time).
                console.log(`Presence from ${sender}. Ours: ${this.clientId}`);
                if (this.clientId > sender) {
                    console.log("We are the initiator");
                    this.isInitiator = true;
                    this.startCall();
                } else {
                    console.log("We are the receiver");
                    this.isInitiator = false;
                }
                break;

            case 'offer':
                // Received a WebRTC offer from the peer
                await this.handleOffer(data);
                break;

            case 'answer':
                // Received a WebRTC answer to our offer
                await this.handleAnswer(data);
                break;

            case 'candidate':
                // Received an ICE candidate from the peer
                if (this.pc) {
                    await this.pc.addIceCandidate(new RTCIceCandidate(data));
                }
                break;
        }
    }

    /**
     * Initializes the RTCPeerConnection and sets up track/ICE handlers.
     */
    createPeerConnection() {
        if (this.pc) return; // Connection already exists

        this.pc = new RTCPeerConnection(CONFIG.rtc);

        // Initiator creates the data channel
        if (this.isInitiator) {
            this.dataChannel = this.pc.createDataChannel('chat');
            this.setupDataChannel(this.dataChannel);
        } else {
            // Receiver listens for the data channel
            this.pc.ondatachannel = (event) => {
                this.dataChannel = event.channel;
                this.setupDataChannel(this.dataChannel);
            };
        }

        // Add our local tracks (video/audio) to the connection
        this.localStream.getTracks().forEach(track => {
            this.pc.addTrack(track, this.localStream);
        });

        // Event triggered when the peer's tracks arrive
        this.pc.ontrack = (event) => {
            event.streams[0].getTracks().forEach(track => {
                // Add incoming tracks to our remoteStream container
                this.remoteStream.addTrack(track);
            });
            this.updateStatus('online', 'Connected');
        };

        // Event triggered when a new local ICE candidate is found
        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                // Send the candidate to the peer via MQTT
                this.sendSignal('candidate', event.candidate);
            }
        };

        // Monitor the state of the connection
        this.pc.onconnectionstatechange = () => {
            console.log("Connection state:", this.pc.connectionState);
            if (this.pc.connectionState === 'connected') {
                this.updateStatus('online', 'Connected');
            } else if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed') {
                this.updateStatus('disconnected', 'Peer disconnected');
            }
        };
    }

    /**
     * Binds events to the RTCDataChannel.
     * @param {RTCDataChannel} channel 
     */
    setupDataChannel(channel) {
        channel.onopen = () => {
            console.log("Data channel opened");
            this.appendMessage('System', 'Chat connected', false, true);
        };
        channel.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.appendMessage('Peer', data.text, false);
        };
        channel.onclose = () => {
            console.log("Data channel closed");
            this.appendMessage('System', 'Chat disconnected', false, true);
        };
    }

    /**
     * Sends a text message through the data channel.
     */
    sendMessage() {
        const text = this.chatInput.value.trim();
        if (text && this.dataChannel && this.dataChannel.readyState === 'open') {
            const message = { text, timestamp: Date.now() };
            this.dataChannel.send(JSON.stringify(message));
            this.appendMessage('Me', text, true);
            this.chatInput.value = '';
        }
    }

    /**
     * Displays a message in the chat UI.
     * @param {string} sender - Who sent the message
     * @param {string} text - Message content
     * @param {boolean} isLocal - Whether we sent it
     * @param {boolean} isSystem - Whether it's a system message
     */
    appendMessage(sender, text, isLocal, isSystem = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isLocal ? 'local' : 'remote'} ${isSystem ? 'system' : ''}`;
        
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        messageDiv.innerHTML = `
            ${text}
            <span class="meta">${sender} • ${timestamp}</span>
        `;
        
        this.chatMessages.appendChild(messageDiv);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    /**
     * Initiates a call by creating an SDP offer.
     */
    async startCall() {
        this.createPeerConnection();
        const offer = await this.pc.createOffer();
        // Set local description and send it to the peer
        await this.pc.setLocalDescription(offer);
        this.sendSignal('offer', offer);
        this.updateStatus('connecting', 'Calling...');
    }

    /**
     * Handles an incoming offer: sets remote description and creates an answer.
     * @param {object} offer - The peer's SDP offer
     */
    async handleOffer(offer) {
        this.createPeerConnection();
        // Set the peer's offer as the remote description
        await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
        // Create an answer to the offer
        const answer = await this.pc.createAnswer();
        // Set our answer as the local description and send it back
        await this.pc.setLocalDescription(answer);
        this.sendSignal('answer', answer);
    }

    /**
     * Handles an incoming answer: sets the remote description to finalize the handshake.
     * @param {object} answer - The peer's SDP answer
     */
    async handleAnswer(answer) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    }

    /**
     * Binds UI interactions (buttons) to functional logic.
     */
    bindEvents() {
        // Toggle Microphone
        document.getElementById('toggle-mic').onclick = (e) => {
            const audioTrack = this.localStream.getAudioTracks()[0];
            audioTrack.enabled = !audioTrack.enabled;
            e.currentTarget.classList.toggle('active', audioTrack.enabled);
            e.currentTarget.classList.toggle('inactive', !audioTrack.enabled);
        };

        // Toggle Camera
        document.getElementById('toggle-cam').onclick = (e) => {
            const videoTrack = this.localStream.getVideoTracks()[0];
            videoTrack.enabled = !videoTrack.enabled;
            e.currentTarget.classList.toggle('active', videoTrack.enabled);
            e.currentTarget.classList.toggle('inactive', !videoTrack.enabled);
        };

        // Copy Room Link to Clipboard
        document.getElementById('copy-link').onclick = () => {
            navigator.clipboard.writeText(window.location.href);
            alert("Room link copied!");
        };

        // Hang up / Leave Room
        document.getElementById('hangup').onclick = () => {
            window.location.hash = ''; // Clear room from URL
            window.location.reload(); // Refresh to go back to landing
        };

        // Chat UI bindings
        this.sendBtn.onclick = () => this.sendMessage();
        this.chatInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        };
    }
}

// Initialize the application when the window finishes loading
window.onload = () => {
    window.app = new PeerWire();
};
