import { awsConfig } from '../config/awsConfig';

export function createLiveSocket({ onMessage, onOpen, onClose, onError }) {
  if (!awsConfig.wsUrl) {
    throw new Error('WebSocket URL is missing. Set EXPO_PUBLIC_WS_URL.');
  }

  const socket = new WebSocket(awsConfig.wsUrl);

  socket.onopen = () => onOpen?.();
  socket.onclose = () => onClose?.();
  socket.onerror = (event) => onError?.(event);
  socket.onmessage = (event) => {
    try {
      onMessage?.(JSON.parse(event.data));
    } catch (error) {
      onError?.(error);
    }
  };

  return socket;
}
