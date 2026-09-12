const ChannelService = require("../services/ChannelService");
const authService = require("../services/auth/AuthService");
const broadcastChannelSelection = require("./broadcastChannelSelection");

let latestChannelSwitchRevision = 0;

module.exports = (io, socket) => {
  // Check if admin mode is required for channel modifications
  socket.on("add-channel", ({ name, url, avatar, mode, headersJson }) => {
    try {
      // Check if user is authenticated as admin from the socket middleware
      if (!authService.hasRole(socket.user, "admin")) {
        return socket.emit("app-error", {
          message: "Admin access required to add channels",
        });
      }

      console.log("Adding solo channel:", url);
      const newChannel = ChannelService.addChannel({
        name: name,
        url: url,
        avatar: avatar,
        mode: mode,
        headersJson: headersJson,
      });
      io.emit("channel-added", newChannel); // Broadcast to all clients
    } catch (err) {
      socket.emit("app-error", { message: err.message });
    }
  });

  socket.on("set-current-channel", async (id, acknowledge) => {
    const reply = typeof acknowledge === "function" ? acknowledge : () => {};
    let revision;
    try {
      if (
        authService.channelSelectionRequiresAdmin() &&
        !authService.hasRole(socket.user, "admin")
      ) {
        const message = "Admin access required to switch channel";
        socket.emit("app-error", { message });
        reply({ ok: false, error: message });
        return;
      }

      const requestedChannel = ChannelService.getChannelById(id);
      if (!requestedChannel) {
        throw new Error("Channel does not exist");
      }

      revision = ++latestChannelSwitchRevision;
      // Update every client's selection immediately. Playback remains empty
      // until channel-selected announces that the new stream is ready.
      io.emit("channel-switching", { channel: requestedChannel, revision });

      const nextChannel = await ChannelService.setCurrentChannel(id);
      if (revision === latestChannelSwitchRevision) {
        broadcastChannelSelection(io, nextChannel);
      }
      reply({ ok: true });
    } catch (err) {
      console.error(err);
      if (revision !== undefined && revision === latestChannelSwitchRevision) {
        io.emit("channel-switch-failed", {
          channel: ChannelService.getCurrentChannel() ?? null,
          revision,
        });
      }
      socket.emit("app-error", { message: err.message });
      reply({ ok: false, error: err.message });
    }
  });

  socket.on("delete-channel", async (id) => {
    try {
      // Check if user is authenticated as admin from the socket middleware
      if (!authService.hasRole(socket.user, "admin")) {
        return socket.emit("app-error", {
          message: "Admin access required to delete channels",
        });
      }

      const lastChannel = ChannelService.getCurrentChannel();
      const current = await ChannelService.deleteChannel(id);
      io.emit("channel-deleted", id); // Broadcast to all clients
      if (lastChannel?.id != current?.id) broadcastChannelSelection(io, current ?? null);
    } catch (err) {
      console.error(err);
      socket.emit("app-error", { message: err.message });
    }
  });

  socket.on("update-channel", async ({ id, updatedAttributes }) => {
    try {
      // Check if user is authenticated as admin from the socket middleware
      if (!authService.hasRole(socket.user, "admin")) {
        return socket.emit("app-error", {
          message: "Admin access required to update channels",
        });
      }

      const updatedChannel = await ChannelService.updateChannel(
        id,
        updatedAttributes
      );
      io.emit("channel-updated", updatedChannel); // Broadcast to all clients
    } catch (err) {
      console.error(err);
      socket.emit("app-error", { message: err.message });
    }
  });
};
