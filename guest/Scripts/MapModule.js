const socket = io();
const frame = document.getElementById('MapFrame');
const fileNameEl = document.getElementById('fileName');

// When host uploads a new Map (file)
socket.on('mapUpdated', (data) => {
  if (!data) {
    fileNameEl.textContent = 'No map uploaded yet.';
    frame.src = '';
    frame.style.display = 'none';
    return;
  }

  if (data.type === 'file') {
    fileNameEl.textContent = `File: ${data.name}`;
    frame.src = data.url;
    frame.style.display = 'block';
  } else {
    fileNameEl.textContent = 'Invalid Map data.';
    frame.style.display = 'none';
  }
});

// Request current map on connect (optional, since server auto-sends)
socket.on('connect', () => {
  console.log('Connected to server');
});
