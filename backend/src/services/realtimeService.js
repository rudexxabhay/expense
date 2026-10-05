const clientsByUser = new Map();

export function subscribeToRealtime(userId, res) {
  const key = String(userId);
  const clients = clientsByUser.get(key) || new Set();
  clients.add(res);
  clientsByUser.set(key, clients);
  res.on("close", () => {
    clients.delete(res);
    if (!clients.size) clientsByUser.delete(key);
  });
}

export function publishRealtimeEvent(userId, event) {
  const clients = clientsByUser.get(String(userId));
  if (!clients?.size) return;
  const payload = `event: financial-event\ndata: ${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n\n`;
  for (const res of clients) res.write(payload);
}
