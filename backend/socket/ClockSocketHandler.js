module.exports = (socket, now = () => Date.now()) => {
  socket.on("sync-clock", (acknowledge) => {
    if (typeof acknowledge !== "function") return;
    acknowledge({ serverTimeMs: now() });
  });
};
