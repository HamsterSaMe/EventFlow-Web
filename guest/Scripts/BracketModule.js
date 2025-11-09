console.log('Guest bracket module loaded');
const socket = io();

const bracketContainer = document.getElementById('bracketContainer');
const championDisplay = document.getElementById('championDisplay');

// Render function for real-time bracket display
function renderBracket(data) {
  if (!data || !data.rounds) return;
  bracketContainer.innerHTML = '';

  data.rounds.forEach((round, roundIndex) => {
    const roundDiv = document.createElement('div');
    roundDiv.className = 'round';

    const roundTitle = document.createElement('h3');
    roundTitle.textContent = `Round ${roundIndex + 1}`;
    roundDiv.appendChild(roundTitle);

    round.matches.forEach(match => {
      const matchDiv = document.createElement('div');
      matchDiv.className = 'match';

      matchDiv.innerHTML = `
        <div>${match.player1}${match.winner === match.player1 ? ' 🏆' : ''}</div>
        <div>${match.player2}${match.winner === match.player2 ? ' 🏆' : ''}</div>
      `;

      roundDiv.appendChild(matchDiv);
    });

    bracketContainer.appendChild(roundDiv);
  });

  if (data.champion) {
    championDisplay.textContent = `🏆 Champion: ${data.champion}`;
  } else {
    championDisplay.textContent = '';
  }
}

// Listen for real-time bracket updates from host
socket.on('updateBracket', (bracketData) => {
  console.log('Received bracket update', bracketData);
  renderBracket(bracketData);
});
