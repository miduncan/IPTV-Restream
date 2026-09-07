const fs = require('fs');

const STORAGE_PATH = process.env.STORAGE_PATH;

function createChannelStorage(channelId) {
    fs.mkdirSync(STORAGE_PATH + channelId, { recursive: true });
}

function deleteChannelStorage(channelId) {
    fs.rmSync(STORAGE_PATH + channelId, { recursive: true, force: true  });
}


module.exports = {
    deleteChannelStorage,
    createChannelStorage
};
