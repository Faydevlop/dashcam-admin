import { io } from "socket.io-client";

export const socket = io("https://8b5127919bc7.ngrok-free.app", {
  path: "/socket.io",
  transports: ["websocket", "polling"],
  secure: true,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  extraHeaders: {
    "ngrok-skip-browser-warning": "true",
  },
});