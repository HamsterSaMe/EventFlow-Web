// This file runs on the guest's phone
console.log('📱 Guest app loading...');

const socket = io(); 
window.socket = socket; // Expose socket globally
const statusElement = document.getElementById('status');

// Attendance elements removed for now
// const attendanceSection = document.getElementById('attendanceSection');
// const searchInput = document.getElementById('searchInput');
// const searchBtn = document.getElementById('searchBtn');
// const suggestionsEl = document.getElementById('suggestions');
// const confirmationMsg = document.getElementById('confirmationMsg');

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

// --- Attendance logic (Disabled for now) ---

// Receive the latest name list from host
socket.on('attendanceSync', (list) => {
  console.log('📝 Received attendance sync:', list);
  nameList = Array.isArray(list) ? list.slice() : [];
  sortNameList();
  
  // Attendance UI logic disabled
  /*
  // enable attendance section UI (search is available once server provides list)
  if (attendanceSection) attendanceSection.classList.remove('hidden');

  // If we recently requested a mark, check whether server confirmed it by emitting an updated list
  if (lastRequestedMark) {
    const person = nameList.find(p => normalize(p.name) === normalize(lastRequestedMark));
    if (person && person.attended) {
      // confirmed
      if (confirmationMsg) confirmationMsg.textContent = `✅ Attendance marked for "${person.name}".`;
      // lock inputs to avoid confusion
      if (searchInput) searchInput.disabled = true;
      if (searchBtn) searchBtn.disabled = true;
      // hide suggestions after confirmation
      if (suggestionsEl) suggestionsEl.classList.remove('show');
      lastRequestedMark = null;
      return;
    }
  }

  // otherwise refresh suggestions based on current input
  if (searchInput) renderSuggestions(searchInput.value || '');
  */
});

socket.on('attendanceDelta', (delta) => {
  if (!delta) return;
  const { type, attendee } = delta;
  if (!attendee || typeof attendee.id === 'undefined') return;
  console.log('📡 Attendance delta:', type, attendee);
  const index = nameList.findIndex((entry) => entry.id === attendee.id);

  if (type === 'removed') {
    if (index !== -1) nameList.splice(index, 1);
  } else if (type === 'added') {
    if (index === -1) nameList.push(attendee);
    else nameList[index] = attendee;
  } else {
    if (index === -1) nameList.push(attendee);
    else nameList[index] = { ...nameList[index], ...attendee };
  }

  sortNameList();
});

// Helper: normalize for comparison
function normalize(s) {
  return String(s || '').trim().toLowerCase();
}

function sortNameList() {
  nameList.sort((a, b) => {
    const left = (a && a.name) ? a.name : '';
    const right = (b && b.name) ? b.name : '';
    return left.localeCompare(right);
  });
}

/*
// Render suggestions (filtered)
function renderSuggestions(filter) {
  const q = normalize(filter);
  if (suggestionsEl) suggestionsEl.innerHTML = '';

  if (!nameList || nameList.length === 0) {
    if (suggestionsEl) suggestionsEl.classList.remove('show');
    return;
  }

  // hide suggestions when input is empty
  if (!q) {
    if (suggestionsEl) suggestionsEl.classList.remove('show');
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
    if (suggestionsEl) {
        suggestionsEl.appendChild(no);
        suggestionsEl.classList.add('show');
    }
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
        if (searchInput) {
            searchInput.value = person.name;
            renderSuggestions(person.name);
            searchInput.focus();
        }
      });
    }
    if (suggestionsEl) suggestionsEl.appendChild(div);
  });

  if (suggestionsEl) suggestionsEl.classList.add('show');
}

if (searchInput) {
    // filter suggestions as user types
    searchInput.addEventListener('input', (e) => {
      // clear any previous confirmation message when user types again
      if (confirmationMsg) confirmationMsg.textContent = '';
      // re-enable controls if user starts over
      if (searchInput.disabled) {
        searchInput.disabled = false;
        if (searchBtn) searchBtn.disabled = false;
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
        if (searchBtn) searchBtn.click();
      }
    });
}

if (searchBtn) {
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
        if (confirmationMsg) confirmationMsg.textContent = `✅ Attendance already marked for "${found.name}".`;
        // lock inputs to avoid confusion
        if (searchInput) searchInput.disabled = true;
        if (searchBtn) searchBtn.disabled = true;
        if (suggestionsEl) suggestionsEl.classList.remove('show');
        return;
      }

      // send attendance to server
      console.log('📡 Sending attendance for:', found.name);
      lastRequestedMark = found.name;
      socket.emit('markAttendance', found.name);

      // Provide immediate feedback while waiting for server confirmation
      if (confirmationMsg) confirmationMsg.textContent = 'Marking attendance...';
      // keep inputs enabled briefly but prevent duplicate clicks
      searchBtn.disabled = true;
    });
}
*/

// Handle connection errors
socket.on('connect_error', () => {
  statusElement.textContent = 'Connection failed. Reconnecting...';
  statusElement.className = 'status-disconnected';
});
