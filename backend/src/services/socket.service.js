let _io = null;

function setIo(io) {
  _io = io;
}

function getIo() {
  return _io;
}

function emitToConversation(conversationId, event, data) {
  if (_io) _io.to(conversationId).emit(event, data);
}

function emitToAll(event, data) {
  if (_io) _io.emit(event, data);
}

module.exports = { setIo, getIo, emitToConversation, emitToAll };
