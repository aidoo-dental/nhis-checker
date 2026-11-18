let sequence = 0;
const pendingMessages = new Map();
const decodeReply = (encoded) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), character => character.charCodeAt(0))));

window.nzDesktopReply = (id, encoded) => {
  const resolve = pendingMessages.get(id);
  if (!resolve) return;
  pendingMessages.delete(id);
  resolve(encoded);
};

const webview2 = window.chrome?.webview;
webview2?.addEventListener('message', ({data}) => window.nzDesktopReply(data?.id, data?.encoded));

const channel = typeof QWebChannel === 'function' && window.qt?.webChannelTransport
  ? new Promise(resolve => new QWebChannel(window.qt.webChannelTransport, result => resolve(result.objects.desktop)))
  : null;

async function desktop(action, data = {}) {
  const id = ++sequence;
  const message = JSON.stringify({id, action, data});
  let encoded;
  if (window.webkit?.messageHandlers?.nzis) {
    encoded = await new Promise(resolve => {
      pendingMessages.set(id, resolve);
      window.webkit.messageHandlers.nzis.postMessage(message);
    });
  } else if (webview2) {
    encoded = await new Promise((resolve, reject) => {
      pendingMessages.set(id, resolve);
      try {
        webview2.postMessage({id, action, data});
      } catch (error) {
        pendingMessages.delete(id);
        reject(error);
      }
    });
  } else if (channel) {
    const bridge = await channel;
    encoded = await new Promise(resolve => bridge.dispatch(message, resolve));
  } else {
    throw new Error('Отвори справките през настолното приложение.');
  }
  const result = decodeReply(encoded);
  if (result.error) throw new Error(result.error);
  return result;
}
