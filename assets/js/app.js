/**
 * PeerWire - P2P Video Chat Logic
 */

const CONFIG = {
    mqtt: {
        url: 'wss://broker.hivemq.com:8884/mqtt',
        topicPrefix: 'peerwire/rooms'
    },
    rtc: {
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    }
};

class PeerWire {
    constructor() {
        this.clientId = 'user_' + Math.random().toString(36).substr(2, 9);
        this.roomId = window.location.hash.substring(1);
        this.mqttClient = null;
        this.pc = null;
        this.localStream = null;
        this.remoteStream = new MediaStream();
        this.isInitiator = false;
        this.peers = new Set(); // To track other client IDs in the room

        // UI Elements
        this.localVideo = document.getElementById('local-video');
        this.remoteVideo = document.getElementById('remote-video');
        this.statusText = document.getElementById('status-text');
        this.statusIndicator = document.getElementById('status-indicator');
        this.roomDisplay = document.getElementById('room-id');
        this.landingOverlay = document.getElementById('landing-overlay');

        this.init();
    }

    async init() {
        if (!this.roomId) {
            this.showLanding();
            return;
        }

        this.roomDisplay.innerText = `#${this.roomId}`;
        this.updateStatus('connecting', 'Joining room...');

        try {
            await this.setupMedia();
            this.setupMQTT();
        } catch (err) {
            console.error("Initialization error:", err);
            this.updateStatus('disconnected', 'Camera/Mic access denied');
        }

        this.bindEvents();
    }

    showLanding() {
        this.landingOverlay.classList.remove('hidden');
        document.getElementById('create-room').onclick = () => {
            const randomRoom = Math.random().toString(36).substr(2, 8);
            window.location.hash = randomRoom;
            window.location.reload();
        };
    }

    async setupMedia() {
        this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        this.localVideo.srcObject = this.localStream;
        this.remoteVideo.srcObject = this.remoteStream;
    }

    setupMQTT() {
        // mqtt is globally available from mqtt.min.js
        this.mqttClient = mqtt.connect(CONFIG.mqtt.url, {
            clientId: this.clientId,
            clean: true
        });

        const signalTopic = `${CONFIG.mqtt.topicPrefix}/${this.roomId}/signals`;

        this.mqttClient.on('connect', () => {
            console.log("Connected to MQTT", this.clientId);
            this.mqttClient.subscribe(signalTopic);
            this.updateStatus('connecting', 'Waiting for peer...');
            
            // Broadcast presence to announce ourselves
            this.sendSignal('presence', {});
        });

        this.mqttClient.on('message', (topic, message) => {
            const payload = JSON.parse(message.toString());
            if (payload.sender === this.clientId) return;

            this.handleSignal(payload);
        });
    }

    updateStatus(type, text) {
        this.statusIndicator.className = type;
        this.statusText.innerText = text;
    }

    sendSignal(type, data) {
        const signalTopic = `${CONFIG.mqtt.topicPrefix}/${this.roomId}/signals`;
        const payload = JSON.stringify({
            sender: this.clientId,
            type: type,
            data: data
        });
        this.mqttClient.publish(signalTopic, payload);
    }

    async handleSignal(signal) {
        const { sender, type, data } = signal;

        switch (type) {
            case 'presence':
                // Someone joined. Determine if we are initiator.
                // Higher ID is initiator.
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
                await this.handleOffer(data);
                break;

            case 'answer':
                await this.handleAnswer(data);
                break;

            case 'candidate':
                if (this.pc) {
                    await this.pc.addIceCandidate(new RTCIceCandidate(data));
                }
                break;
        }
    }

    createPeerConnection() {
        if (this.pc) return;

        this.pc = new RTCPeerConnection(CONFIG.rtc);

        // Add local tracks
        this.localStream.getTracks().forEach(track => {
            this.pc.addTrack(track, this.localStream);
        });

        // Handle remote tracks
        this.pc.ontrack = (event) => {
            event.streams[0].getTracks().forEach(track => {
                this.remoteStream.addTrack(track);
            });
            this.updateStatus('online', 'Connected');
        };

        // Handle ICE candidates
        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignal('candidate', event.candidate);
            }
        };

        this.pc.onconnectionstatechange = () => {
            console.log("Connection state:", this.pc.connectionState);
            if (this.pc.connectionState === 'connected') {
                this.updateStatus('online', 'Connected');
            } else if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed') {
                this.updateStatus('disconnected', 'Peer disconnected');
            }
        };
    }

    async startCall() {
        this.createPeerConnection();
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        this.sendSignal('offer', offer);
        this.updateStatus('connecting', 'Calling...');
    }

    async handleOffer(offer) {
        this.createPeerConnection();
        await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.sendSignal('answer', answer);
    }

    async handleAnswer(answer) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    }

    bindEvents() {
        document.getElementById('toggle-mic').onclick = (e) => {
            const audioTrack = this.localStream.getAudioTracks()[0];
            audioTrack.enabled = !audioTrack.enabled;
            e.currentTarget.classList.toggle('active', audioTrack.enabled);
            e.currentTarget.classList.toggle('inactive', !audioTrack.enabled);
        };

        document.getElementById('toggle-cam').onclick = (e) => {
            const videoTrack = this.localStream.getVideoTracks()[0];
            videoTrack.enabled = !videoTrack.enabled;
            e.currentTarget.classList.toggle('active', videoTrack.enabled);
            e.currentTarget.classList.toggle('inactive', !videoTrack.enabled);
        };

        document.getElementById('copy-link').onclick = () => {
            navigator.clipboard.writeText(window.location.href);
            alert("Room link copied!");
        };

        document.getElementById('hangup').onclick = () => {
            window.location.hash = '';
            window.location.reload();
        };
    }
}

// Initialize on load
window.onload = () => {
    window.app = new PeerWire();
};
