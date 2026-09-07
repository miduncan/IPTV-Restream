const crypto = require('node:crypto');

class User {
    constructor(name) {
        this.name = name;
    }
}


class ChatMessage {
    constructor(user, message, timestamp) {
        this.id = crypto.randomUUID();
        this.kind = 'chat';
        this.user = user;
        this.message = message;
        this.timestamp = timestamp;
    }
}

module.exports = { ChatMessage, User };
