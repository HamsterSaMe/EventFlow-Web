// This file runs on the guest's phone
console.log('📱 Guest app loading...');

const socket = io(); 
const statusElement = document.getElementById('status');
const attendanceSection = document.getElementById('attendanceSection');

const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const suggestionsEl = document.getElementById('suggestions');
const confirmationMsg = document.getElementById('confirmationMsg');

let nameList = []; // current list from host
let lastRequestedMark = null; // track name we asked server to mark
// --- Connection status handling ---
socket.on('connect', () => {
  console.log('✅ Connected to host server!');
  statusElement.textContent = 'Connected!';
  statusElement.className = 'status-connected';
  socket.emit('newGuestConnected');
});

// Handle disconnection
socket.on('disconnect', () => {
  console.log('❌ Disconnected from host server.');
  statusElement.textContent = 'Connection lost. Reconnecting...';
  statusElement.className = 'status-disconnected';
});

// --- Open link when host sends it ---
socket.on('openLink', (url) => {
  console.log('🌐 Host requested to open:', url);
  window.open(url, '_blank');
});

// --- Attendance logic ---

// Receive the latest name list from host
socket.on('nameList', (list) => {
  console.log('📝 Received name list:', list);
  nameList = Array.isArray(list) ? list.slice() : [];
  // enable attendance section UI (search is available once server provides list)
  attendanceSection.classList.remove('hidden');

  // If we recently requested a mark, check whether server confirmed it by emitting an updated list
  if (lastRequestedMark) {
    const person = nameList.find(p => normalize(p.name) === normalize(lastRequestedMark));
    if (person && person.attended) {
      // confirmed
      confirmationMsg.textContent = `✅ Attendance marked for "${person.name}".`;
      // lock inputs to avoid confusion
      searchInput.disabled = true;
      searchBtn.disabled = true;
      // hide suggestions after confirmation
      suggestionsEl.classList.remove('show');
      lastRequestedMark = null;
      return;
    }
  }

  // otherwise refresh suggestions based on current input
  renderSuggestions(searchInput.value || '');
});

// Helper: normalize for comparison
function normalize(s) {
  return String(s || '').trim().toLowerCase();
}

// Render suggestions (filtered)
// Behavior: suggestions remain hidden until user types at least one character.
// - If user typed exactly 1 char, show the full original attendance order (as requested).
// - If user typed >1 chars, filter the list.
function renderSuggestions(filter) {
  const q = normalize(filter);
  suggestionsEl.innerHTML = '';

  if (!nameList || nameList.length === 0) {
    suggestionsEl.classList.remove('show');
    return;
  }

  // hide suggestions when input is empty
  if (!q) {
    suggestionsEl.classList.remove('show');
    return;
  }

  // Show full original list on first keystroke, otherwise filter
  let items;
  if (q.length === 1) {
    items = nameList;
  } else {
    items = nameList.filter(p => normalize(p.name).includes(q));
  }

  // no matches
  if (items.length === 0) {
    const no = document.createElement('div');
    no.className = 'item';
    no.textContent = 'No matches';
    suggestionsEl.appendChild(no);
    suggestionsEl.classList.add('show');
    return;
  }

  // create suggestion elements
  items.forEach(person => {
    const div = document.createElement('div');
    div.className = 'item' + (person.attended ? ' attended' : '');
    div.textContent = person.name;
    div.dataset.name = person.name;
    if (!person.attended) {
      div.addEventListener('click', () => {
        // clicking selects the name (does not auto-confirm)
        searchInput.value = person.name;
        // when a name is clicked, show suggestions for that exact name (helps confirm)
        renderSuggestions(person.name);
        searchInput.focus();
      });
    }
    suggestionsEl.appendChild(div);
  });

  suggestionsEl.classList.add('show');
}

// filter suggestions as user types
searchInput.addEventListener('input', (e) => {
  // clear any previous confirmation message when user types again
  confirmationMsg.textContent = '';
  // re-enable controls if user starts over
  if (searchInput.disabled) {
    searchInput.disabled = false;
    searchBtn.disabled = false;
  }
  renderSuggestions(e.target.value);
});

// show suggestions when input focused only if there's content
searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim()) renderSuggestions(searchInput.value);
});

// handle Enter key to trigger search
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    searchBtn.click();
  }
});

// Mark attendance when search icon/button clicked
searchBtn.addEventListener('click', () => {
  const typed = searchInput.value.trim();
  if (!typed) {
    alert('Please type or select your name first.');
    return;
  }

  // find exact match (case-insensitive) in list
  const found = nameList.find(p => normalize(p.name) === normalize(typed));
  if (!found) {
    alert('Name not found in the list. Please select from suggestions or type the exact name.');
    return;
  }

  // already attended?
  if (found.attended) {
    confirmationMsg.textContent = `✅ Attendance already marked for "${found.name}".`;
    // lock inputs to avoid confusion
    searchInput.disabled = true;
    searchBtn.disabled = true;
    suggestionsEl.classList.remove('show');
    return;
  }

  // send attendance to server
  console.log('📡 Sending attendance for:', found.name);
  lastRequestedMark = found.name;
  socket.emit('markAttendance', found.name);

  // Provide immediate feedback while waiting for server confirmation
  confirmationMsg.textContent = 'Marking attendance...';
  // keep inputs enabled briefly but prevent duplicate clicks
  searchBtn.disabled = true;
});

// Handle connection errors
socket.on('connect_error', () => {
  statusElement.textContent = 'Connection failed. Reconnecting...';
  statusElement.className = 'status-disconnected';
});
