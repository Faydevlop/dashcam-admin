import { useRef, useEffect, useState } from "react";
import { socket } from "./sockets";

const App = () => {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [callStatus, setCallStatus] = useState("Ready to call");
  const [audioLevel, setAudioLevel] = useState(0);
  const [isCallActive, setIsCallActive] = useState(false);
  const [isVideoCall, setIsVideoCall] = useState(false);
  const [videoStats, setVideoStats] = useState<string>("");

  const startAudioCall = () => {
    setCallStatus("Initiating audio call via socket...");
    socket.emit("start-call", { deviceId: "dashcam-002" });
    setIsCallActive(true);
    setIsVideoCall(false);
  };

  const startVideoCall = () => {
    setCallStatus("Initiating video call via socket...");
    socket.emit("start-video-call", { deviceId: "dashcam-002" });
    setIsCallActive(true);
    setIsVideoCall(true);
  };

  const endCall = () => {
    if (pcRef.current) {
      const remoteSocketId = pcRef.current.remoteDescription?.type
        ? sessionStorage.getItem("dashcam-socket-id") || ""
        : "";
      socket.emit(isVideoCall ? "end-video-call" : "end-call", {
        to: remoteSocketId,
      });
      pcRef.current.close();
      pcRef.current = null;
    }

    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    setCallStatus("Call ended");
    setIsCallActive(false);
    setIsVideoCall(false);
    setAudioLevel(0);
    setVideoStats("");

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
      if (pcRef.current?.connectionState === "connected") {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
        setAudioLevel(Math.round((average / 255) * 100));
        requestAnimationFrame(updateLevel);
      }
    };

    updateLevel();
  };

  const handleTrackReceived = (event: RTCTrackEvent) => {
    console.log("Track kind:", event.track.kind);
    

    if (event.track.kind === "video" && videoRef.current) {
      // Delay setting srcObject to avoid AbortError
      setTimeout(() => {
        if (videoRef.current) {
          const videoStream = new MediaStream([event.track]);
          videoRef.current.srcObject = videoStream;
          videoRef.current.muted = true;

          videoRef.current.onloadedmetadata = () => {
            setVideoStats(`${videoRef.current?.videoWidth}x${videoRef.current?.videoHeight}`);
          };
          videoRef.current.onplaying = () => {
            setCallStatus("Video playing successfully");
          };
          videoRef.current.onerror = (e) => {
            console.error("Video error:", e);
            setCallStatus("Video error - check console");
          };

          videoRef.current.play().then(() => {
            setCallStatus("Video connected and playing");
          }).catch((err) => {
            console.error("Video autoplay failed:", err);
            setCallStatus("Video ready - Click to play");
          });
        }
      }, 100);
    }

    if (event.track.kind === "audio" && audioRef.current) {
      const audioStream = new MediaStream([event.track]);
      audioRef.current.srcObject = audioStream;
      audioRef.current.play().then(() => {
        setupAudioLevelMonitoring(audioStream);
      }).catch((err) => {
        console.error("Audio autoplay failed:", err);
      });
    }
  };

  useEffect(() => {
    socket.on("connect", () => {
      console.log("Socket connected:", socket.id);
    });

    socket.on("connect_error", (err) => {
      console.error("Socket connection error:", err);
      setCallStatus("Socket connection failed");
    });

    socket.on("webrtc-signal", async ({ from, data }: { from: string; data: any }) => {
      if (isVideoCall) return;

      try {
        if (data.type === "ready") {
          console.log("Dashcam ready for audio call");
          setCallStatus("Dashcam ready - Creating audio offer...");

          sessionStorage.setItem("dashcam-socket-id", from);

          const pc = new RTCPeerConnection({
            iceServers: [
              { urls: "stun:stun.l.google.com:19302" },
              { urls: "stun:stun1.l.google.com:19302" },
              { urls: "stun:stun2.l.google.com:19302" },
            ],
          });
          pcRef.current = pc;

          const localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });

          localStreamRef.current = localStream;
          localStream.getTracks().forEach((track) => {
            console.log(`Adding ${track.kind} track to peer connection`);
            pc.addTrack(track, localStream);
          });

          pc.ontrack = handleTrackReceived;

          pc.onicecandidate = (event) => {
            if (event.candidate) {
              console.log("Sending ICE candidate:", event.candidate);
              socket.emit("webrtc-signal", {
                to: from,
                data: {
                  candidate: {
                    candidate: event.candidate.candidate,
                    sdpMid: event.candidate.sdpMid,
                    sdpMLineIndex: event.candidate.sdpMLineIndex,
                    usernameFragment: event.candidate.usernameFragment,
                  },
                },
              });
            }
          };

          pc.onconnectionstatechange = () => {
            console.log("Audio connection state:", pc.connectionState);
            if (pc.connectionState === "connected") {
              setCallStatus("Audio connected");
            } else if (pc.connectionState === "failed") {
              setCallStatus("Audio connection failed");
              setIsCallActive(false);
            } else {
              setCallStatus(`Audio connecting... (${pc.connectionState})`);
            }
          };

          const offer = await pc.createOffer({ offerToReceiveAudio: true });
          await pc.setLocalDescription(offer);
          socket.emit("webrtc-signal", { to: from, data: pc.localDescription });
          setCallStatus("Audio offer sent...");
        } else if (data.type === "answer") {
          console.log("Received audio answer:", data);
          const pc = pcRef.current;
          if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(data));
            setCallStatus("Audio answer received...");
          }
        } else if (data.candidate) {
          console.log("Received ICE candidate:", data.candidate);
          const pc = pcRef.current;
          if (pc && pc.remoteDescription && data.candidate.candidate && data.candidate.sdpMid !== undefined && data.candidate.sdpMLineIndex !== undefined) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } else {
            console.warn("Invalid ICE candidate received:", data.candidate);
          }
        }
      } catch (err) {
        console.error("Audio WebRTC error:", err);
        setCallStatus("Audio connection error");
      }
    });

    socket.on("webrtc-video-signal", async ({ from, data }: { from: string; data: any }) => {
      if (!isVideoCall) return;

      try {
        if (data.type === "ready") {
          console.log("Dashcam ready for video call");
          setCallStatus("Dashcam ready - Creating video offer...");

          sessionStorage.setItem("dashcam-socket-id", from);

          const pc = new RTCPeerConnection({
            iceServers: [
              { urls: "stun:stun.l.google.com:19302" },
              { urls: "stun:stun1.l.google.com:19302" },
              { urls: "stun:stun2.l.google.com:19302" },
            ],
          });
          pcRef.current = pc;

          pc.ontrack = handleTrackReceived;

          pc.onicecandidate = (event) => {
            if (event.candidate) {
              console.log("Sending ICE candidate:", event.candidate);
              socket.emit("webrtc-video-signal", {
                to: from,
                data: {
                  candidate: {
                    candidate: event.candidate.candidate,
                    sdpMid: event.candidate.sdpMid,
                    sdpMLineIndex: event.candidate.sdpMLineIndex,
                    usernameFragment: event.candidate.usernameFragment,
                  },
                },
              });
            }
          };

          pc.onconnectionstatechange = () => {
            console.log("Video connection state:", pc.connectionState);
            if (pc.connectionState === "connected") {
              setCallStatus("Video connected");
            } else if (pc.connectionState === "failed") {
              setCallStatus("Video connection failed");
              setIsCallActive(false);
            } else {
              setCallStatus(`Video connecting... (${pc.connectionState})`);
            }
          };

          const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
          });
          await pc.setLocalDescription(offer);
          socket.emit("webrtc-video-signal", { to: from, data: pc.localDescription });
          setCallStatus("Video offer sent...");
        } else if (data.type === "answer") {
          console.log("Received video answer:", data);
          const pc = pcRef.current;
          if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(data));
            setCallStatus("Video answer received...");
          }
        } else if (data.candidate) {
          console.log("Received ICE candidate:", data.candidate);
          const pc = pcRef.current;
          if (pc && pc.remoteDescription && data.candidate.candidate && data.candidate.sdpMid !== undefined && data.candidate.sdpMLineIndex !== undefined) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } else {
            console.warn("Invalid ICE candidate received:", data.candidate);
          }
        }
      } catch (err) {
        console.error("Video WebRTC error:", err);
        setCallStatus("Video connection error");
      }
    });

    socket.on("call-ended", () => {
      if (isVideoCall) return;
      console.log("Audio call ended by Dashcam");
      endCall();
    });

    socket.on("video-call-ended", () => {
      if (!isVideoCall) return;
      console.log("Video call ended by Dashcam");
      endCall();
    });

    socket.on("error", (message: string) => {
      console.error("Socket error:", message);
      setCallStatus(`Error: ${message}`);
      setIsCallActive(false);
      setIsVideoCall(false);
    });

    return () => {
      socket.off("connect");
      socket.off("connect_error");
      socket.off("webrtc-signal");
      socket.off("webrtc-video-signal");
      socket.off("call-ended");
      socket.off("video-call-ended");
      socket.off("error");
      if (pcRef.current) pcRef.current.close();
    };
  }, [isVideoCall]);

  const handleVideoClick = () => {
    if (videoRef.current) {
      videoRef.current.play().then(() => {
        setCallStatus("Video playing");
      }).catch((err) => {
        console.error("Manual video play error:", err);
        setCallStatus("Video play failed");
      });
    }
  };

  const handleAudioClick = () => {
    if (audioRef.current) {
      audioRef.current.play().catch((err) => console.error("Audio play error:", err));
      setCallStatus("Audio enabled");
    }
  };

  return (
    <div style={{ padding: "20px", fontFamily: "Arial, sans-serif" }}>
      <h1>Admin Panel - Dashcam Monitor</h1>

      <div style={{ marginBottom: "20px" }}>
        <div>
          <strong>Status:</strong> {callStatus}
        </div>

        {videoStats && (
          <div>
            <strong>Video Resolution:</strong> {videoStats}
          </div>
        )}

        {isCallActive && (
          <div style={{ marginTop: "10px" }}>
            <strong>Audio Level:</strong>
            <div
              style={{
                width: "200px",
                height: "10px",
                backgroundColor: "#ddd",
                display: "inline-block",
                position: "relative",
                marginLeft: "10px",
              }}
            >
              <div
                style={{
                  width: `${audioLevel}%`,
                  height: "100%",
                  backgroundColor: audioLevel > 50 ? "#4CAF50" : "#FFC107",
                  transition: "width 0.1s",
                }}
              ></div>
            </div>
            <span style={{ marginLeft: "10px" }}>{audioLevel}%</span>
          </div>
        )}
      </div>

      <div style={{ marginBottom: "20px" }}>
        <button
          onClick={startAudioCall}
          disabled={isCallActive}
          style={{
            padding: "10px 20px",
            marginRight: "10px",
            backgroundColor: isCallActive ? "#ccc" : "#4CAF50",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: isCallActive ? "not-allowed" : "pointer",
          }}
        >
          Start Audio Call
        </button>

        <button
          onClick={startVideoCall}
          disabled={isCallActive}
          style={{
            padding: "10px 20px",
            marginRight: "10px",
            backgroundColor: isCallActive ? "#ccc" : "#2196F3",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: isCallActive ? "not-allowed" : "pointer",
          }}
        >
          Start Video Call
        </button>

        <button
          onClick={endCall}
          disabled={!isCallActive}
          style={{
            padding: "10px 20px",
            backgroundColor: !isCallActive ? "#ccc" : "#f44336",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: !isCallActive ? "not-allowed" : "pointer",
          }}
        >
          End Call
        </button>
      </div>

      {isCallActive && isVideoCall && (
        <div style={{ marginBottom: "20px", padding: "15px", backgroundColor: "#f0f0f0", borderRadius: "8px" }}>
          <h3 style={{ margin: "0 0 10px 0", fontSize: "16px" }}>Dashcam Video Feed</h3>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onClick={handleVideoClick}
            style={{
              width: "100%",
              maxWidth: "640px",
              height: "auto",
              borderRadius: "8px",
              backgroundColor: "#000",
              border: "2px solid #ddd",
              cursor: "pointer",
            }}
          />
          <div style={{ fontSize: "12px", color: "#666", marginTop: "5px" }}>
            Live video from dashcam-002 {videoStats && `(${videoStats})`}
            <br />
            Click video if it doesn't auto-play
          </div>
        </div>
      )}

      <div style={{ marginBottom: "20px", padding: "15px", backgroundColor: "#f9f9f9", borderRadius: "8px" }}>
        <h3 style={{ margin: "0 0 10px 0", fontSize: "16px" }}>Dashcam Audio</h3>
        <audio
          ref={audioRef}
          controls
          onClick={handleAudioClick}
          style={{ width: "100%" }}
          autoPlay
          playsInline
        />
        <div style={{ fontSize: "12px", color: "#666", marginTop: "5px" }}>
          Audio from dashcam-002
        </div>
      </div>

      <div style={{ marginTop: "10px", fontSize: "12px", color: "#666" }}>
        Target Device: dashcam-002
        <br />
        Call Type: {isCallActive ? (isVideoCall ? "Video Call Active" : "Audio Call Active") : "Standby"}
      </div>
    </div>
  );
};

export default App;