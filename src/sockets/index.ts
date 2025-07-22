import { io } from "socket.io-client";

export const socket = io("https://8b5127919bc7.ngrok-free.app", {
  path: "/socket.io",
  transports: ["websocket", "polling"], // Fallback to polling if WebSocket fails
  secure: true,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  extraHeaders: {
    "ngrok-skip-browser-warning": "true", // Bypass ngrok's browser warning
  },
});