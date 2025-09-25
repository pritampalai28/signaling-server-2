import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices
} from 'react-native-webrtc';
import io from 'socket.io-client';

class WebRTCService {
  constructor() {
    this.socket = null;
    this.peerConnection = null;
    this.localStream = null;
  }

  async initialize(serverUrl, roomId, userId) {
    // Connect to signaling server
    this.socket = io(serverUrl);
    
    // Get ICE servers configuration
    const response = await fetch(`${serverUrl}/api/ice-servers`);
    const { iceServers } = await response.json();
    
    // Create peer connection
    this.peerConnection = new RTCPeerConnection({
      iceServers
    });
    
    this.setupSocketListeners();
    this.setupPeerConnectionListeners();
    
    // Join room
    this.socket.emit('join-room', roomId, userId);
    
    return this;
  }

  setupSocketListeners() {
    this.socket.on('user-joined', (userId) => {
      console.log('User joined:', userId);
      this.createOffer(userId);
    });
    
    this.socket.on('offer', async ({ offer, callerUserId }) => {
      await this.handleOffer(offer, callerUserId);
    });
    
    this.socket.on('answer', async ({ answer }) => {
      await this.handleAnswer(answer);
    });
    
    this.socket.on('ice-candidate', async ({ candidate }) => {
      await this.handleIceCandidate(candidate);
    });
  }

  setupPeerConnectionListeners() {
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('ice-candidate', {
          targetUserId: this.currentTargetUser,
          candidate: event.candidate
        });
      }
    };
    
    this.peerConnection.onaddstream = (event) => {
      // Handle remote stream
      console.log('Remote stream added');
    };
  }

  async createOffer(targetUserId) {
    this.currentTargetUser = targetUserId;
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    
    this.socket.emit('offer', {
      targetUserId,
      offer
    });
  }

  async handleOffer(offer, callerUserId) {
    this.currentTargetUser = callerUserId;
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    
    this.socket.emit('answer', {
      targetUserId: callerUserId,
      answer
    });
  }

  async handleAnswer(answer) {
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  }

  async handleIceCandidate(candidate) {
    await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  }

  async startLocalVideo() {
    this.localStream = await mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    
    this.peerConnection.addStream(this.localStream);
    return this.localStream;
  }
}

export default WebRTCService;