console.log('Gmail Notifier: Background page loaded');

// This keeps our service worker alive
function keepAlive() {
  // Check if service worker is active before attempting to communicate
  if (navigator.serviceWorker.controller) {
    const channel = new MessageChannel();

    // Setup message handler
    channel.port1.onmessage = function(event) {
      if (event.data === 'pong') {
        console.log('Gmail Notifier: Service worker is alive');
      }
    };

    // Send message to service worker
    navigator.serviceWorker.controller.postMessage('ping', [channel.port2]);
  }

  // Call every 25 seconds to keep service worker from going idle
  setTimeout(keepAlive, 25000);
}

// Wait for service worker to be installed
navigator.serviceWorker.register('index.js')
  .then(function(registration) {
    console.log('Gmail Notifier: Service worker registered');

    // Only start keepAlive if service worker is active
    if (registration.active) {
      keepAlive();
    } else {
      // Wait for service worker to become active
      registration.addEventListener('updatefound', function() {
        const newWorker = registration.installing;
        newWorker.addEventListener('statechange', function() {
          if (newWorker.state === 'activated') {
            keepAlive();
          }
        });
      });
    }
  })
  .catch(function(error) {
    console.error('Gmail Notifier: Service worker registration failed:', error);
  });
