// Gmail Notifier Service Worker for Manifest V3
// This version addresses the XMLHttpRequest issue in Service Workers

import { XMLParser } from 'fast-xml-parser';

let timeout = null;
let checkInterval = 30000; // 30 seconds between checks

// Handle service worker lifecycle
self.addEventListener('install', (event) => {
  console.log('Gmail Notifier: Service worker installed');
  self.skipWaiting(); // Activate worker immediately
});

self.addEventListener('activate', (event) => {
  console.log('Gmail Notifier: Service worker activated');
  event.waitUntil(clients.claim()); // Claim clients immediately
  // Start the update cycle
  setTimeout(() => Update(), 1000); // Slight delay to ensure everything is initialized
});

// Listen for clicks on the extension icon
chrome.action.onClicked.addListener(() => {
  console.log("Extension icon clicked");

  // Simplified approach: Only focus on the current window (workspace)
  chrome.windows.getCurrent({populate: true}, (currentWindow) => {
    if (chrome.runtime.lastError) {
      console.error("Error getting current window:", chrome.runtime.lastError.message);
      return;
    }

    console.log("Current window ID:", currentWindow.id);

    // Check if the window has tabs
    if (!currentWindow.tabs || currentWindow.tabs.length === 0) {
      console.error("No tabs found in current window");
      // Fallback: create a new Gmail tab
      chrome.tabs.create({ url: "https://mail.google.com/" });
      return;
    }

    // Look for Gmail tab only in the current window
    const gmailTab = currentWindow.tabs.find(tab =>
      tab.url && /https?:\/\/mail\.google\.com(\/.*)?$/.test(tab.url)
    );

    if (gmailTab) {
      // Gmail tab exists in current window/workspace
      console.log("Found Gmail tab in current window, activating:", gmailTab.id);
      chrome.tabs.update(gmailTab.id, { active: true }, () => {
        if (chrome.runtime.lastError) {
          console.error("Error activating tab:", chrome.runtime.lastError.message);
        }
      });
    } else {
      // No Gmail tab in current window/workspace, create one
      console.log("No Gmail tab in current window, creating new one");
      chrome.tabs.create({ url: "https://mail.google.com/" }, () => {
        if (chrome.runtime.lastError) {
          console.error("Error creating tab:", chrome.runtime.lastError.message);
        }
      });
    }
  });
});

const Failure = function(error) {
  if (timeout !== null) return;
  chrome.action.setBadgeText({text:" ? "});
  chrome.action.setIcon({path:"icon-inactive.png"});
  chrome.action.setTitle({title:'Gmail\n\n' + error});
  timeout = setTimeout(function() { Update(); }, checkInterval);
};

const Read = function (xmlText) {
  const parser = new XMLParser();
  const obj = parser.parse(xmlText);

  const feed = { title: '', count: 0, entries: [] };

  const root = obj.feed || {}; // Gmail Atom feed root element is <feed>
  feed.title = root.title || '';
  feed.count = parseInt(root.fullcount || '0', 10);

  const entries = Array.isArray(root.entry) ? root.entry : root.entry ? [root.entry] : [];

  for (const e of entries) {
    const author = e.author || {};
    const entry = {
      id: e.id || '',
      href: e.link?.['@_href'] || '',
      subj: e.title || '',
      body: e.summary || '',
      from_name: author.name || '',
      from_addr: author.email || '',
    };
    entry.from = `${entry.from_name} <${entry.from_addr}>`;
    feed.entries.push(entry);
  }

  return feed;
};

const Summarise = function(entries) {
  let r = '';
  const count = entries.length;
  for (let i = 0; i < count; i++) {
    if (i===10) { r+='\n\n...+'+(count-10)+' more'; break; }
    const entry = entries[i];
    if (r!=='') r+='\n\n';
    r += entry.from_name + '\n"' + entry.subj + '"';
  }
  return r==='' ? 'No unread e-mails' : r;
};

// Store seen message IDs - note: will be reset when service worker terminates
const seen = {};

const Notify = function(entries) {
  const not_seen = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (seen.hasOwnProperty(entry.id)) continue;
    not_seen.push(entry);
    seen[entry.id]=entry;
  }
  if (not_seen.length === 0) return;

  const notificationId = Math.random().toString();
  chrome.notifications.create(notificationId, {
    type: "basic",
    title: not_seen.length + (not_seen.length === 1 ? " new e-mail" : " new e-mails"),
    message: Summarise(not_seen),
    iconUrl: 'icon-64.png'
  });

  // Clear notification after 10 seconds
  setTimeout(() => {
    chrome.notifications.clear(notificationId);
  }, 10000);
};

const Success = function(feedData) {
  if (timeout !== null) return;
  const feed = Read(feedData);
  Notify(feed.entries);
  chrome.action.setIcon({path: "icon-active.png"});
  chrome.action.setBadgeText({text: feed.count === 0 ? '' : '' + feed.count});
  chrome.action.setTitle({title: feed.title + '\n\n' + Summarise(feed.entries)});
  timeout = setTimeout(function() { Update(); }, checkInterval);
};

const Update = function() {
  console.log('Gmail Notifier: Checking for new emails');
  if (timeout !== null) { clearTimeout(timeout); timeout = null; }

  // Use fetch instead of XMLHttpRequest
  fetch('https://mail.google.com/mail/u/0/feed/atom?' + Math.random(), {
    method: 'GET',
    credentials: 'include' // Include cookies for authentication
  })
  .then(response => {
    if (response.status === 401) {
      throw new Error('You are not logged in.');
    } else if (!response.ok) {
      throw new Error('Error communicating with the server. HTTP status ' + response.status + '.');
    }
    return response.text(); // Get response as text
  })
  .then(xmlText => {
    Success(xmlText);
  });
  // .catch(error => {
  //   Failure(error.message || 'Error communicating with the server.');
  //   console.log("Gmail Update: " + error.message);
  // });

  // Set timeout for the request
  const requestTimeout = setTimeout(function() {
    Failure('Error communicating with the server. Request timed out.');
  }, 30000);
};

// Import a keepAlive mechanism that doesn't rely on alarms
self.addEventListener('message', (event) => {
  if (event.data === 'ping') {
    console.log('Gmail Notifier: Received ping');
    // Respond to keep alive ping
    event.ports[0].postMessage('pong');
  }
});