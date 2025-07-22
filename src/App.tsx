import { useRef, useEffect, useState } from "react";
import { socket } from "./sockets";


const App = () => {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null); // NEW
  const [callStatus, setCallStatus] = useState("Ready to call");
  const [audioLevel, setAudioLevel] = useState(0);
  const [isCallActive, setIsCallActive] = useState(false);

  const startCall = () => {
    setCallStatus("Initiating call via socket...");
    socket.emit("start-call", { deviceId: "dashcam-001" });
    setIsCallActive(true);
  };

  const endCall = () => {
    if (pcRef.current) {
      socket.emit("end-call", {});
      pcRef.current.close();
      pcRef.current = null;
    }

    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    setCallStatus("Call ended");
    setIsCallActive(false);
    setAudioLevel(0);

    setTimeout(() => setCallStatus("Ready to call"), 2000);
  };

  const setupAudioLevelMonitoring = (stream: MediaStream) => {
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const updateLevel = () => {
      if (pcRef.current?.connectionState === 'connected') {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
        setAudioLevel(Math.round((average / 255) * 100));
        requestAnimationFrame(updateLevel);
      }
    };

    updateLevel();
  };

  useEffect(() => {
  

    socket.on("webrtc-signal", async ({ from, data }: { from: string; data: any }) => {
      try {
        if (data.type === "ready") {
          console.log("Dashcam is ready, creating offer...");
          setCallStatus("Dashcam ready - Creating offer...");
         

          const pc = new RTCPeerConnection({
            iceServers: [
              { urls: "stun:stun.l.google.com:19302" },
              { urls: "stun:stun1.l.google.com:19302" }
            ]
          });
          pcRef.current = pc;

          // 🎤 Get admin mic and add to connection
          const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          localStreamRef.current = localStream;
          localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

          pc.ontrack = (event) => {
            console.log("Track received from Dashcam:", event.streams[0]);
            setCallStatus("Audio stream received");

            if (audioRef.current && event.streams[0]) {
              audioRef.current.srcObject = event.streams[0];
              audioRef.current.play().catch(err => {
                console.log("Autoplay issue:", err);
                setCallStatus("Click to enable audio");
              });

              setupAudioLevelMonitoring(event.streams[0]);
            }
          };

          pc.onicecandidate = (event) => {
            if (event.candidate) {
              socket.emit("webrtc-signal", { to: from, data: event.candidate });
            }
          };

          pc.onconnectionstatechange = () => {
            console.log("Connection state:", pc.connectionState);
            if (pc.connectionState === 'connected') {
              setCallStatus("Connected - Two-way audio active");
            } else if (pc.connectionState === 'failed') {
              setCallStatus("Connection failed");
              setIsCallActive(false);
            } else if (pc.connectionState === 'disconnected') {
              setCallStatus("Disconnected");
              setIsCallActive(false);
            } else {
              setCallStatus(`Connecting... (${pc.connectionState})`);
            }
          };

          // 🎯 Create offer
          const offer = await pc.createOffer({ offerToReceiveAudio: true });
          await pc.setLocalDescription(offer);
          socket.emit("webrtc-signal", { to: from, data: pc.localDescription });
          setCallStatus("Offer sent - Waiting for answer...");
        }

        else if (data.type === "answer") {
          console.log("Received answer from Dashcam");
          const pc = pcRef.current;
          if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(data));
            setCallStatus("Answer received - Connection establishing...");
          }
        }

        else if (data.candidate) {
          const pc = pcRef.current;
          if (pc && pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(data));
          }
        }
      } catch (err) {
        console.error("WebRTC signal error:", err);
        setCallStatus("Connection error");
      }
    });

    socket.on("call-ended", () => {
      console.log("Call ended by Dashcam");
      endCall();
    });

    socket.on("error", (message: string) => {
      console.error("Socket error:", message);
      setCallStatus(`Error: ${message}`);
      setIsCallActive(false);
    });

    return () => {
      socket.off("webrtc-signal");
      socket.off("call-ended");
      socket.off("error");
      if (pcRef.current) pcRef.current.close();
    };
  }, []);

  const handleAudioClick = () => {
    if (audioRef.current) {
      audioRef.current.play().catch(console.error);
      setCallStatus("Audio enabled - Receiving audio");
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Admin Panel - Dashcam Audio Monitor</h1>

      <div style={{ marginBottom: '20px' }}>
        <div><strong>Status:</strong> {callStatus}</div>

        {isCallActive && (
          <div style={{ marginTop: '10px' }}>
            <strong>Audio Level:</strong>
            <div style={{
              width: '200px', height: '10px', backgroundColor: '#ddd',
              display: 'inline-block', position: 'relative', marginLeft: '10px'
            }}>
              <div style={{
                width: `${audioLevel}%`, height: '100%',
                backgroundColor: audioLevel > 50 ? '#4CAF50' : '#FFC107',
                transition: 'width 0.1s'
              }}></div>
            </div>
            <span style={{ marginLeft: '10px' }}>{audioLevel}%</span>
          </div>
        )}
      </div>

      <div style={{ marginBottom: '20px' }}>
        <button onClick={startCall} disabled={isCallActive} style={{
          padding: '10px 20px', marginRight: '10px',
          backgroundColor: isCallActive ? '#ccc' : '#4CAF50',
          color: 'white', border: 'none', borderRadius: '4px',
          cursor: isCallActive ? 'not-allowed' : 'pointer'
        }}>
          Start Call
        </button>

        <button onClick={endCall} disabled={!isCallActive} style={{
          padding: '10px 20px',
          backgroundColor: !isCallActive ? '#ccc' : '#f44336',
          color: 'white', border: 'none', borderRadius: '4px',
          cursor: !isCallActive ? 'not-allowed' : 'pointer'
        }}>
          End Call
        </button>
      </div>

      <audio
        ref={audioRef}
        controls
        onClick={handleAudioClick}
        style={{ width: '100%', marginTop: '10px' }}
        autoPlay
        playsInline
      />

      <div style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
        Target Device: dashcam-001
      </div>

      {callStatus.includes("Click to enable") && (
        <div style={{
          marginTop: '10px',
          padding: '10px',
          backgroundColor: '#fff3cd',
          border: '1px solid #ffeaa7',
          borderRadius: '4px'
        }}>
          Click the audio controls above to enable audio playback
        </div>
      )}
    </div>
  );
};

export default App;
