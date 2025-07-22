import { io } from "socket.io-client";

export const socket = io("https://8b5127919bc7.ngrok-free.app", {
  transports: ["websocket"],
  secure: true,
});
