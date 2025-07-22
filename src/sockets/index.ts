import { io } from "socket.io-client";

export const socket = io("https://3d6a27b987fb.ngrok-free.app", {
  transports: ["websocket"],
  secure: true,
});
