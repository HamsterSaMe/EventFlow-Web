(function() {
  const socket = window.socket || io();

  // Determine current page
  const path = window.location.pathname;
  let pageName = 'index'; // Default

  if (path.includes('bracket') || path.includes('tournament')) pageName = 'tournament'; // Map both to tournament/bracket logic if needed, or separate
  else if (path.includes('brochure')) pageName = 'brochure';
  else if (path.includes('map')) pageName = 'map';
  else if (path.includes('link')) pageName = 'link';
  else if (path.includes('index') || path === '/') pageName = 'index';

  // Also handle specific html files if they differ from logical names
  if (path.toLowerCase().includes('bracket.html')) pageName = 'bracket';
  if (path.toLowerCase().includes('tournament.html')) pageName = 'tournament';
  if (path.toLowerCase().includes('performance.html')) pageName = 'performance';

  console.log('Current Page for Background:', pageName);

  function applyBackground(config) {
    if (!config) return;
    
    const bgUrl = config[pageName];
    if (bgUrl) {
      document.body.style.backgroundImage = `url('${bgUrl}')`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundAttachment = 'fixed';
      document.body.style.backgroundRepeat = 'no-repeat';
    } else {
      // Reset to default if needed, or keep CSS default
      document.body.style.backgroundImage = '';
    }
  }

  socket.on('pageBackgroundsUpdated', (config) => {
    console.log('Background config updated:', config);
    applyBackground(config);
  });
})();
